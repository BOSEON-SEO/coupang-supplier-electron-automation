"""
shipment_docs_download.py — 쉽먼트 리스트의 Label + 내역서 일괄 다운로드

쿠팡 서플라이어 허브의 /ibs/asn/active 페이지에서 입고예정일(edd) 로 필터 후,
각 행의 두 버튼을 순차적으로 클릭해 파일을 다운로드한다:

    button[name="shipment-label"]     — Label
    button[name="shipment-manifest"]  — 내역서

SSR pagination 이므로 `.pagination a:text-is("N")` 로 다음 페이지 이동.
다운로드는 Electron main 의 will-download 훅 + SHIPMENT_DOWNLOAD_DIR 환경변수로
지정된 폴더에 suggested_filename 그대로 저장된다.

실행 환경:
    CDP_ENDPOINT
    COUPANG_DATA_DIR
    SHIPMENT_DOWNLOAD_DIR   — 파일이 저장될 절대 경로
    COUPANG_ID_{VENDOR}
    COUPANG_PW_{VENDOR}

인자:
    --vendor   <vendor_id>    벤더 식별자 (필수)
    --date     <YYYY-MM-DD>   입고예정일 (필수, #edd 필터)
    --sequence <NN>           작업 차수 (필수)
    --skip-login              로그인 단계 건너뛰기

종료 코드:
    0 — 성공 (행 0건이면 no_rows)
    1 — 실패
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.ipc import send_log, send_error, send_progress, send
from common.browser import (
    create_cdp_connection,
    get_existing_page,
    find_vendor_page,
    check_session_and_log,
)
from common.login import ensure_logged_in, LOGIN_NAVIGATION_TIMEOUT


# ─── 상수 ────────────────────────────────────────────────────────

SHIPMENT_LIST_PATH = "/ibs/asn/active"
SHIPMENT_LIST_URL = f"https://supplier.coupang.com{SHIPMENT_LIST_PATH}?type=parcel"

# 행 단위 버튼 — (selector name, 라벨)
BUTTON_SELECTORS = [
    ("shipment-label",    "Label"),
    ("shipment-manifest", "내역서"),
]

BUTTON_TIMEOUT_MS = 10_000
PER_BUTTON_WAIT_SEC = 30
DOWNLOAD_STABILITY_SEC = 2.0
DOWNLOAD_POLL_SEC = 0.5
INTER_CLICK_DELAY_SEC = 0.5
MAX_PAGES = 50  # 안전장치 — 예상 초과 시 루프 중단

_config = {"skip_login": False}


# ─── 유틸 ────────────────────────────────────────────────────────

def _step_log(step: str, status: str, message: str = "") -> None:
    text = f"[STEP:{step}:{status}]"
    if message:
        text += f" {message}"
    send_log(text)


def _snapshot_dir(dirpath: str) -> set:
    try:
        names = set()
        for name in os.listdir(dirpath):
            lower = name.lower()
            if lower.endswith((".crdownload", ".tmp", ".part")):
                continue
            p = os.path.join(dirpath, name)
            if os.path.isfile(p):
                names.add(name)
        return names
    except Exception:
        return set()


def _wait_for_new_stable_file(
    dirpath: str,
    baseline: set,
    *,
    timeout_sec: int = PER_BUTTON_WAIT_SEC,
    stability_sec: float = DOWNLOAD_STABILITY_SEC,
    poll_sec: float = DOWNLOAD_POLL_SEC,
) -> list[str]:
    """baseline 이후 새로 생긴 파일 중 size 가 안정된 것들을 반환."""
    deadline = time.time() + timeout_sec
    size_watch: dict[str, tuple[int, float]] = {}
    stable: set = set()

    while time.time() < deadline:
        now = time.time()
        try:
            current = os.listdir(dirpath)
        except FileNotFoundError:
            current = []

        for name in current:
            lower = name.lower()
            if lower.endswith((".crdownload", ".tmp", ".part")):
                continue
            if name in baseline:
                continue
            fpath = os.path.join(dirpath, name)
            try:
                st = os.stat(fpath)
            except FileNotFoundError:
                continue
            if not os.path.isfile(fpath):
                continue

            prev = size_watch.get(name)
            if prev is None or prev[0] != st.st_size:
                size_watch[name] = (st.st_size, now)
            elif (now - prev[1] >= stability_sec) and st.st_size > 0:
                if name not in stable:
                    stable.add(name)
                    send_log(f"  다운로드 완료: {name} ({st.st_size:,} bytes)")

        if stable and all(
            now - sw[1] >= stability_sec
            for sw in size_watch.values()
            if sw[0] > 0
        ):
            break

        time.sleep(poll_sec)

    return sorted(stable)


# ─── 페이지 조작 ───────────────────────────────────────────────────

def _navigate_to_list(page) -> bool:
    send_log(f"쉽먼트 리스트 페이지로 이동: {SHIPMENT_LIST_URL}")
    try:
        page.goto(SHIPMENT_LIST_URL, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_error(f"page.goto 실패: {exc}")
        return False
    page.wait_for_timeout(2_000)
    if SHIPMENT_LIST_PATH not in page.url:
        send_error(f"대상 경로에 도달하지 못함 — 현재 URL: {page.url}")
        return False
    return True


def _apply_edd_filter(page, date: str) -> bool:
    """입고예정일(#edd) 설정 + 검색 버튼 클릭."""
    try:
        page.locator("#edd").fill(date, timeout=5_000)
    except Exception as exc:
        send_error(f"#edd 입력 실패: {exc}")
        return False
    try:
        page.locator("#shipment-search-btn").click(timeout=BUTTON_TIMEOUT_MS)
    except Exception as exc:
        send_error(f"#shipment-search-btn 클릭 실패: {exc}")
        return False
    page.wait_for_timeout(2_000)
    send_log(f"edd={date} 필터 적용 완료")
    return True


def _register_dialog_auto_accept(page):
    def _accept(dialog):
        try:
            msg = (dialog.message or "")[:80]
        except Exception:
            msg = ""
        send_log(f"  dialog accepted: {msg!r}")
        try:
            dialog.accept()
        except Exception as exc:
            send_log(f"  dialog.accept 실패: {exc}")

    page.on("dialog", _accept)
    return _accept


def _click_row_button(page, *, index: int, button_name: str) -> bool:
    """행 index 의 해당 버튼 클릭. 실패 시 JS click 폴백."""
    sel = f'button[name="{button_name}"]'
    try:
        page.locator(sel).nth(index).click(timeout=BUTTON_TIMEOUT_MS)
        return True
    except Exception as exc:
        send_log(f"  클릭 실패 ({button_name}, idx={index}): {exc}")
        try:
            ok = page.evaluate(
                """({ sel, i }) => {
                    const els = document.querySelectorAll(sel);
                    if (els[i]) { els[i].click(); return true; }
                    return false;
                }""",
                {"sel": sel, "i": index},
            )
            if ok:
                send_log(f"  JS click 폴백 적용 ({button_name}, idx={index})")
                return True
        except Exception as exc2:
            send_error(f"  JS click 폴백도 실패: {exc2}")
        return False


def _count_label_rows(page) -> int:
    try:
        return page.locator('button[name="shipment-label"]').count()
    except Exception:
        return 0


def _goto_next_page(page, next_page: int) -> bool:
    """pagination 에서 next_page 번호 링크 클릭. 없으면 False."""
    try:
        link = page.locator(f'.pagination a:text-is("{next_page}")')
        if link.count() == 0:
            return False
        link.first.click(timeout=BUTTON_TIMEOUT_MS)
    except Exception as exc:
        send_log(f"pagination 이동 실패 (page {next_page}): {exc}")
        return False
    page.wait_for_timeout(2_000)
    return True


# ─── 메인 ────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="쉽먼트 서류 일괄 다운로드")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD (입고예정일)")
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--skip-login", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    _config["skip_login"] = args.skip_login
    vendor_id = args.vendor.strip().lower()

    download_dir = os.environ.get("SHIPMENT_DOWNLOAD_DIR")
    if not download_dir:
        send_error("SHIPMENT_DOWNLOAD_DIR 미설정 — Electron 측 세팅 확인")
        sys.exit(1)
    if not os.path.isdir(download_dir):
        try:
            os.makedirs(download_dir, exist_ok=True)
        except Exception as exc:
            send_error(f"다운로드 폴더 생성 실패: {download_dir} — {exc}")
            sys.exit(1)

    send_log("=" * 60)
    send_log("shipment_docs_download.py — 쉽먼트 서류 일괄 다운로드")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  작업: {args.date} · {args.sequence}차")
    send_log(f"  저장 폴더: {download_dir}")
    send_log("=" * 60)

    # ── CDP ──
    _step_log("CDP_CONNECT", "START")
    send_progress(5, "CDP 연결 중")
    cdp_endpoint = os.environ.get("CDP_ENDPOINT")
    if not cdp_endpoint:
        send_error("CDP_ENDPOINT 환경변수 미설정")
        sys.exit(1)

    conn = None
    try:
        conn = create_cdp_connection(cdp_endpoint)
    except Exception as exc:
        send_error(f"CDP 연결 실패: {exc}")
        sys.exit(1)
    _step_log("CDP_CONNECT", "OK")
    send_progress(15, "CDP 연결 성공")

    try:
        page = find_vendor_page(conn.browser) or get_existing_page(conn.browser)
        _step_log("PAGE_ACQUIRE", "OK", page.url)

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

        _step_log("NAVIGATE", "START")
        send_progress(30, "리스트 페이지로 이동")
        if not _navigate_to_list(page):
            _step_log("NAVIGATE", "FAIL")
            sys.exit(1)
        _step_log("NAVIGATE", "OK", page.url)

        # dialog handler
        dialog_handler = _register_dialog_auto_accept(page)

        # 필터 적용
        _step_log("FILTER", "START", f"edd={args.date}")
        send_progress(38, f"edd={args.date} 필터 적용")
        if not _apply_edd_filter(page, args.date):
            _step_log("FILTER", "FAIL")
            sys.exit(1)
        _step_log("FILTER", "OK")

        # 페이지 순회하며 다운로드
        _step_log("DOWNLOAD", "START")
        downloaded: list[str] = []
        clicks_ok = 0
        clicks_fail = 0
        pages_done = 0
        current_page = 1

        while current_page <= MAX_PAGES:
            page.wait_for_timeout(1_000)
            row_count = _count_label_rows(page)
            send_log(f"page {current_page}: {row_count}행")
            if row_count == 0:
                break

            total_this_page = row_count * len(BUTTON_SELECTORS)
            for i in range(row_count):
                for button_name, label in BUTTON_SELECTORS:
                    done_sub = i * len(BUTTON_SELECTORS) + (1 if button_name == BUTTON_SELECTORS[1][0] else 0) + 1
                    pct = 40 + min(55, int((done_sub / max(1, total_this_page)) * 55 * (1.0 / max(1, current_page))))
                    send_progress(pct, f"p{current_page} [{i+1}/{row_count}] {label}")

                    baseline = _snapshot_dir(download_dir)
                    send_log(f"page {current_page} row {i+1}/{row_count} · {label} ({button_name}) 클릭")
                    ok = _click_row_button(page, index=i, button_name=button_name)
                    if not ok:
                        clicks_fail += 1
                        continue
                    clicks_ok += 1

                    new_files = _wait_for_new_stable_file(download_dir, baseline)
                    if not new_files:
                        send_log(f"  [WARN] 새 파일 감지 실패 (timeout)")
                    else:
                        for f in new_files:
                            if f not in downloaded:
                                downloaded.append(f)

                    time.sleep(INTER_CLICK_DELAY_SEC)

            pages_done += 1

            # 다음 페이지
            next_page = current_page + 1
            if not _goto_next_page(page, next_page):
                send_log(f"page {current_page} 이후 페이지 없음")
                break
            current_page = next_page

        try:
            page.remove_listener("dialog", dialog_handler)
        except Exception:
            pass

        # 마지막 다운로드가 늦게 떨어질 수 있어 추가 대기
        time.sleep(3.0)

        _step_log("DOWNLOAD", "OK",
                  f"pages={pages_done} clicks={clicks_ok}/{clicks_ok + clicks_fail} polled={len(downloaded)}")

        # ── 파일 메타: 폴더 전체 재스캔 (polling 누락분도 포함) ──
        files_meta = []
        try:
            actual_files = sorted(
                f for f in os.listdir(download_dir)
                if os.path.isfile(os.path.join(download_dir, f))
                and not f.lower().endswith((".crdownload", ".tmp", ".part"))
            )
        except Exception as exc:
            send_log(f"[WARN] 폴더 재스캔 실패: {exc}")
            actual_files = list(downloaded)
        for name in actual_files:
            p = os.path.join(download_dir, name)
            try:
                size = os.path.getsize(p)
            except Exception:
                size = None
            files_meta.append({"name": name, "size": size})
        send_log(f"폴더 재스캔 결과: {len(files_meta)}개 (polling {len(downloaded)}개)")

        send_progress(100, f"완료 — {len(files_meta)}개 파일")

        result_payload = {
            "success": True,
            "status": "downloaded" if files_meta else "no_files",
            "vendor": vendor_id,
            "date": args.date,
            "sequence": args.sequence,
            "folder": download_dir,
            "files": files_meta,
            "pagesProcessed": pages_done,
            "clicksOk": clicks_ok,
            "clicksFail": clicks_fail,
            "finalUrl": page.url,
        }
        send({"type": "result", "data": json.dumps(result_payload, ensure_ascii=False)})
        send_log(
            f"[Shipment Docs] {len(files_meta)}개 파일 다운로드 "
            f"({pages_done}페이지 · clicks {clicks_ok}/{clicks_ok + clicks_fail})"
        )
        send_log("=" * 60)

    finally:
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
