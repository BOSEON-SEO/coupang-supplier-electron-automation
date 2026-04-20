"""
po_upload.py — 발주 확정 파일 업로드 준비 (업로드 직전 정지 버전)

쿠팡 서플라이어 허브의 /scm/purchase/upload/form 페이지에서
발주 확정 파일 업로드 폼을 준비한다. **#btn-upload-execute 는 절대 클릭하지
않는다** — 사용자가 웹 뷰에서 직접 눈으로 확인한 뒤 수동 클릭하도록 둔다.

흐름:
    1. CDP attach → 기존 페이지 재사용
    2. 로그인 보장 (ensure_logged_in)
    3. /scm/purchase/upload/form 로 직접 이동
    4. #btn-upload-show 클릭 → 약관 모달 열림
    5. input[name="checkAgreeAll"] 토글 (display:none 이라 JS 강제)
    6. input[name="uploadFile"] 에 파일 주입
    7. 여기서 정지 (사용자가 수동으로 #btn-upload-execute 클릭)

실행 환경 (Electron Main 이 python:run 에서 자동 설정):
    CDP_ENDPOINT        — CDP 디버깅 엔드포인트
    COUPANG_DATA_DIR    — 작업 폴더 루트 (job 경로 해석용)
    COUPANG_ID_{VENDOR} / COUPANG_PW_{VENDOR}

인자:
    --vendor  <vendor_id>         벤더 식별자 (필수)
    --date    <YYYY-MM-DD>        작업 날짜 (필수)
    --sequence <NN>               작업 차수 (필수, 1-99)
    --file    <path>              업로드할 파일 (선택, 기본: job 폴더 confirmation.xlsx)
    --skip-login                  로그인 단계 건너뛰기 (오프라인 테스트)
    --base-url <URL>              기본 URL (오프라인 테스트)

종료 코드:
    0 — 업로드 폼 준비 성공 (사용자 수동 클릭 대기)
    1 — 실패
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.ipc import send_log, send_error, send_progress, send
from common.browser import (
    create_cdp_connection,
    get_existing_page,
    find_vendor_page,
    check_session_and_log,
)
from common.login import (
    ensure_logged_in,
    is_session_valid,
    LOGIN_NAVIGATION_TIMEOUT,
)


# ─── 상수 ────────────────────────────────────────────────────────

UPLOAD_LIST_PATH = "/scm/purchase/upload/list"

# 버튼/셀렉터
SEL_BTN_UPLOAD_SHOW = "#btn-upload-show"
SEL_CHECK_AGREE_ALL = 'input[name="checkAgreeAll"]'
SEL_CHECK_AGREE = 'input[name="checkAgree"]'
SEL_FILE_INPUT = 'input[name="uploadFile"]'
SEL_BTN_UPLOAD_EXECUTE = "#btn-upload-execute"  # ⚠ 절대 클릭하지 않음

# 타임아웃
PAGE_LOAD_WAIT_MS = 3000
BUTTON_TIMEOUT_MS = 15_000

# Bootstrap 모달 좀비 제거 (po_download.py 와 동일 패턴)
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

_config = {
    "base_url": "https://supplier.coupang.com",
    "skip_login": False,
}


def _step_log(step: str, status: str, message: str = "") -> None:
    text = f"[STEP:{step}:{status}]"
    if message:
        text += f" {message}"
    send_log(text)


def _clean_modal_backdrops(page) -> None:
    try:
        count = page.evaluate(REMOVE_MODAL_BACKDROP_JS)
        if count and count > 0:
            send_log(f"모달 좀비 제거: {count}개")
    except Exception:
        pass


def _safe_url_for_js(url: str) -> str:
    if not url.startswith(("https://", "http://")):
        raise ValueError(f"허용되지 않는 URL: {url}")
    return url.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')


def _build_upload_list_url(date_from: str, date_to: str) -> str:
    """
    업로드 리스트 URL + 날짜 query.
    실제 관찰된 URL 패턴:
      /scm/purchase/upload/list?page=1&size=10
        &searchStartDate=YYYY-MM-DD&searchEndDate=YYYY-MM-DD
        &jobId=&requestId=
    """
    base = _config["base_url"]
    qs = (
        "page=1&size=10"
        f"&searchStartDate={date_from}"
        f"&searchEndDate={date_to}"
        "&jobId=&requestId="
    )
    return f"{base}{UPLOAD_LIST_PATH}?{qs}"


def _navigate_to_upload_form(page, date_from: str, date_to: str) -> bool:
    """
    /scm/purchase/upload/list?필터… 로 이동.
    SPA 내부 라우팅 함정 대비 — goto 실패 시 location.replace 폴백.
    """
    url = _build_upload_list_url(date_from, date_to)
    send_log(f"업로드 리스트 페이지로 이동: {url}")
    try:
        page.goto(url, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_log(f"page.goto 실패 ({exc}) → location.replace 폴백")
        try:
            safe = _safe_url_for_js(url)
            page.evaluate(f"() => window.location.replace('{safe}')")
            page.wait_for_load_state("domcontentloaded", timeout=LOGIN_NAVIGATION_TIMEOUT)
        except Exception as exc2:
            send_error(f"업로드 폼 페이지 이동 실패: {exc2}")
            return False

    page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
    _clean_modal_backdrops(page)

    if UPLOAD_LIST_PATH in page.url:
        send_log(f"업로드 리스트 페이지 도달: {page.url}")
        return True

    if not _config["skip_login"] and not is_session_valid(page):
        send_error(f"세션 만료 — 현재 URL: {page.url}")
        return False

    send_log(f"URL 확인 불확실하지만 계속 진행: {page.url}")
    return True


def _click_upload_show(page) -> bool:
    """#btn-upload-show 클릭 → 약관 모달 열기."""
    try:
        page.wait_for_selector(SEL_BTN_UPLOAD_SHOW, state="visible", timeout=BUTTON_TIMEOUT_MS)
        page.locator(SEL_BTN_UPLOAD_SHOW).click(timeout=BUTTON_TIMEOUT_MS)
        send_log(f"{SEL_BTN_UPLOAD_SHOW} 클릭 — 약관 모달 오픈")
        # 모달 fade-in 대기
        page.wait_for_timeout(800)
        return True
    except Exception as exc:
        send_error(f"{SEL_BTN_UPLOAD_SHOW} 클릭 실패: {exc}")
        return False


def _toggle_agree_all(page) -> bool:
    """
    약관 전체 동의 체크박스 토글.
    native input 이 display:none 이라 다음 순서로 시도:
      1. label:has(input[name="checkAgreeAll"]) 클릭
      2. force click
      3. JS 로 .checked = true + change 이벤트 발사
    이후 개별 checkAgree 도 보정.
    """
    try:
        agree = page.locator(SEL_CHECK_AGREE_ALL)
        agree.wait_for(state="attached", timeout=BUTTON_TIMEOUT_MS)

        clicked = False
        try:
            label = page.locator(f'label:has({SEL_CHECK_AGREE_ALL})')
            if label.count() > 0:
                label.first.click(timeout=2_000)
                clicked = True
                send_log("checkAgreeAll — label 클릭 성공")
        except Exception:
            pass

        if not clicked:
            try:
                agree.click(force=True, timeout=2_000)
                clicked = True
                send_log("checkAgreeAll — force click 성공")
            except Exception:
                pass

        try:
            is_checked = agree.is_checked()
        except Exception:
            is_checked = False

        if not clicked or not is_checked:
            page.evaluate(
                """
                () => {
                    const el = document.querySelector('input[name="checkAgreeAll"]');
                    if (el) {
                        el.checked = true;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                }
                """
            )
            send_log("checkAgreeAll — JS 강제 토글")

        # 개별 checkAgree 도 보정 (일부 환경에서 all 토글이 개별까지 전파 안 되는 케이스)
        page.evaluate(
            """
            () => {
                document.querySelectorAll('input[name="checkAgree"]').forEach(el => {
                    if (!el.checked) {
                        el.checked = true;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }
            """
        )
        send_log("개별 checkAgree 보정 완료")
        return True
    except Exception as exc:
        send_error(f"약관 동의 실패: {exc}")
        return False


def _inject_file(page, file_path: str) -> bool:
    """input[name="uploadFile"] 에 파일 주입."""
    try:
        file_input = page.locator(SEL_FILE_INPUT)
        file_input.wait_for(state="attached", timeout=BUTTON_TIMEOUT_MS)
        file_input.set_input_files(file_path)
        size = os.path.getsize(file_path)
        send_log(f"파일 주입 완료: {os.path.basename(file_path)} ({size} bytes)")
        return True
    except Exception as exc:
        send_error(f"파일 주입 실패: {exc}")
        return False


# ─── 메인 ────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="발주 확정 파일 업로드 준비")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--file", default=None,
                        help="업로드 파일 경로 (생략 시 job 폴더의 confirmation.xlsx)")
    parser.add_argument("--base-url", default="https://supplier.coupang.com")
    parser.add_argument("--skip-login", action="store_true")
    return parser.parse_args()


def _resolve_file(args) -> str:
    """--file 이 있으면 그대로, 없으면 job 폴더의 confirmation.xlsx."""
    if args.file:
        return args.file
    data_dir = os.environ.get("COUPANG_DATA_DIR")
    if not data_dir:
        send_error("COUPANG_DATA_DIR 미설정 — --file 로 경로 직접 지정 필요")
        sys.exit(1)
    return os.path.join(
        data_dir, args.date, args.vendor, f"{args.sequence:02d}", "confirmation.xlsx"
    )


def main():
    args = parse_args()
    _config["base_url"] = args.base_url
    _config["skip_login"] = args.skip_login
    vendor_id = args.vendor.strip().lower()

    file_path = _resolve_file(args)

    send_log("=" * 60)
    send_log("po_upload.py — 발주 확정 업로드 준비 (업로드 직전 정지)")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  작업: {args.date} · {args.sequence}차")
    send_log(f"  파일: {file_path}")
    send_log("=" * 60)

    if not os.path.exists(file_path):
        _step_log("FILE_CHECK", "FAIL", f"파일 없음: {file_path}")
        send_error(f"업로드할 파일이 없습니다: {file_path}")
        sys.exit(1)
    _step_log("FILE_CHECK", "OK", f"{os.path.basename(file_path)} ({os.path.getsize(file_path)} bytes)")

    # ── CDP 연결 ──
    _step_log("CDP_CONNECT", "START")
    send_progress(5, "CDP 연결 중")
    cdp_endpoint = os.environ.get("CDP_ENDPOINT")
    if not cdp_endpoint:
        _step_log("CDP_CONNECT", "FAIL", "CDP_ENDPOINT 미설정")
        send_error("CDP_ENDPOINT 환경변수 미설정")
        sys.exit(1)

    conn = None
    try:
        conn = create_cdp_connection(cdp_endpoint)
    except Exception as exc:
        _step_log("CDP_CONNECT", "FAIL", str(exc))
        send_error(f"CDP 연결 실패: {exc}")
        sys.exit(1)
    _step_log("CDP_CONNECT", "OK", cdp_endpoint)
    send_progress(15, "CDP 연결 성공")

    try:
        # ── 페이지 획득 ──
        page = find_vendor_page(conn.browser) or get_existing_page(conn.browser)
        _clean_modal_backdrops(page)
        _step_log("PAGE_ACQUIRE", "OK", page.url)

        # ── 로그인 보장 ──
        if _config["skip_login"]:
            _step_log("LOGIN", "SKIP")
        else:
            _step_log("LOGIN", "START")
            send_progress(25, "로그인 확인 중")
            if not ensure_logged_in(page, vendor_id):
                _step_log("LOGIN", "FAIL")
                send_error("로그인 실패")
                sys.exit(1)
            _step_log("LOGIN", "OK")
            check_session_and_log(page)

        # ── 업로드 폼 페이지 이동 (날짜 필터 포함) ──
        _step_log("NAVIGATE", "START", f"{UPLOAD_LIST_PATH} ({args.date})")
        send_progress(40, "업로드 폼으로 이동 중")
        if not _navigate_to_upload_form(page, args.date, args.date):
            _step_log("NAVIGATE", "FAIL")
            sys.exit(1)
        _step_log("NAVIGATE", "OK", page.url)

        # ── 업로드 모달 열기 ──
        _step_log("OPEN_MODAL", "START")
        send_progress(55, "약관 모달 오픈")
        if not _click_upload_show(page):
            _step_log("OPEN_MODAL", "FAIL")
            sys.exit(1)
        _step_log("OPEN_MODAL", "OK")

        # ── 약관 전체 동의 ──
        _step_log("AGREE", "START")
        send_progress(70, "약관 동의 처리")
        if not _toggle_agree_all(page):
            _step_log("AGREE", "FAIL")
            sys.exit(1)
        _step_log("AGREE", "OK")

        # ── 파일 주입 ──
        _step_log("FILE_INJECT", "START")
        send_progress(85, "파일 주입")
        if not _inject_file(page, file_path):
            _step_log("FILE_INJECT", "FAIL")
            sys.exit(1)
        _step_log("FILE_INJECT", "OK")

        # ── 여기서 정지 ──
        _step_log("READY_TO_SUBMIT", "OK",
                  "웹 뷰에서 직접 '업로드 실행' 버튼을 누르세요 (자동 클릭 하지 않음)")
        send_progress(100, "업로드 준비 완료 — 수동 확인/클릭 대기")

        result = {
            "success": True,
            "readyToSubmit": True,
            "vendor": vendor_id,
            "date": args.date,
            "sequence": args.sequence,
            "filePath": file_path,
            "finalUrl": page.url,
            "submitSelector": SEL_BTN_UPLOAD_EXECUTE,
            "note": "업로드 직전 정지 — 사용자가 웹 뷰에서 직접 '업로드 실행' 버튼 클릭",
        }
        send({"type": "result", "data": json.dumps(result, ensure_ascii=False)})
        send_log(f"[Upload Ready] {os.path.basename(file_path)} — 수동 클릭 대기")
        send_log("=" * 60)

    finally:
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
