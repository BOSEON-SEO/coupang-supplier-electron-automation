"""
login.py — Keycloak 로그인 자동화 스크립트

Electron 앱에서 python:run IPC로 실행되는 Playwright 자동화 스크립트.
CDP attach → 기존 페이지 재사용 → Keycloak 로그인 → supplier.coupang.com 복귀.

실행 환경 (Electron Main이 python:run에서 자동 설정):
    CDP_ENDPOINT        — CDP 디버깅 엔드포인트 (예: http://127.0.0.1:9222)
    CDP_PORT            — CDP 포트 번호
    COUPANG_DATA_DIR    — 데이터 저장 디렉토리
    COUPANG_ID_{VENDOR} — 벤더별 로그인 ID
    COUPANG_PW_{VENDOR} — 벤더별 비밀번호

인자:
    --vendor <vendor_id>   벤더 식별자 (필수, 예: basic)
    --url <target_url>     로그인 후 이동할 URL (선택, 기본: supplier.coupang.com)
    --force                세션 유효해도 강제 재로그인

실행 예:
    # Electron 앱 내부 (IPC)
    python:run("login.py", ["--vendor", "basic"])

    # 직접 실행 (디버깅)
    CDP_ENDPOINT=http://127.0.0.1:9222 \
    COUPANG_ID_BASIC=myuser \
    COUPANG_PW_BASIC=mypass \
    python scripts/login.py --vendor basic

흐름:
    1. CDP 엔드포인트에 Playwright로 attach (connect_over_cdp)
    2. 기존 페이지(탭) 재사용 (context.pages[0], 새 탭 금지)
    3. 현재 세션 상태 확인
       a. 유효(supplier.coupang.com) → --force 아니면 즉시 완료
       b. Keycloak 로그인 페이지 → 로그인 진행
       c. 그 외(about:blank 등) → supplier.coupang.com으로 이동 → 리다이렉트 대응
    4. Keycloak 로그인 폼 자동 입력·제출
       - #username, #password, #kc-login
       - 비밀번호 만료 모달 자동 처리 ("Change My Password Later" / "나중에 변경하기")
    5. 로그인 성공/실패 판단
       - 성공: URL에 supplier.coupang.com 포함
       - 실패: Keycloak 에러 메시지 (.kc-feedback-text 등) 감지
    6. 로그인 후 target URL로 이동 (지정된 경우)
    7. 최종 세션 상태 로그 출력 → exit code 반환

종료 코드:
    0 — 로그인 성공 (세션 유효)
    1 — 로그인 실패 (자격증명 오류, 네트워크 오류 등)

주의사항 (CLAUDE.md 도메인 규칙):
    ⛔ chromium.launch() 절대 금지 — Akamai Bot Manager 탐지
    ⛔ context.new_page() 절대 금지 — Keycloak OAuth2 토큰 소실
    ✅ connect_over_cdp() → context.pages[0] 재사용만 허용
    ⚠ Bootstrap 모달 좀비 — .modal-backdrop 잔존 시 JS로 강제 제거
    ⚠ SPA 내부 라우팅 — page.goto() 실패 시 location.replace() 폴백
"""

import argparse
import sys
import os

# python/ 디렉토리를 sys.path에 추가하여 common 패키지 import 가능하게 함
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.ipc import send_log, send_error, send_progress
from common.browser import (
    create_cdp_connection,
    get_existing_page,
    check_session_and_log,
)
from common.login import (
    is_session_valid,
    is_on_login_page,
    is_on_password_change_page,
    do_login,
    ensure_logged_in,
    get_credentials,
    _handle_password_change_modal,
    SESSION_VALID_DOMAIN,
    LOGIN_NAVIGATION_TIMEOUT,
)


# ─── Bootstrap 모달 좀비 제거 ─────────────────────────────────────
# 쿠팡 사이트 함정: .modal-backdrop이 잔존하여 클릭 차단
REMOVE_MODAL_BACKDROP_JS = """
() => {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
    return backdrops.length;
}
"""


def _clean_modal_backdrops(page) -> int:
    """
    Bootstrap 모달 좀비(.modal-backdrop)를 JS로 강제 제거한다.

    쿠팡 사이트에서 모달을 닫아도 .modal-backdrop이 남아
    페이지 전체 클릭이 차단되는 함정이 있다.

    Returns:
        제거한 backdrop 수
    """
    try:
        count = page.evaluate(REMOVE_MODAL_BACKDROP_JS)
        if count and count > 0:
            send_log(f"모달 좀비 제거: {count}개 .modal-backdrop 삭제됨")
        return count or 0
    except Exception as exc:
        send_log(f"모달 좀비 제거 시도 중 에러 (무시): {exc}")
        return 0


def _safe_url_for_js(url: str) -> str:
    """URL을 JavaScript 문자열 리터럴에 안전하게 삽입할 수 있도록 이스케이프한다."""
    # 허용: http/https 프로토콜만 (javascript:, data: 등 차단)
    if not url.startswith(("https://", "http://")):
        raise ValueError(f"허용되지 않는 URL 프로토콜: {url}")
    # JS 문자열 인젝션 방지: 따옴표 및 역슬래시 이스케이프
    return url.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')


def _navigate_to_target(page, target_url: str) -> bool:
    """
    로그인 성공 후 target URL로 이동한다.

    SPA 내부 라우팅 함정 대응:
        1. page.goto() 시도
        2. 실패 시 location.replace() 폴백

    Args:
        page: Playwright Page
        target_url: 이동 대상 URL

    Returns:
        True — 이동 성공
        False — 이동 실패
    """
    # URL 프로토콜 검증 (XSS 방지)
    if not target_url.startswith(("https://", "http://")):
        send_error(f"허용되지 않는 URL: {target_url} (https/http만 허용)")
        return False

    current = page.url
    # 이미 해당 URL에 있으면 스킵
    if current.rstrip("/") == target_url.rstrip("/"):
        send_log(f"이미 대상 URL에 있습니다: {current}")
        return True

    send_log(f"대상 URL로 이동: {target_url}")
    try:
        page.goto(target_url, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_log(f"page.goto() 실패 ({exc}) → location.replace() 폴백")
        try:
            safe_url = _safe_url_for_js(target_url)
            page.evaluate(f"() => window.location.replace('{safe_url}')")
            page.wait_for_load_state("domcontentloaded", timeout=LOGIN_NAVIGATION_TIMEOUT)
        except Exception as exc2:
            send_error(f"URL 이동 최종 실패: {exc2}")
            return False

    # 이동 후 안정화 대기
    page.wait_for_timeout(1500)

    # 모달 좀비 제거
    _clean_modal_backdrops(page)

    return True


def _force_relogin(page, vendor_id: str) -> bool:
    """
    강제 재로그인: 현재 세션을 무시하고 로그아웃 후 재로그인.

    단계:
        1. Keycloak 로그아웃 URL로 이동 (세션 무효화)
        2. 리다이렉트된 로그인 페이지에서 재로그인

    Args:
        page: Playwright Page
        vendor_id: 벤더 식별자

    Returns:
        True — 재로그인 성공
        False — 실패
    """
    send_log("강제 재로그인 요청")

    # supplier.coupang.com에 접속 중이면 → Keycloak 세션 만료를 위해
    # supplier.coupang.com/logout 또는 직접 쿠키 삭제 후 reload
    try:
        # 쿠키 기반 세션 무효화: supplier 사이트 쿠키 삭제
        page.evaluate("""
        () => {
            document.cookie.split(';').forEach(c => {
                const name = c.trim().split('=')[0];
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
            });
        }
        """)
        send_log("브라우저 쿠키 삭제 완료")
    except Exception as exc:
        send_log(f"쿠키 삭제 중 에러 (계속 진행): {exc}")

    # supplier.coupang.com으로 이동 → Keycloak 로그인 페이지로 리다이렉트 예상
    target = "https://supplier.coupang.com"
    try:
        page.goto(target, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception:
        try:
            safe_target = _safe_url_for_js(target)
            page.evaluate(f"() => window.location.replace('{safe_target}')")
            page.wait_for_load_state("domcontentloaded", timeout=LOGIN_NAVIGATION_TIMEOUT)
        except Exception as exc:
            send_error(f"강제 재로그인 이동 실패: {exc}")
            return False

    page.wait_for_timeout(2000)

    # Keycloak 로그인 페이지에 도달했는지 확인
    if is_on_login_page(page):
        send_log("Keycloak 로그인 페이지 도달 — 재로그인 진행")
        return do_login(page, vendor_id)

    # 쿠키 삭제로도 세션이 유지된 경우 (서버 측 세션)
    if is_session_valid(page):
        send_log("세션이 여전히 유효합니다 (서버 측 세션 유지). 강제 재로그인 불필요.")
        return True

    # 비밀번호 변경 페이지
    if is_on_password_change_page(page):
        _handle_password_change_modal(page)
        if is_session_valid(page):
            return True

    send_error(f"강제 재로그인 실패. 현재 URL: {page.url}")
    return False


def parse_args():
    """커맨드라인 인자를 파싱한다."""
    parser = argparse.ArgumentParser(
        description="쿠팡 서플라이어 Keycloak 로그인 자동화"
    )
    parser.add_argument(
        "--vendor",
        required=True,
        help="벤더 식별자 (예: basic, canon)"
    )
    parser.add_argument(
        "--url",
        default=None,
        help="로그인 후 이동할 URL (기본: supplier.coupang.com 메인)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="세션 유효해도 강제 재로그인"
    )
    return parser.parse_args()


def main():
    args = parse_args()
    vendor_id = args.vendor.strip().lower()
    target_url = args.url
    force = args.force

    # --url 인자 보안 검증: https/http 프로토콜만 허용
    if target_url and not target_url.startswith(("https://", "http://")):
        send_error(f"허용되지 않는 URL 프로토콜: {target_url} (https/http만 허용)")
        sys.exit(1)

    send_log("=" * 60)
    send_log(f"login.py — Keycloak 로그인 자동화")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  대상 URL: {target_url or '(기본 — supplier.coupang.com)'}")
    send_log(f"  강제 재로그인: {force}")
    send_log("=" * 60)

    # ── 1. 자격증명 사전 검증 (CDP 연결 전에 확인하여 빠른 실패) ──
    send_progress(5, "자격증명 확인 중")
    try:
        username, _ = get_credentials(vendor_id)
        send_log(f"자격증명 확인 완료: {username[:3]}***")
    except SystemExit:
        # get_credentials가 send_error + sys.exit(1)을 호출하지만
        # 여기서 catch되므로 명시적으로 재종료
        sys.exit(1)

    # ── 2. CDP 엔드포인트 연결 ──
    send_progress(10, "CDP 연결 중")
    cdp_endpoint = os.environ.get("CDP_ENDPOINT")
    if not cdp_endpoint:
        send_error(
            "CDP_ENDPOINT 환경변수가 설정되지 않았습니다. "
            "Electron 앱에서 python:run으로 실행하세요."
        )
        sys.exit(1)

    send_log(f"CDP_ENDPOINT: {cdp_endpoint}")

    conn = None
    try:
        conn = create_cdp_connection(cdp_endpoint)
    except Exception as exc:
        send_error(f"CDP 연결 실패: {exc}")
        sys.exit(1)

    send_progress(20, "CDP 연결 성공")

    try:
        # ── 3. 기존 페이지(탭) 획득 ──
        send_progress(25, "기존 페이지 획득 중")
        page = get_existing_page(conn.browser)
        send_log(f"현재 URL: {page.url}")

        # ── 4. 모달 좀비 사전 정리 ──
        _clean_modal_backdrops(page)

        # ── 5. 현재 세션 상태 확인 ──
        send_progress(30, "세션 상태 확인 중")
        check_session_and_log(page)

        # ── 6. 로그인 로직 ──
        login_success = False

        if force:
            # 강제 재로그인
            send_progress(40, "강제 재로그인 진행")
            login_success = _force_relogin(page, vendor_id)
        else:
            # 일반 흐름: 세션 유효하면 스킵, 무효하면 로그인
            send_progress(40, "로그인 보장 중")
            login_success = ensure_logged_in(page, vendor_id)

        if not login_success:
            send_error("로그인 실패. 종료합니다.")
            sys.exit(1)

        send_progress(80, "로그인 성공")

        # ── 7. 로그인 후 모달 좀비 재정리 ──
        _clean_modal_backdrops(page)

        # ── 8. target URL 이동 (지정된 경우) ──
        if target_url:
            send_progress(85, f"대상 URL 이동: {target_url}")
            nav_success = _navigate_to_target(page, target_url)

            if not nav_success:
                send_error(f"대상 URL 이동 실패: {target_url}")
                # 이동 실패해도 로그인 자체는 성공 → exit 1은 아님
                # 다만 세션은 유효한지 재확인
                if not is_session_valid(page):
                    send_error("URL 이동 후 세션이 무효해졌습니다.")
                    sys.exit(1)

            # 이동 후 세션 유효 재확인
            if not is_session_valid(page):
                send_log("대상 URL 이동 후 세션 만료 감지 → 재로그인 시도")
                relogin_ok = ensure_logged_in(page, vendor_id)
                if not relogin_ok:
                    send_error("재로그인 실패. 종료합니다.")
                    sys.exit(1)

                # 재로그인 후 다시 target URL 이동
                if target_url:
                    _navigate_to_target(page, target_url)

        # ── 9. 최종 상태 확인 및 로그 ──
        send_progress(95, "최종 상태 확인")
        final_valid = check_session_and_log(page)

        send_log("=" * 60)
        if final_valid:
            send_progress(100, "로그인 완료")
            send_log(f"[Login Complete] vendor={vendor_id}, URL={page.url}")
            send_log("login.py 정상 종료")
        else:
            send_error(
                f"최종 세션 상태가 무효합니다. URL: {page.url}. "
                "수동 확인이 필요합니다."
            )
            # 로그인 자체는 성공했으나 최종 URL이 예상과 다른 경우
            # → exit 0 (로그인은 완료됨)
            send_log("login.py 종료 (경고 있음)")
        send_log("=" * 60)

    finally:
        # ── 10. CDP 연결 정리 (브라우저 자체는 종료하지 않음) ──
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
