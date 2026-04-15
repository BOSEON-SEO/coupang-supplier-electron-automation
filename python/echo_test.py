"""
테스트용 Python 스크립트.
JSON-line 프로토콜과 일반 텍스트 출력을 모두 검증한다.

사용법:
  python echo_test.py [--delay SECONDS] [--fail]
"""
import json
import sys
import time
import argparse


def emit(msg_type, data):
    """JSON-line 프로토콜로 stdout에 메시지 출력"""
    print(json.dumps({"type": msg_type, "data": data}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--delay', type=float, default=0.1, help='각 메시지 간 대기 시간(초)')
    parser.add_argument('--fail', action='store_true', help='의도적 에러 종료')
    parser.add_argument('--steps', type=int, default=5, help='출력할 메시지 수')
    args = parser.parse_args()

    emit("log", "echo_test 시작")

    for i in range(1, args.steps + 1):
        time.sleep(args.delay)
        emit("log", f"스텝 {i}/{args.steps} 처리 중...")

    # 일반 텍스트(비-JSON) 출력도 테스트
    print("이것은 일반 텍스트 출력입니다.", flush=True)

    if args.fail:
        emit("error", "의도적 에러 발생")
        print("에러 디테일: 테스트 실패 시나리오", file=sys.stderr, flush=True)
        sys.exit(1)

    emit("log", "echo_test 완료")
    sys.exit(0)


if __name__ == "__main__":
    main()
