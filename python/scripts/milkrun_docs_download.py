"""
milkrun_docs_download.py — 밀크런 등록 후 서류(프린트/팔레트 부착 리스트) 일괄 다운로드

쿠팡 서플라이어 허브의 /milkrun/milkrunList 페이지에서 해당 날짜로 조회되는
행마다 다음 두 버튼을 순차적으로 클릭해 파일을 다운로드한다:

    span[name="printPOFilesBtn"]          — 파란 (프린트)
    span[name="printMilkrunLabalForPda"]  — 빨간 (팔레트 부착 리스트)

각 클릭마다 window.confirm 이 뜰 수 있어 dialog 핸들러로 자동 수락.
다운로드는 Electron main 의 will-download 훅 + MILKRUN_DOWNLOAD_DIR 환경변수로
지정된 폴더에 suggested_filename 그대로 저장된다.

실행 환경 (Electron Main이 python:run에서 자동 설정):
    CDP_ENDPOINT            — CDP 디버깅 엔드포인트
    COUPANG_DATA_DIR        — job 루트 (manifest 조회용)
    MILKRUN_DOWNLOAD_DIR    — 파일이 저장될 절대 경로 (Electron이 미리 mkdir)
    COUPANG_ID_{VENDOR}     — 로그인 ID
    COUPANG_PW_{VENDOR}     — 로그인 비밀번호

인자:
    --vendor   <vendor_id>    벤더 식별자 (필수)
    --date     <YYYY-MM-DD>   밀크런 입고예정일 (필수)
    --sequence <NN>           작업 차수 (필수)
    --skip-login              로그인 단계 건너뛰기

종료 코드:
    0 — 성공 (버튼 클릭 0건이면 no_rows)
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

MILKRUN_LIST_URL = (
    "https://supplier.coupang.com/milkrun/milkrunList"
    "?page=1&milkrunSearchType=RECEIVING_AT"
    "&startDate={d}&endDate={d}&purchaseOrderSeq=&milkrunSeq="
)

BUTTON_SELECTORS = [
    ("printPOFilesBtn", "프린트"),
    ("printMilkrunLabalForPda", "팔레트 부착 리스트"),
]

BUTTON_TIMEOUT_MS = 10_000
PER_BUTTON_WAIT_SEC = 30          # 파일 하나 다운로드 완료 최대 대기
DOWNLOAD_STABILITY_SEC = 2.0      # 크기가 안 바뀌면 완료로 판단
DOWNLOAD_POLL_SEC = 0.5

_config = {"skip_login": False}


# ─── 유틸 ────────────────────────────────────────────────────────

def _step_log(step: str, status: str, message: str = "") -> None:
    text = f"[STEP:{step}:{status}]"
    if message:
        text += f" {message}"
    send_log(text)


def _snapshot_dir(dirpath: str) -> set:
    """폴더 내 파일명 스냅샷 (.crdownload 등 임시 제외)."""
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
    """baseline 이후 새로 생긴 파일 중 size 가 안정된 것들을 반환.

    임시 확장자(.crdownload 등) 가 사라지고 최종 파일명이 등장 + size 가
    stability_sec 동안 안 바뀔 때까지 대기.
    """
    deadline = time.time() + timeout_sec
    size_watch: dict[str, tuple[int, float]] = {}  # name → (size, last_changed_at)
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

        # 더 이상 변화가 없고 최소 1개는 잡혔고 안정화됐으면 조기 종료
        # (단, 현재 시점부터 stability_sec 이상 경과 후에만)
        if stable and all(
            now - sw[1] >= stability_sec
            for sw in size_watch.values()
            if sw[0] > 0
        ):
            break

        time.sleep(poll_sec)

    return sorted(stable)


# ─── 페이지 조작 ───────────────────────────────────────────────────

def _navigate_to_list(page, date: str) -> bool:
    url = MILKRUN_LIST_URL.format(d=date)
    send_log(f"밀크런 리스트 페이지로 이동: {url}")
    try:
        page.goto(url, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_error(f"page.goto 실패: {exc}")
        return False
    page.wait_for_timeout(2_000)
    if "/milkrun/milkrunList" not in page.url:
        send_error(f"대상 경로에 도달하지 못함 — 현재 URL: {page.url}")
        return False
    return True


def _register_dialog_auto_accept(page):
    """페이지에서 발생하는 confirm/alert 을 전부 수락하는 핸들러 등록."""
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


def _collect_milkrun_seqs(page) -> list[str]:
    """리스트 페이지에서 각 행의 milkrun-seq 수집."""
    try:
        page.wait_for_selector(
            'span[name="printPOFilesBtn"]', state="attached", timeout=BUTTON_TIMEOUT_MS,
        )
    except Exception:
        return []
    try:
        seqs = page.eval_on_selector_all(
            'span[name="printPOFilesBtn"]',
            """els => els.map(el => el.getAttribute('milkrun-seq'))""",
        )
    except Exception as exc:
        send_error(f"milkrun-seq 수집 실패: {exc}")
        return []
    # 유니크 + 순서 보존
    seen = set()
    out = []
    for s in seqs:
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _click_doc_button(page, *, seq: str, button_name: str) -> bool:
    """행 seq 의 해당 버튼을 클릭. 성공 시 True."""
    sel = f'span[name="{button_name}"][milkrun-seq="{seq}"]'
    try:
        page.locator(sel).first.click(timeout=BUTTON_TIMEOUT_MS)
        return True
    except Exception as exc:
        send_log(f"  클릭 실패 ({button_name}, seq={seq}): {exc}")
        # JS click 폴백
        try:
            page.evaluate(
                """({ sel }) => {
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return true; }
                    return false;
                }""",
                {"sel": sel},
            )
            send_log(f"  JS click 폴백 적용 ({button_name}, seq={seq})")
            return True
        except Exception as exc2:
            send_error(f"  JS click 폴백도 실패: {exc2}")
            return False


# ─── 메인 ────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="밀크런 서류 일괄 다운로드")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--skip-login", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    _config["skip_login"] = args.skip_login
    vendor_id = args.vendor.strip().lower()

    download_dir = os.environ.get("MILKRUN_DOWNLOAD_DIR")
    if not download_dir:
        send_error("MILKRUN_DOWNLOAD_DIR 미설정 — Electron 측 세팅 확인")
        sys.exit(1)
    if not os.path.isdir(download_dir):
        try:
            os.makedirs(download_dir, exist_ok=True)
        except Exception as exc:
            send_error(f"다운로드 폴더 생성 실패: {download_dir} — {exc}")
            sys.exit(1)

    send_log("=" * 60)
    send_log("milkrun_docs_download.py — 밀크런 서류 일괄 다운로드")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  작업: {args.date} · {args.sequence}차")
    send_log(f"  저장 폴더: {download_dir}")
    send_log("=" * 60)

    # ── CDP 연결 ──
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
        # ── 페이지 획득 ──
        page = find_vendor_page(conn.browser) or get_existing_page(conn.browser)
        _step_log("PAGE_ACQUIRE", "OK", page.url)

        # ── 로그인 ──
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

        # ── 리스트 페이지 이동 ──
        _step_log("NAVIGATE", "START")
        send_progress(35, "리스트 페이지로 이동")
        if not _navigate_to_list(page, args.date):
            _step_log("NAVIGATE", "FAIL")
            sys.exit(1)
        _step_log("NAVIGATE", "OK", page.url)

        # ── dialog handler ──
        dialog_handler = _register_dialog_auto_accept(page)

        # ── milkrun-seq 수집 ──
        _step_log("COLLECT_SEQS", "START")
        seqs = _collect_milkrun_seqs(page)
        if not seqs:
            _step_log("COLLECT_SEQS", "EMPTY", "해당 날짜에 밀크런 리스트 0건")
            send_log("[Milkrun Docs: 0] 다운로드할 행이 없습니다")
            send({"type": "result", "data": json.dumps({
                "success": True, "status": "no_rows",
                "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
                "folder": download_dir, "files": [],
                "milkrunSeqs": [],
            }, ensure_ascii=False)})
            sys.exit(0)
        _step_log("COLLECT_SEQS", "OK", f"{len(seqs)}개 seq ({seqs})")

        # ── 각 행 × 버튼별 클릭 → 다운로드 대기 ──
        downloaded: list[str] = []
        clicks_ok = 0
        clicks_fail = 0
        total_buttons = len(seqs) * len(BUTTON_SELECTORS)
        done_idx = 0

        for seq in seqs:
            for button_name, label in BUTTON_SELECTORS:
                done_idx += 1
                pct = 35 + int((done_idx / max(1, total_buttons)) * 55)
                send_progress(pct, f"[{done_idx}/{total_buttons}] seq={seq} {label}")

                baseline = _snapshot_dir(download_dir)
                send_log(f"[{done_idx}/{total_buttons}] seq={seq} · {label} ({button_name}) 클릭")
                ok = _click_doc_button(page, seq=seq, button_name=button_name)
                if not ok:
                    clicks_fail += 1
                    continue
                clicks_ok += 1

                # 다운로드 완료 대기
                new_files = _wait_for_new_stable_file(download_dir, baseline)
                if not new_files:
                    send_log(f"  [WARN] 새 파일 감지 실패 (timeout)")
                else:
                    for f in new_files:
                        if f not in downloaded:
                            downloaded.append(f)

        # dialog handler 해제
        try:
            page.remove_listener("dialog", dialog_handler)
        except Exception:
            pass

        _step_log("DOWNLOAD", "OK",
                  f"clicks={clicks_ok}/{total_buttons} files={len(downloaded)}")

        # ── 파일 메타(크기) 수집 ──
        files_meta = []
        for name in downloaded:
            p = os.path.join(download_dir, name)
            try:
                size = os.path.getsize(p)
            except Exception:
                size = None
            files_meta.append({"name": name, "size": size})

        send_progress(100, f"완료 — {len(files_meta)}개 파일")

        result_payload = {
            "success": True,
            "status": "downloaded" if files_meta else "no_files",
            "vendor": vendor_id,
            "date": args.date,
            "sequence": args.sequence,
            "folder": download_dir,
            "files": files_meta,
            "milkrunSeqs": seqs,
            "clicksOk": clicks_ok,
            "clicksFail": clicks_fail,
            "finalUrl": page.url,
        }
        send({"type": "result", "data": json.dumps(result_payload, ensure_ascii=False)})
        send_log(
            f"[Milkrun Docs] {len(files_meta)}개 파일 다운로드 "
            f"(clicks {clicks_ok}/{total_buttons})"
        )
        send_log("=" * 60)

    finally:
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
