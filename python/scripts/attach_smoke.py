"""
attach_smoke.py — CDP attach 스모크 테스트

Electron이 노출한 --remote-debugging-port에 Playwright로 연결하여
기본 동작을 검증한다.

검증 항목:
    1. CDP 엔드포인트 연결 (connect_over_cdp)
    2. 기존 페이지(탭) 재사용
    3. 현재 URL 확인 및 로그 출력
    4. 세션 유효 여부 판단 (supplier.coupang.com 기반)
    5. 정상 종료 (exit 0)

실행 방법:
    # Electron 앱에서 (python:run IPC로 실행)
    #   → CDP_ENDPOINT 환경변수가 자동 설정됨
    # 또는 직접 실행:
    CDP_ENDPOINT=http://127.0.0.1:9222 python scripts/attach_smoke.py

로그 포맷:
    [Session Valid: {True/False}] Current URL: {url}
"""

import sys
import os

# python/ 디렉토리를 sys.path에 추가하여 common 패키지 import 가능하게 함
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.ipc import send_log, send_error, send_progress
from common.browser import (
    create_cdp_connection,
    get_existing_page,
    is_session_valid,
    check_session_and_log,
)


def main():
    send_log("=" * 50)
    send_log("attach_smoke.py — CDP attach 스모크 테스트")
    send_log("=" * 50)

    # ── 1. CDP 엔드포인트 확인 ──
    cdp_endpoint = os.environ.get("CDP_ENDPOINT")
    if not cdp_endpoint:
        send_error("CDP_ENDPOINT 환경변수가 설정되지 않았습니다.")
        send_error("Electron 앱에서 실행하거나 CDP_ENDPOINT를 수동 설정하세요.")
        sys.exit(1)

    send_log(f"CDP_ENDPOINT: {cdp_endpoint}")
    send_progress(10, "CDP 엔드포인트 확인 완료")

    # ── 2. CDP 연결 (connect_over_cdp) ──
    conn = None
    try:
        conn = create_cdp_connection(cdp_endpoint)
        send_progress(40, "CDP 연결 성공")
    except Exception as exc:
        send_error(f"CDP 연결 실패: {exc}")
        sys.exit(1)

    try:
        # ── 3. 기존 페이지 재사용 ──
        page = get_existing_page(conn.browser)
        send_progress(60, "기존 페이지 획득 완료")

        # ── 4. 현재 URL 확인 ──
        current_url = page.url
        send_log(f"현재 URL: {current_url}")
        send_progress(80, "URL 확인 완료")

        # ── 5. 세션 유효 여부 판단 및 규정 포맷 로그 출력 ──
        valid = check_session_and_log(page)

        if valid:
            send_log("세션이 유효합니다. 자동화 작업을 진행할 수 있습니다.")
        else:
            send_error(
                "세션이 유효하지 않습니다. "
                "supplier.coupang.com에 로그인되어 있는지 확인하세요."
            )

        send_progress(100, "스모크 테스트 완료")

    finally:
        # ── 6. 정상 종료 (연결 정리) ──
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    send_log("=" * 50)
    send_log("attach_smoke.py 종료 — 모든 검증 항목 실행 완료")
    send_log("=" * 50)

    sys.exit(0)


if __name__ == "__main__":
    main()
