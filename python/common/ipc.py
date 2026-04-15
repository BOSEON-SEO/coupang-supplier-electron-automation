"""
JSON-line IPC 헬퍼

Electron Main process와 Python subprocess 사이의 통신 프로토콜.
stdout으로 JSON-line을 출력하면 Main process의 ipc-handlers.js가 파싱하여
Renderer에 python:log / python:error 이벤트로 전달한다.

프로토콜 형식:
    {"type": "log",   "data": "메시지"}     → python:log 채널
    {"type": "error", "data": "에러 메시지"} → python:error 채널

사용 예:
    from common.ipc import send_log, send_error, send_progress, receive_env

    send_log("작업 시작")
    send_progress(50, "절반 완료")
    send_error("문제 발생")

    data_dir = receive_env("COUPANG_DATA_DIR")
"""

import json
import io
import os
import sys
from typing import Any, Optional

# Windows에서 cp949 인코딩 에러 방지: stdout을 UTF-8로 강제 설정
# Electron의 child_process는 stdout을 바이트 스트림으로 읽으므로 UTF-8이 안전
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def send(data: dict) -> None:
    """
    임의의 dict를 JSON-line으로 stdout에 출력한다.
    dict에는 반드시 'type' 키가 포함되어야 한다.
    """
    if "type" not in data:
        data["type"] = "log"
    line = json.dumps(data, ensure_ascii=False)
    print(line, flush=True)


def send_log(message: str, **extra: Any) -> None:
    """일반 로그 메시지를 전송한다."""
    payload = {"type": "log", "data": message}
    if extra:
        payload["extra"] = extra
    send(payload)


def send_error(message: str, **extra: Any) -> None:
    """에러 메시지를 전송한다 (Renderer에서 빨간색으로 표시)."""
    payload = {"type": "error", "data": message}
    if extra:
        payload["extra"] = extra
    send(payload)


def send_progress(percent: int, message: str = "") -> None:
    """진행률을 전송한다 (0–100)."""
    send({
        "type": "log",
        "data": message or f"진행률: {percent}%",
        "progress": max(0, min(100, percent)),
    })


def receive_env(key: str, default: Optional[str] = None) -> Optional[str]:
    """
    환경변수에서 값을 읽는다.
    Main process가 spawn 시 설정한 환경변수 (예: COUPANG_DATA_DIR)를 가져온다.
    """
    return os.environ.get(key, default)


def receive_stdin_line() -> Optional[str]:
    """
    stdin에서 한 줄을 읽는다 (향후 Main → Python 양방향 통신용).
    현재는 사용하지 않지만 확장성을 위해 준비.
    블로킹 호출이므로 별도 스레드에서 사용 권장.
    """
    try:
        line = sys.stdin.readline()
        if not line:
            return None
        return line.strip()
    except EOFError:
        return None
