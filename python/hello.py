"""
hello.py — Python 자동화 환경 검증 스크립트

Electron → Python subprocess 브릿지가 정상 작동하는지 확인한다.
검증 항목:
  1. JSON-line IPC 프로토콜 (common.ipc 모듈)
  2. playwright 패키지 import 가능 여부
  3. 환경변수(COUPANG_DATA_DIR) 수신 확인
  4. Python 버전 정보

실행:
  python hello.py
  또는 Electron 앱에서 ▶ Python 실행 버튼
"""

import sys
import platform

# ── 1. common.ipc 모듈 import 확인 ──
try:
    from common.ipc import send_log, send_error, send_progress, receive_env
    send_log("common.ipc 모듈 로드 성공")
except ImportError as e:
    # common.ipc가 없으면 fallback으로 직접 JSON 출력
    import json

    def send_log(msg):
        print(json.dumps({"type": "log", "data": msg}), flush=True)

    def send_error(msg):
        print(json.dumps({"type": "error", "data": msg}), flush=True)

    def send_progress(pct, msg=""):
        print(json.dumps({"type": "log", "data": msg or f"진행률: {pct}%", "progress": pct}), flush=True)

    def receive_env(key, default=None):
        import os
        return os.environ.get(key, default)

    send_error(f"common.ipc import 실패: {e}")


def main():
    send_log("=" * 50)
    send_log("hello.py — Python 자동화 환경 검증")
    send_log("=" * 50)

    # ── 2. Python 버전 정보 ──
    send_log(f"Python 버전: {sys.version}")
    send_log(f"플랫폼: {platform.platform()}")
    send_log(f"실행 파일: {sys.executable}")

    send_progress(25, "기본 환경 확인 완료")

    # ── 3. 환경변수 확인 ──
    data_dir = receive_env("COUPANG_DATA_DIR")
    if data_dir:
        send_log(f"COUPANG_DATA_DIR: {data_dir}")
    else:
        send_error("COUPANG_DATA_DIR 환경변수 미설정 (Electron에서 실행 시 자동 설정됨)")

    send_progress(50, "환경변수 확인 완료")

    # ── 4. playwright import 확인 ──
    try:
        from playwright.sync_api import sync_playwright
        send_log("playwright.sync_api import 성공")

        # 버전 확인
        try:
            import playwright
            pw_version = getattr(playwright, '__version__', 'unknown')
            send_log(f"playwright 버전: {pw_version}")
        except Exception:
            send_log("playwright 버전 확인 불가 (import는 성공)")

        send_progress(75, "playwright 확인 완료")

    except ImportError as e:
        send_error(f"playwright import 실패: {e}")
        send_error("설치 방법: pip install playwright==1.40.0 && playwright install chromium")
        send_progress(75, "playwright 미설치 — 설치 필요")

    # ── 5. 완료 ──
    send_progress(100, "환경 검증 완료")
    send_log("=" * 50)
    send_log("hello.py 종료 — 모든 검증 항목 실행 완료")
    send_log("=" * 50)

    sys.exit(0)


if __name__ == "__main__":
    main()
