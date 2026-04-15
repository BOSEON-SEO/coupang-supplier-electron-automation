"""
CDP 브라우저 연결 및 세션 관리

Electron이 --remote-debugging-port로 노출한 Chromium에
Playwright가 connect_over_cdp로 attach하는 유틸리티.

핵심 규칙:
    ✅ connect_over_cdp() — 유일한 허용된 연결 방식
    ✅ context.pages[0]   — 기존 탭 재사용 필수
    ⛔ chromium.launch()  — Akamai Bot Manager 탐지됨
    ⛔ context.new_page() — Keycloak OAuth2 토큰 소실

사용 예:
    from common.browser import create_cdp_connection, get_existing_page, is_session_valid

    conn = create_cdp_connection("http://127.0.0.1:9222")
    page = get_existing_page(conn.browser)
    valid = is_session_valid(page)
    conn.close()
"""

import os
import sys
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

from common.ipc import send_log, send_error


# ─── CDP 엔드포인트 환경변수 키 ───────────────────────────────────
CDP_ENDPOINT_ENV = "CDP_ENDPOINT"

# ─── 세션 유효 판단 기준 도메인 ───────────────────────────────────
SESSION_VALID_DOMAIN = "supplier.coupang.com"


# ─── launch() 차단 monkey-patch ──────────────────────────────────
_launch_guard_installed = False


def _install_launch_guard():
    """
    playwright.sync_api.BrowserType.launch 를 런타임에서 차단한다.
    Akamai Bot Manager 탐지를 방지하기 위해 launch()는 절대 호출하면 안 된다.
    """
    global _launch_guard_installed
    if _launch_guard_installed:
        return
    try:
        from playwright.sync_api import BrowserType

        _original_launch = BrowserType.launch

        def _blocked_launch(self, *args, **kwargs):
            raise RuntimeError(
                "chromium.launch() 호출 금지: "
                "Akamai Bot Manager에 탐지됩니다. "
                "반드시 connect_over_cdp()를 사용하세요."
            )

        BrowserType.launch = _blocked_launch
        _launch_guard_installed = True
    except ImportError:
        # playwright 미설치 시 guard 스킵 (hello.py 등에서 import만 할 때)
        pass


# ─── new_page() 차단 monkey-patch ────────────────────────────────
_new_page_guard_installed = False


def _install_new_page_guard():
    """
    playwright.sync_api.BrowserContext.new_page 를 런타임에서 차단한다.
    Keycloak OAuth2 SPA에서 access_token이 JS 메모리에만 존재하므로
    새 탭을 열면 토큰이 소실된다.
    """
    global _new_page_guard_installed
    if _new_page_guard_installed:
        return
    try:
        from playwright.sync_api import BrowserContext

        _original_new_page = BrowserContext.new_page

        def _blocked_new_page(self, *args, **kwargs):
            raise RuntimeError(
                "context.new_page() 호출 금지: "
                "Keycloak OAuth2 토큰이 소실됩니다. "
                "반드시 context.pages[0]을 재사용하세요."
            )

        BrowserContext.new_page = _blocked_new_page
        _new_page_guard_installed = True
    except ImportError:
        pass


# ─── 모듈 로드 시 가드 자동 설치 ─────────────────────────────────
_install_launch_guard()
_install_new_page_guard()


# ─── CDP 연결 래퍼 ───────────────────────────────────────────────
@dataclass
class CdpConnection:
    """CDP 연결 상태를 보관하는 컨테이너."""
    playwright: object
    browser: object
    endpoint: str

    def close(self):
        """Playwright 연결을 정리한다 (브라우저 자체는 종료하지 않음)."""
        try:
            self.browser.close()
        except Exception:
            pass
        try:
            self.playwright.stop()
        except Exception:
            pass


def get_cdp_endpoint() -> str:
    """
    CDP 엔드포인트를 환경변수에서 가져온다.

    Electron Main process가 python:run 실행 시 CDP_ENDPOINT 환경변수를
    설정해야 한다. 미설정 시 에러 로그를 출력하고 프로세스를 종료한다.

    Returns:
        HTTP URL 문자열 (예: "http://127.0.0.1:9222")
    """
    endpoint = os.environ.get(CDP_ENDPOINT_ENV)
    if not endpoint:
        send_error(
            f"{CDP_ENDPOINT_ENV} 환경변수 미설정. "
            "Electron 앱에서 python:run으로 실행하세요."
        )
        sys.exit(1)
    return endpoint


def create_cdp_connection(endpoint: Optional[str] = None) -> CdpConnection:
    """
    CDP 엔드포인트에 Playwright로 attach한다.

    ✅ chromium.connect_over_cdp() — 유일한 허용 방식
    ⛔ chromium.launch() — 런타임 차단됨 (위 guard 참조)

    Args:
        endpoint: CDP HTTP 엔드포인트.
                  None이면 CDP_ENDPOINT 환경변수에서 자동 조회.

    Returns:
        CdpConnection 인스턴스 (playwright, browser, endpoint 포함)

    Raises:
        SystemExit: CDP_ENDPOINT 미설정 시
        playwright 연결 오류 시 send_error 후 raise
    """
    from playwright.sync_api import sync_playwright

    ep = endpoint or get_cdp_endpoint()
    send_log(f"CDP 연결 시도: {ep}")

    pw = sync_playwright().start()
    try:
        browser = pw.chromium.connect_over_cdp(ep)
    except Exception as exc:
        pw.stop()
        send_error(f"CDP 연결 실패: {exc}")
        raise

    ctx_count = len(browser.contexts)
    page_count = sum(len(c.pages) for c in browser.contexts)
    send_log(
        f"CDP 연결 성공 — contexts: {ctx_count}, pages: {page_count}"
    )
    return CdpConnection(playwright=pw, browser=browser, endpoint=ep)


def get_existing_page(browser, context_index: int = 0, page_index: int = 0):
    """
    기존 컨텍스트의 기존 페이지를 반환한다.

    Keycloak OAuth2 SPA에서 access_token이 JS 메모리에만 존재하므로
    반드시 기존 페이지를 재사용해야 한다.

    ⛔ context.new_page() — 런타임 차단됨

    Args:
        browser:       CDP로 연결된 Playwright Browser
        context_index: BrowserContext 인덱스 (기본 0)
        page_index:    Page 인덱스 (기본 0)

    Returns:
        Page 인스턴스

    Raises:
        SystemExit: context 또는 page가 없을 때
    """
    contexts = browser.contexts
    if not contexts:
        send_error(
            "BrowserContext가 없습니다. "
            "Electron BrowserView가 로드되지 않았습니다."
        )
        sys.exit(1)

    if context_index >= len(contexts):
        send_error(
            f"Context 인덱스 {context_index} 초과 (총 {len(contexts)}개)"
        )
        sys.exit(1)

    context = contexts[context_index]
    pages = context.pages

    if not pages:
        send_error(
            "열린 페이지가 없습니다. "
            "BrowserView에서 페이지를 먼저 로드하세요."
        )
        sys.exit(1)

    if page_index >= len(pages):
        send_error(
            f"Page 인덱스 {page_index} 초과 (총 {len(pages)}개)"
        )
        sys.exit(1)

    page = pages[page_index]
    send_log(f"기존 페이지 재사용: {page.url}")
    return page


# ─── URL 기반 페이지 탐색 ─────────────────────────────────────────
def find_vendor_page(browser):
    """
    CDP로 연결된 브라우저에서 쿠팡 관련 페이지를 URL 기반으로 찾는다.

    단일 CDP 포트에 여러 context(BrowserWindow + WebContentsView)가 존재할 때,
    인덱스 하드코딩 대신 URL 패턴으로 올바른 페이지를 식별한다.

    탐색 우선순위:
        1. supplier.coupang.com — 세션 유효 페이지
        2. login.coupang.com / sso.coupang.com — 로그인 필요
        3. coupang.com (기타 서브도메인) — 쿠팡 관련 페이지
        4. 첫 번째 non-devtools 페이지 — 폴백

    Args:
        browser: CDP로 연결된 Playwright Browser

    Returns:
        Page 인스턴스 또는 None (페이지 없음)
    """
    all_pages = []
    for ctx in browser.contexts:
        for page in ctx.pages:
            try:
                url = page.url
                all_pages.append((page, url))
            except Exception:
                continue

    if not all_pages:
        send_log("열린 페이지가 없습니다.")
        return None

    # 1순위: supplier.coupang.com
    for page, url in all_pages:
        if SESSION_VALID_DOMAIN in url:
            send_log(f"vendor 페이지 발견 (supplier): {url}")
            return page

    # 2순위: Keycloak 로그인 페이지
    keycloak_hosts = ["login.coupang.com", "sso.coupang.com", "xauth.coupang.com"]
    for page, url in all_pages:
        parsed = urlparse(url)
        if parsed.hostname in keycloak_hosts:
            send_log(f"vendor 페이지 발견 (keycloak): {url}")
            return page

    # 3순위: coupang.com 도메인
    for page, url in all_pages:
        if "coupang.com" in url:
            send_log(f"vendor 페이지 발견 (coupang): {url}")
            return page

    # 4순위: devtools가 아닌 첫 페이지
    for page, url in all_pages:
        if not url.startswith("devtools://"):
            send_log(f"vendor 페이지 폴백: {url}")
            return page

    send_log(f"적합한 페이지를 찾지 못함. 전체 {len(all_pages)}개 페이지.")
    return all_pages[0][0] if all_pages else None


# ─── 세션 유효 판단 ──────────────────────────────────────────────
def is_session_valid(page) -> bool:
    """
    현재 페이지의 URL을 기반으로 쿠팡 서플라이어 세션이 유효한지 판단한다.

    유효 기준: URL에 'supplier.coupang.com'이 포함되어 있으면 유효.
    로그인 페이지(Keycloak)로 리다이렉트되었으면 세션 만료로 판단.

    Args:
        page: Playwright Page 인스턴스

    Returns:
        True  — 세션 유효 (supplier.coupang.com에 접속 중)
        False — 세션 만료 또는 다른 페이지
    """
    try:
        current_url = page.url
    except Exception as exc:
        send_error(f"페이지 URL 조회 실패: {exc}")
        return False

    parsed = urlparse(current_url)
    host = parsed.hostname or ""
    valid = SESSION_VALID_DOMAIN in host

    return valid


def check_session_and_log(page) -> bool:
    """
    세션 유효 여부를 확인하고 규정 포맷으로 로그를 출력한다.

    로그 포맷: '[Session Valid: {True/False}] Current URL: {url}'

    Args:
        page: Playwright Page 인스턴스

    Returns:
        세션 유효 여부 (bool)
    """
    try:
        current_url = page.url
    except Exception:
        current_url = "<unknown>"

    valid = is_session_valid(page)
    send_log(f"[Session Valid: {valid}] Current URL: {current_url}")
    return valid
