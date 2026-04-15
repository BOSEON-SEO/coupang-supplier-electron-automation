"""
Keycloak 로그인 자동화

supplier.coupang.com의 Keycloak OAuth2 로그인 폼을 자동으로 처리한다.

로그인 흐름:
    1. 세션 유효 여부 확인 (supplier.coupang.com 도메인 존재)
    2. 무효 → Keycloak 로그인 페이지로 리다이렉트됨
    3. #username, #password 입력 → #kc-login 클릭
    4. 비밀번호 만료 모달 → "Change My Password Later" / "나중에 변경하기" 자동 클릭
    5. supplier.coupang.com 도착 확인

셀렉터 참조 (Keycloak 표준 로그인 폼):
    - 아이디 입력: #username
    - 비밀번호 입력: #password
    - 로그인 버튼: #kc-login
    - 비밀번호 만료 "나중에 변경": 텍스트 기반 매칭

자격증명 환경변수:
    - COUPANG_ID_{VENDOR}   (예: COUPANG_ID_BASIC)
    - COUPANG_PW_{VENDOR}   (예: COUPANG_PW_BASIC)

사용 예:
    from common.login import ensure_logged_in

    # page = get_existing_page(browser)
    ensure_logged_in(page, vendor_id="basic")
"""

import os
import re
import sys
import time
from typing import Optional, Tuple
from urllib.parse import urlparse

from common.ipc import send_log, send_error, send_progress


# ─── 상수 ────────────────────────────────────────────────────────

# Keycloak 로그인 폼 셀렉터 (쿠팡 서플라이어 허브 공통)
SEL_USERNAME = "#username"
SEL_PASSWORD = "#password"
SEL_LOGIN_BTN = "#kc-login"

# 비밀번호 만료 모달 — "나중에 변경하기" 버튼
# Keycloak은 로케일에 따라 텍스트가 달라지므로 영문·한글 모두 매칭
PASSWORD_CHANGE_LATER_TEXTS = [
    "Change My Password Later",
    "나중에 변경하기",
]

# 로그인 페이지 판별 패턴
# Keycloak 표준 URL: /auth/realms/{realm}/login-actions/authenticate
# 또는 /auth/realms/{realm}/protocol/openid-connect/auth
KEYCLOAK_URL_PATTERNS = [
    r"/auth/realms/.*/login-actions/authenticate",
    r"/auth/realms/.*/protocol/openid-connect/auth",
    r"/auth/realms/.*/login-actions/required-action",
]

# Keycloak 호스트 (로그인 리다이렉트 대상)
KEYCLOAK_HOSTS = [
    "login.coupang.com",
    "sso.coupang.com",
]

# 세션 유효 판단 도메인
SESSION_VALID_DOMAIN = "supplier.coupang.com"

# 타임아웃 (ms)
LOGIN_NAVIGATION_TIMEOUT = 30_000    # 로그인 후 페이지 전환 대기
SELECTOR_WAIT_TIMEOUT = 10_000       # 셀렉터 출현 대기
PASSWORD_MODAL_WAIT = 5_000          # 비밀번호 만료 모달 대기


# ─── 자격증명 조회 ───────────────────────────────────────────────

def get_credentials(vendor_id: str) -> Tuple[str, str]:
    """
    환경변수에서 벤더별 자격증명을 가져온다.

    환경변수 명명 규칙:
        COUPANG_ID_{VENDOR_UPPER}  (예: COUPANG_ID_BASIC)
        COUPANG_PW_{VENDOR_UPPER}  (예: COUPANG_PW_BASIC)

    Args:
        vendor_id: 벤더 식별자 (소문자, 예: "basic")

    Returns:
        (username, password) 튜플

    Raises:
        SystemExit: 환경변수 미설정 시
    """
    key_upper = vendor_id.upper()
    env_id = f"COUPANG_ID_{key_upper}"
    env_pw = f"COUPANG_PW_{key_upper}"

    username = os.environ.get(env_id)
    password = os.environ.get(env_pw)

    if not username:
        send_error(
            f"자격증명 미설정: 환경변수 {env_id} 가 없습니다. "
            f"벤더 '{vendor_id}'의 로그인 ID를 설정하세요."
        )
        sys.exit(1)

    if not password:
        send_error(
            f"자격증명 미설정: 환경변수 {env_pw} 가 없습니다. "
            f"벤더 '{vendor_id}'의 비밀번호를 설정하세요."
        )
        sys.exit(1)

    return username, password


# ─── 페이지 상태 판별 ────────────────────────────────────────────

def is_on_login_page(page) -> bool:
    """
    현재 페이지가 Keycloak 로그인 폼인지 판별한다.

    판별 기준 (OR 조건 — 어느 하나라도 충족 시 True):
        1. URL 호스트가 KEYCLOAK_HOSTS 중 하나
        2. URL 경로가 KEYCLOAK_URL_PATTERNS 중 하나에 매칭
        3. DOM에 #kc-login 셀렉터 존재

    Args:
        page: Playwright Page 인스턴스

    Returns:
        True  — Keycloak 로그인 페이지
        False — 그 외
    """
    try:
        current_url = page.url
    except Exception:
        return False

    parsed = urlparse(current_url)
    host = parsed.hostname or ""
    path = parsed.path or ""

    # 기준 1: Keycloak 호스트
    if host in KEYCLOAK_HOSTS:
        return True

    # 기준 2: Keycloak URL 패턴
    for pattern in KEYCLOAK_URL_PATTERNS:
        if re.search(pattern, path):
            return True

    # 기준 3: DOM에 로그인 폼 존재
    try:
        login_btn = page.query_selector(SEL_LOGIN_BTN)
        username_field = page.query_selector(SEL_USERNAME)
        if login_btn and username_field:
            return True
    except Exception:
        pass

    return False


def is_on_password_change_page(page) -> bool:
    """
    비밀번호 만료/변경 요구 페이지인지 판별한다.

    Keycloak은 비밀번호 만료 시 required-action 페이지로 리다이렉트한다.
    URL에 'required-action' 또는 'UPDATE_PASSWORD'가 포함되거나,
    "Change My Password Later" / "나중에 변경하기" 텍스트가 DOM에 존재.

    Args:
        page: Playwright Page 인스턴스

    Returns:
        True — 비밀번호 변경 요구 페이지
    """
    try:
        current_url = page.url
    except Exception:
        return False

    # URL 기반 판별
    if "required-action" in current_url or "UPDATE_PASSWORD" in current_url:
        return True

    # DOM 기반 판별: "나중에 변경" 텍스트 존재 여부
    for text in PASSWORD_CHANGE_LATER_TEXTS:
        try:
            el = page.query_selector(f"text={text}")
            if el:
                return True
        except Exception:
            pass

    return False


def is_session_valid(page) -> bool:
    """
    supplier.coupang.com 세션이 유효한지 판단한다.

    유효 기준: URL 호스트에 'supplier.coupang.com' 포함.

    Args:
        page: Playwright Page 인스턴스

    Returns:
        True — 유효 세션
    """
    try:
        current_url = page.url
    except Exception:
        return False

    parsed = urlparse(current_url)
    host = parsed.hostname or ""
    return SESSION_VALID_DOMAIN in host


# ─── 로그인 실행 ─────────────────────────────────────────────────

def _fill_login_form(page, username: str, password: str) -> None:
    """
    Keycloak 로그인 폼에 자격증명을 입력하고 제출한다.

    단계:
        1. #username 필드 대기 및 입력
        2. #password 필드 입력
        3. #kc-login 버튼 클릭
        4. 네비게이션 완료 대기

    쿠팡 사이트 함정 대응:
        - 폼 필드 clear 후 입력 (기존 값 잔류 방지)
        - 버튼 클릭 전 잠시 대기 (JS 초기화 대기)
    """
    send_log("로그인 폼 입력 시작")

    # 1. 아이디 필드 대기 및 입력
    send_log(f"셀렉터 대기: {SEL_USERNAME}")
    page.wait_for_selector(SEL_USERNAME, state="visible", timeout=SELECTOR_WAIT_TIMEOUT)

    username_field = page.query_selector(SEL_USERNAME)
    username_field.click()
    username_field.fill("")  # clear
    username_field.fill(username)
    send_log("아이디 입력 완료")

    # 2. 비밀번호 필드 입력
    send_log(f"셀렉터 대기: {SEL_PASSWORD}")
    page.wait_for_selector(SEL_PASSWORD, state="visible", timeout=SELECTOR_WAIT_TIMEOUT)

    password_field = page.query_selector(SEL_PASSWORD)
    password_field.click()
    password_field.fill("")  # clear
    password_field.fill(password)
    send_log("비밀번호 입력 완료 (값 마스킹)")

    # 3. 로그인 버튼 클릭
    send_log(f"셀렉터 대기: {SEL_LOGIN_BTN}")
    page.wait_for_selector(SEL_LOGIN_BTN, state="visible", timeout=SELECTOR_WAIT_TIMEOUT)

    # JS 초기화 대기 (쿠팡 Keycloak 커스텀 JS가 있을 수 있음)
    page.wait_for_timeout(500)

    send_log("로그인 버튼 클릭")
    page.click(SEL_LOGIN_BTN)

    # 4. 네비게이션 대기 (로그인 처리)
    send_log("로그인 처리 대기 중...")
    try:
        page.wait_for_load_state("networkidle", timeout=LOGIN_NAVIGATION_TIMEOUT)
    except Exception:
        # networkidle 타임아웃은 치명적이지 않음 — SPA 라우팅에서 종종 발생
        send_log("networkidle 타임아웃 — 페이지 상태 확인 계속 진행")


def _handle_password_change_modal(page) -> bool:
    """
    비밀번호 만료 모달이 나타나면 "나중에 변경하기" 버튼을 클릭한다.

    Keycloak 비밀번호 만료 시 나타나는 required-action 페이지에서
    "Change My Password Later" 또는 "나중에 변경하기" 링크/버튼을 찾아 클릭.

    Returns:
        True  — 모달 발견 및 처리 완료
        False — 모달 미발견 (비밀번호 만료 아님)
    """
    if not is_on_password_change_page(page):
        return False

    send_log("비밀번호 만료/변경 요구 페이지 감지")

    for text in PASSWORD_CHANGE_LATER_TEXTS:
        try:
            # 텍스트 기반 셀렉터: Playwright의 text= 셀렉터 사용
            selector = f"text={text}"
            el = page.query_selector(selector)
            if el:
                send_log(f"'{text}' 버튼 발견 — 클릭")
                el.click()

                # 네비게이션 대기
                try:
                    page.wait_for_load_state("networkidle", timeout=LOGIN_NAVIGATION_TIMEOUT)
                except Exception:
                    pass

                send_log("비밀번호 변경 연기 완료")
                return True
        except Exception as exc:
            send_log(f"'{text}' 처리 중 에러 (다음 텍스트 시도): {exc}")
            continue

    # 텍스트 기반 매칭 실패 → <a> 태그 href 패턴으로 시도
    # Keycloak은 때때로 kc-info-message 영역에 링크를 배치
    fallback_selectors = [
        "#kc-info-message a",          # Keycloak 정보 메시지 영역 링크
        ".kc-info-message a",          # 클래스 기반
        "a[href*='required-action']",  # required-action 포함 링크
        "#kc-content a",               # 콘텐츠 영역 링크
    ]

    for sel in fallback_selectors:
        try:
            el = page.query_selector(sel)
            if el:
                el_text = el.inner_text().strip()
                send_log(f"폴백 셀렉터 '{sel}' 발견 (텍스트: '{el_text}') — 클릭")
                el.click()

                try:
                    page.wait_for_load_state("networkidle", timeout=LOGIN_NAVIGATION_TIMEOUT)
                except Exception:
                    pass

                send_log("비밀번호 변경 연기 완료 (폴백)")
                return True
        except Exception:
            continue

    send_error(
        "비밀번호 만료 페이지에서 '나중에 변경하기' 버튼을 찾을 수 없습니다. "
        "수동으로 처리해주세요."
    )
    return False


def _check_login_error(page) -> Optional[str]:
    """
    로그인 실패 메시지를 확인한다.

    Keycloak 로그인 실패 시 표시되는 에러 요소:
        - .kc-feedback-text   (Keycloak 표준 피드백)
        - #kc-content-wrapper .alert  (Alert 박스)
        - .kc-error-message   (에러 메시지 전용)
        - #input-error        (입력 에러)

    Returns:
        에러 메시지 문자열 또는 None (에러 없음)
    """
    error_selectors = [
        ".kc-feedback-text",
        "#kc-content-wrapper .alert",
        ".kc-error-message",
        "#input-error",
        ".alert-error",
        "span.kc-feedback-text",
    ]

    for sel in error_selectors:
        try:
            el = page.query_selector(sel)
            if el:
                text = el.inner_text().strip()
                if text:
                    return text
        except Exception:
            continue

    return None


# ─── 메인 진입점 ─────────────────────────────────────────────────

def do_login(page, vendor_id: str) -> bool:
    """
    Keycloak 로그인을 수행한다.

    전제조건: page가 이미 Keycloak 로그인 페이지에 있어야 한다.
    (is_on_login_page(page) == True)

    단계:
        1. 자격증명 조회 (환경변수)
        2. 로그인 폼 입력 및 제출
        3. 로그인 실패 확인 → 에러 시 False 반환
        4. 비밀번호 만료 모달 처리
        5. supplier.coupang.com 도달 확인

    Args:
        page: Playwright Page (Keycloak 로그인 페이지)
        vendor_id: 벤더 식별자

    Returns:
        True  — 로그인 성공 (supplier.coupang.com 도달)
        False — 로그인 실패
    """
    send_progress(10, f"로그인 시작: 벤더 '{vendor_id}'")

    # 1. 자격증명 조회
    username, password = get_credentials(vendor_id)
    send_log(f"자격증명 로드 완료: {username[:3]}***")

    # 2. 로그인 폼 입력 및 제출
    send_progress(30, "로그인 폼 입력 중")
    _fill_login_form(page, username, password)

    # 3. 로그인 실패 확인
    # 잠시 대기 후 에러 메시지 체크 (로그인 페이지에 남아있으면 실패)
    page.wait_for_timeout(2000)

    if is_on_login_page(page):
        error_msg = _check_login_error(page)
        if error_msg:
            send_error(f"로그인 실패: {error_msg}")
            return False
        # 에러 메시지 없이 로그인 페이지에 남아있는 경우
        # → 추가 대기 후 재확인
        send_log("로그인 페이지 잔류 — 추가 대기 중...")
        page.wait_for_timeout(3000)

        if is_on_login_page(page):
            error_msg = _check_login_error(page)
            send_error(
                f"로그인 실패: 로그인 페이지를 벗어나지 못했습니다. "
                f"에러: {error_msg or '(메시지 없음)'}"
            )
            return False

    send_progress(60, "로그인 폼 제출 완료")

    # 4. 비밀번호 만료 모달 처리
    send_progress(70, "비밀번호 만료 확인 중")
    _handle_password_change_modal(page)

    # 5. 세션 유효 확인
    send_progress(90, "세션 유효 확인 중")

    # 최종 URL 확인 (최대 10초 추가 대기)
    for attempt in range(10):
        if is_session_valid(page):
            send_progress(100, "로그인 성공")
            send_log(f"[Login Success] vendor={vendor_id}, URL={page.url}")
            return True
        page.wait_for_timeout(1000)

    send_error(
        f"로그인 후 supplier.coupang.com에 도달하지 못했습니다. "
        f"현재 URL: {page.url}"
    )
    return False


def ensure_logged_in(page, vendor_id: str) -> bool:
    """
    세션이 유효하면 True 반환, 무효하면 로그인을 시도한다.

    자동화 스크립트의 진입점에서 호출하여 항상 유효한 세션을 보장한다.

    흐름:
        1. is_session_valid → True면 즉시 반환
        2. is_on_login_page → True면 do_login 실행
        3. 그 외 → supplier.coupang.com으로 이동 시도 → 로그인 페이지면 do_login

    Args:
        page: Playwright Page 인스턴스
        vendor_id: 벤더 식별자

    Returns:
        True  — 세션 유효 (기존 또는 로그인 성공)
        False — 로그인 실패
    """
    send_log(f"세션 확인: 벤더 '{vendor_id}'")

    # 1. 이미 유효한 세션
    if is_session_valid(page):
        send_log(f"[Session Valid] 기존 세션 유효 — URL: {page.url}")
        return True

    send_log(f"세션 무효 — 현재 URL: {page.url}")

    # 2. Keycloak 로그인 페이지에 있는 경우
    if is_on_login_page(page):
        send_log("Keycloak 로그인 페이지 감지 — 로그인 진행")
        return do_login(page, vendor_id)

    # 3. 그 외 (about:blank, 다른 사이트 등) → supplier.coupang.com으로 이동
    send_log("supplier.coupang.com으로 이동 시도")
    target_url = "https://supplier.coupang.com"

    try:
        # SPA 내부 라우팅 함정 대응: page.goto가 가로채일 수 있음
        # → location.replace() 폴백
        try:
            page.goto(target_url, timeout=LOGIN_NAVIGATION_TIMEOUT)
        except Exception:
            send_log("page.goto 실패 → location.replace() 폴백")
            # target_url은 하드코딩 https://supplier.coupang.com 이므로
            # JS 인젝션 위험 없음. 그래도 이스케이프 적용.
            safe = target_url.replace("\\", "\\\\").replace("'", "\\'")
            page.evaluate(f"() => window.location.replace('{safe}')")
            page.wait_for_load_state("networkidle", timeout=LOGIN_NAVIGATION_TIMEOUT)
    except Exception as exc:
        send_error(f"supplier.coupang.com 이동 실패: {exc}")
        return False

    # 이동 후 상태 확인
    page.wait_for_timeout(2000)

    if is_session_valid(page):
        send_log(f"[Session Valid] 이동 후 세션 유효 — URL: {page.url}")
        return True

    if is_on_login_page(page):
        send_log("리다이렉트 → Keycloak 로그인 페이지 — 로그인 진행")
        return do_login(page, vendor_id)

    # 비밀번호 변경 페이지인 경우
    if is_on_password_change_page(page):
        send_log("비밀번호 만료 페이지 감지 — 처리 진행")
        _handle_password_change_modal(page)

        if is_session_valid(page):
            send_log(f"[Session Valid] 비밀번호 처리 후 세션 유효 — URL: {page.url}")
            return True

    send_error(f"로그인 흐름 완료 후 세션 무효. 현재 URL: {page.url}")
    return False
