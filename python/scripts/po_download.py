"""
po_download.py — PO SKU 다운로드 자동화

쿠팡 서플라이어 허브의 /scm/purchase/order/sku/list 페이지에서
PO SKU 데이터를 다운로드하여 로컬 Excel 파일로 저장한다.

실행 환경 (Electron Main이 python:run에서 자동 설정):
    CDP_ENDPOINT        — CDP 디버깅 엔드포인트 (예: http://127.0.0.1:9222)
    COUPANG_DATA_DIR    — 다운로드 파일 저장 디렉토리
    COUPANG_ID_{VENDOR} — 벤더별 로그인 ID
    COUPANG_PW_{VENDOR} — 벤더별 비밀번호

인자:
    --vendor <vendor_id>       벤더 식별자 (필수)
    --date-from <YYYY-MM-DD>   조회 시작일 (선택, 기본: 오늘)
    --date-to <YYYY-MM-DD>     조회 종료일 (선택, 기본: 오늘)
    --status <status>          PO 상태 필터 (선택, 기본: 전체)
    --base-url <URL>           기본 URL (오프라인 테스트: http://localhost:PORT)
    --skip-login               로그인 단계 건너뛰기 (오프라인 테스트용)

실행 예:
    # Electron 앱 (IPC)
    python:run("scripts/po_download.py", ["--vendor", "basic"])

    # 직접 실행
    CDP_ENDPOINT=http://127.0.0.1:9222 \\
    COUPANG_ID_BASIC=user COUPANG_PW_BASIC=pass \\
    COUPANG_DATA_DIR=./data \\
    python scripts/po_download.py --vendor basic

    # 오프라인 테스트
    CDP_ENDPOINT=http://127.0.0.1:9333 \\
    COUPANG_DATA_DIR=/tmp/test \\
    python scripts/po_download.py --vendor test \\
        --base-url http://localhost:8080 --skip-login

흐름:
    1. CDP attach → 기존 페이지 재사용
    2. 로그인 보장 (ensure_logged_in) — --skip-login 시 건너뛰기
    3. PO SKU 목록 페이지로 이동 (/scm/purchase/order/sku/list)
    4. 날짜/상태 필터 설정
    5. 검색 실행
    6. 다운로드 버튼 클릭 → 파일 다운로드 polling
    7. 다운로드 파일을 {vendor}-{YYYYMMDD}-{seq}.xlsx로 복사
    8. 결과 JSON 출력

종료 코드:
    0 — 다운로드 성공
    1 — 실패

주의사항 (CLAUDE.md):
    ⛔ chromium.launch() 절대 금지
    ⛔ context.new_page() 절대 금지
    ✅ connect_over_cdp() → context.pages[0] 재사용만 허용
    ⚠ Bootstrap 모달 좀비 → JS로 강제 제거
    ⚠ SPA 내부 라우팅 → page.goto() 실패 시 location.replace() 폴백
    ⚠ 모달 fade-in 지연 → polling 대기
"""

import argparse
import glob
import json
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta
from typing import Optional

# python/ 디렉토리를 sys.path에 추가
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
    SELECTOR_WAIT_TIMEOUT,
)


# ─── 상수 ────────────────────────────────────────────────────────

# PO SKU 목록 페이지
PO_SKU_LIST_PATH = "/scm/purchase/order/sku/list"
PO_SKU_LIST_URL = f"https://supplier.coupang.com{PO_SKU_LIST_PATH}"

# 다운로드 타임아웃
DOWNLOAD_TIMEOUT_SEC = 120       # 파일 다운로드 최대 대기 (초)
DOWNLOAD_POLL_INTERVAL_SEC = 2   # 다운로드 polling 간격 (초)
PAGE_LOAD_WAIT_MS = 3000         # 페이지 로드 후 안정화 대기 (ms)

# Bootstrap 모달 좀비 제거 JS (login.py와 동일)
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

# 쿠팡 PO SKU 페이지 셀렉터 (명세 기준)
# 페이지 이동은 query string 으로 끝나므로 폼 입력/검색 셀렉터는 사용하지 않는다.
SEL = {
    # 빈 결과 마커 (둘 중 하나라도 보이면 다운로드 단계 스킵)
    "no_data": [
        "text=No search results",
        "text=검색 결과가 없습니다",
    ],
    # 1차 다운로드 트리거 (상품목록 다운로드 버튼)
    "select_download_btn": "#selectDownloadButton",
    # 다운로드 모달 내 전체 다운로드 버튼
    "down_all": "#down-all",
    # Fallback — 일부 환경에서 표시되는 "Manual Download" 버튼
    "manual_download": [
        'button[name="Manual Download1"]',
        'button[name="Manual Download"]',
    ],
}


# ─── 런타임 설정 (--base-url, --skip-login으로 변경 가능) ──────────

_config = {
    "base_url": "https://supplier.coupang.com",
    "skip_login": False,
}


def _get_po_url() -> str:
    """현재 config의 base_url로 PO SKU 목록 URL을 구성한다 (필터 없음, 호환용)."""
    return f"{_config['base_url']}{PO_SKU_LIST_PATH}"


def _build_po_list_url(date_from: str, date_to: str) -> str:
    """
    필터 query string이 박힌 PO SKU 목록 URL을 생성한다.

    명세:
      - searchDateType = WAREHOUSING_PLAN_DATE  (입고예정일 기준)
      - searchStartDate / searchEndDate = YYYY-MM-DD
      - purchaseOrderStatus = REQUEST_CONFIRM_PARTNER (발주확정 요청만)
      - 나머지 필터 (purchaseOrderSeq, centerCode, skuSeq, purchaseOrderType) 는 빈 값
    """
    base = _config["base_url"]
    qs = (
        "page=1"
        "&searchDateType=WAREHOUSING_PLAN_DATE"
        f"&searchStartDate={date_from}"
        f"&searchEndDate={date_to}"
        "&purchaseOrderSeq="
        "&centerCode="
        "&skuSeq="
        "&purchaseOrderStatus=REQUEST_CONFIRM_PARTNER"
        "&purchaseOrderType="
    )
    return f"{base}{PO_SKU_LIST_PATH}?{qs}"


def _step_log(step: str, status: str, message: str = "") -> None:
    """
    단계별 진단 로그.

    형식: [STEP:step:status] message
    테스트 하네스가 이 마커를 파싱하여 각 단계의 성공/실패를 판별한다.
    """
    text = f"[STEP:{step}:{status}]"
    if message:
        text += f" {message}"
    send_log(text)


# ─── 유틸리티 ─────────────────────────────────────────────────────

def _today_str() -> str:
    """오늘 날짜를 YYYYMMDD 형식으로 반환."""
    return datetime.now().strftime("%Y%m%d")


def _today_dash() -> str:
    """오늘 날짜를 YYYY-MM-DD 형식으로 반환."""
    return datetime.now().strftime("%Y-%m-%d")


def _clean_modal_backdrops(page) -> int:
    """Bootstrap 모달 좀비 제거."""
    try:
        count = page.evaluate(REMOVE_MODAL_BACKDROP_JS)
        if count and count > 0:
            send_log(f"모달 좀비 제거: {count}개")
        return count or 0
    except Exception:
        return 0


def _safe_url_for_js(url: str) -> str:
    """URL을 JS 문자열 리터럴에 안전하게 삽입."""
    if not url.startswith(("https://", "http://")):
        raise ValueError(f"허용되지 않는 URL: {url}")
    return url.replace("\\", "\\\\").replace("'", "\\'").replace('"', '\\"')


def _get_data_dir() -> str:
    """COUPANG_DATA_DIR 환경변수에서 데이터 디렉토리를 가져온다."""
    data_dir = os.environ.get("COUPANG_DATA_DIR")
    if not data_dir:
        send_error("COUPANG_DATA_DIR 환경변수 미설정")
        sys.exit(1)
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def _build_filename(vendor_id: str, ymd: str, seq: int, ext: str = "xlsx") -> str:
    """벤더 파일명 생성: {vendor}-{YYYYMMDD}-{seq:02d}.{ext}"""
    return f"{vendor_id}-{ymd}-{seq:02d}.{ext}"


def _next_sequence(data_dir: str, vendor_id: str, ymd: str) -> int:
    """
    해당 벤더/날짜의 다음 차수 번호를 계산한다.
    csv·xlsx 둘 다 카운트하여 확장자가 달라도 seq 가 충돌하지 않도록 한다.
    """
    pattern = re.compile(
        rf"^{re.escape(vendor_id)}-{re.escape(ymd)}-(\d{{2}})\.(csv|xlsx)$", re.IGNORECASE
    )
    max_seq = 0
    if os.path.isdir(data_dir):
        for name in os.listdir(data_dir):
            m = pattern.match(name)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
    return min(99, max_seq + 1)


# ─── 페이지 네비게이션 ────────────────────────────────────────────

def _navigate_to_po_list(page, po_url: Optional[str] = None) -> bool:
    """
    PO SKU 목록 페이지로 이동한다.

    Args:
        page: Playwright Page
        po_url: 이동할 URL (필터 query 포함). 미지정 시 path만 사용.

    SPA 라우팅 함정 대응:
        1. page.goto() 시도
        2. 실패 시 location.replace() 폴백
        3. URL에 /scm/purchase/order/sku/list 포함 확인

    Returns:
        True — 이동 성공 / False — 실패

    주의: 이전과 달리 "이미 같은 path에 있어도 query string이 다를 수 있으므로"
    현재 URL이 /scm/purchase/order/sku/list 더라도 항상 새로 goto 한다.
    """
    if po_url is None:
        po_url = _get_po_url()
    send_log(f"PO SKU 목록 페이지로 이동: {po_url}")
    try:
        page.goto(po_url, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_log(f"page.goto 실패 ({exc}) → location.replace() 폴백")
        try:
            safe = _safe_url_for_js(po_url)
            page.evaluate(f"() => window.location.replace('{safe}')")
            page.wait_for_load_state("domcontentloaded", timeout=LOGIN_NAVIGATION_TIMEOUT)
        except Exception as exc2:
            send_error(f"PO 페이지 이동 최종 실패: {exc2}")
            return False

    # 페이지 안정화 대기
    page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
    _clean_modal_backdrops(page)

    # URL 확인
    final_url = page.url
    if PO_SKU_LIST_PATH in final_url:
        send_log(f"PO SKU 목록 페이지 도달: {final_url}")
        return True

    # 세션 만료로 리다이렉트되었을 수 있음 (--skip-login 시 건너뛰기)
    if not _config["skip_login"] and not is_session_valid(page):
        send_error(f"세션 만료 — 현재 URL: {final_url}")
        return False

    send_log(f"URL 확인 불확실하지만 계속 진행: {final_url}")
    return True


# ─── 다운로드 ─────────────────────────────────────────────────────

def _is_empty_result(page) -> bool:
    """
    빈 결과 마커("No search results" 또는 "검색 결과가 없습니다")가
    현재 페이지에 표시되어 있으면 True.
    """
    for sel in SEL["no_data"]:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                return True
        except Exception:
            continue
    return False


def _click_with_fallback(page, selectors: list, label: str) -> bool:
    """
    selectors 리스트에서 첫 번째로 발견된 visible element를 클릭한다.
    """
    for sel in selectors:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                send_log(f"{label} 클릭 (셀렉터: {sel})")
                el.click()
                return True
        except Exception:
            continue
    return False


def _trigger_download(page) -> bool:
    """
    상품목록 다운로드 버튼 → 모달의 전체 다운로드 클릭.

    Playwright expect_download 는 사용하지 않는다. Electron 쪽 will-download
    훅이 pendingDownloadTarget 경로로 자동 저장하므로, Python 은 클릭만
    수행하고 파일 시스템에서 결과 파일을 polling 한다.

    흐름:
        1. #selectDownloadButton 클릭
        2. #down-all 모달 visible 대기 (최대 30초)
        3. #down-all 클릭 → 다운로드 시작
        4. (Fallback) "Manual Download1" / "Manual Download" 버튼

    Returns:
        True — 클릭 시퀀스 정상 수행
    """
    sel_btn = SEL["select_download_btn"]
    sel_modal = SEL["down_all"]

    try:
        page.wait_for_selector(sel_btn, state="visible", timeout=30_000)
    except Exception as exc:
        send_error(f"{sel_btn} 버튼 미발견: {exc}")
        return False

    send_log(f"{sel_btn} 클릭")
    page.click(sel_btn)

    try:
        page.wait_for_selector(sel_modal, state="visible", timeout=30_000)
        send_log(f"{sel_modal} 클릭 (전체 다운로드)")
        page.click(sel_modal)
    except Exception:
        send_log(f"{sel_modal} 미표시 — Manual Download fallback 시도")
        if not _click_with_fallback(page, SEL["manual_download"], "Manual Download"):
            send_log("Manual Download 버튼도 없음")
            return False
    return True


def _wait_for_download_file(target_path: str, timeout_sec: int = DOWNLOAD_TIMEOUT_SEC) -> bool:
    """
    Electron will-download 훅이 target_path 에 파일을 저장할 때까지 기다린다.
    파일 크기가 2번 연속 같으면 안정화된 것으로 판단.

    Returns:
        True — 파일이 정상적으로 생성되고 크기 안정화
    """
    send_log(f"파일 다운로드 대기: {target_path}")
    start = time.time()
    last_size = -1
    stable_count = 0
    while time.time() - start < timeout_sec:
        if os.path.exists(target_path):
            try:
                size = os.path.getsize(target_path)
            except OSError:
                time.sleep(0.5)
                continue
            if size > 0 and size == last_size:
                stable_count += 1
                if stable_count >= 2:
                    send_log(f"다운로드 완료: {size} bytes ({time.time()-start:.1f}s)")
                    return True
            else:
                stable_count = 0
                last_size = size
        time.sleep(0.5)
    send_error(f"다운로드 타임아웃: {timeout_sec}초 내에 파일이 완성되지 않음")
    return False


def _poll_download_complete(download, timeout_sec: int = DOWNLOAD_TIMEOUT_SEC) -> Optional[str]:
    """
    Playwright Download 객체의 완료를 polling한다.

    CDP 원격 연결에서는 download.path()가 None을 반환할 수 있으므로
    download.save_as()를 폴백으로 사용한다.

    Args:
        download: Playwright Download 인스턴스
        timeout_sec: 최대 대기 시간 (초)

    Returns:
        다운로드 완료된 파일 경로 또는 None
    """
    send_log("다운로드 완료 대기 중...")
    start = time.time()

    # 방법 1: download.path() — 로컬 브라우저 연결 시 사용 가능
    try:
        tmp_path = download.path()
        if tmp_path and os.path.exists(str(tmp_path)):
            elapsed = time.time() - start
            send_log(f"다운로드 완료 (path): {tmp_path} ({elapsed:.1f}초)")
            return str(tmp_path)
    except Exception:
        pass

    # 방법 2: download.save_as() — CDP 원격 연결 시 사용
    try:
        suggested = download.suggested_filename or "download.xlsx"
        tmp_dir = tempfile.mkdtemp(prefix="po_download_")
        save_path = os.path.join(tmp_dir, suggested)
        download.save_as(save_path)
        elapsed = time.time() - start
        send_log(f"다운로드 완료 (save_as): {save_path} ({elapsed:.1f}초)")
        return save_path
    except Exception as exc:
        # download.failure()로 실패 사유 확인
        try:
            failure = download.failure()
            if failure:
                send_error(f"다운로드 실패: {failure}")
                return None
        except Exception:
            pass
        send_error(f"다운로드 대기 중 에러: {exc}")
        return None


def _csv_to_xlsx(csv_path: str, xlsx_path: str) -> int:
    """
    CSV 파일을 읽어 xlsx 로 변환 저장한다.

    - 인코딩: utf-8-sig 우선 (쿠팡은 BOM 포함 UTF-8). 실패 시 cp949 폴백.
    - 빈 파일(0 bytes) 도 스키마 유지용으로 빈 xlsx 생성.

    Returns:
        저장된 행 수
    """
    import csv
    import openpyxl

    # 인코딩 탐지
    rows = []
    last_error = None
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with open(csv_path, "r", encoding=enc, newline="") as f:
                rows = list(csv.reader(f))
            break
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
    else:
        raise RuntimeError(f"CSV 인코딩 판별 실패: {last_error}")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "data"
    for row in rows:
        ws.append(row)
    wb.save(xlsx_path)
    return len(rows)


def _convert_to_xlsx(csv_path: str) -> Optional[str]:
    """
    Electron 이 저장한 csv 를 같은 폴더의 po.xlsx 로 변환한 뒤 원본 csv 는 삭제.

    Returns:
        저장된 xlsx 파일 경로 또는 None
    """
    try:
        xlsx_path = os.path.splitext(csv_path)[0] + ".xlsx"
        row_count = _csv_to_xlsx(csv_path, xlsx_path)
        try:
            os.remove(csv_path)
        except OSError:
            pass
        send_log(f"xlsx 변환 완료: {xlsx_path} ({row_count}행)")
        return xlsx_path
    except Exception as exc:
        send_error(f"xlsx 변환 실패: {exc}")
        return None


# ─── 메인 흐름 ────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="PO SKU 다운로드 자동화")
    parser.add_argument("--vendor", required=True, help="벤더 식별자 (예: basic)")
    parser.add_argument("--date-from", default=None, help="조회 시작일 (YYYY-MM-DD, 기본: 오늘)")
    parser.add_argument("--date-to", default=None, help="조회 종료일 (YYYY-MM-DD, 기본: 오늘)")
    parser.add_argument("--sequence", type=int, default=None,
                        help="작업 차수 (지정 시 {data_dir}/{date}/{vendor}/{NN}/po.csv 로 저장)")
    parser.add_argument("--status", default=None, help="PO 상태 필터 (선택)")
    parser.add_argument("--base-url", default="https://supplier.coupang.com",
                        help="기본 URL (오프라인 테스트: http://localhost:PORT)")
    parser.add_argument("--skip-login", action="store_true",
                        help="로그인 단계 건너뛰기 (오프라인 테스트용)")
    return parser.parse_args()


def main():
    args = parse_args()
    vendor_id = args.vendor.strip().lower()
    date_from = args.date_from or _today_dash()
    date_to = args.date_to or _today_dash()

    # 런타임 설정 반영
    _config["base_url"] = args.base_url
    _config["skip_login"] = args.skip_login

    send_log("=" * 60)
    send_log("po_download.py — PO SKU 다운로드 자동화")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  기간: {date_from} ~ {date_to}")
    send_log(f"  상태: {args.status or '전체'}")
    if _config["skip_login"]:
        send_log(f"  base-url: {_config['base_url']}")
        send_log(f"  skip-login: True")
    send_log("=" * 60)

    data_dir = _get_data_dir()
    send_log(f"저장 디렉토리: {data_dir}")

    # ── 1. CDP 연결 ──
    _step_log("CDP_CONNECT", "START")
    send_progress(5, "CDP 연결 중")
    cdp_endpoint = os.environ.get("CDP_ENDPOINT")
    if not cdp_endpoint:
        _step_log("CDP_CONNECT", "FAIL", "CDP_ENDPOINT 환경변수 미설정")
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
    send_progress(10, "CDP 연결 성공")

    try:
        # ── 2. 페이지 획득 (URL 기반 — React UI 회피) ──
        page = find_vendor_page(conn.browser)
        if page is None:
            page = get_existing_page(conn.browser)
        _clean_modal_backdrops(page)
        _step_log("PAGE_ACQUIRE", "OK", f"URL: {page.url}")

        # ── 3. 로그인 보장 ──
        if _config["skip_login"]:
            _step_log("LOGIN", "SKIP", "로그인 건너뛰기 (--skip-login)")
            send_progress(25, "로그인 건너뛰기")
        else:
            _step_log("LOGIN", "START", f"벤더 '{vendor_id}' 로그인 확인")
            send_progress(15, "로그인 확인 중")
            if not ensure_logged_in(page, vendor_id):
                _step_log("LOGIN", "FAIL", "로그인 실패")
                send_error("로그인 실패 — PO 다운로드를 진행할 수 없습니다")
                sys.exit(1)
            _step_log("LOGIN", "OK", "로그인 성공")
            send_progress(25, "로그인 완료")
            check_session_and_log(page)

        # ── 4. PO SKU 목록 페이지 이동 (필터 query 포함 URL) ──
        po_url = _build_po_list_url(date_from, date_to)
        _step_log("NAVIGATE", "START", po_url)
        send_progress(30, "PO 목록 페이지 이동 중")
        if not _navigate_to_po_list(page, po_url):
            if _config["skip_login"]:
                _step_log("NAVIGATE", "FAIL", "PO 목록 페이지 이동 실패")
                send_error("PO 목록 페이지 이동 최종 실패")
                sys.exit(1)
            # 세션 만료 시 재로그인 후 재시도
            send_log("PO 페이지 이동 실패 — 재로그인 후 재시도")
            if ensure_logged_in(page, vendor_id):
                if not _navigate_to_po_list(page, po_url):
                    _step_log("NAVIGATE", "FAIL", "재시도 실패")
                    send_error("PO 목록 페이지 이동 최종 실패")
                    sys.exit(1)
            else:
                _step_log("NAVIGATE", "FAIL", "재로그인 실패")
                send_error("재로그인 실패")
                sys.exit(1)

        _step_log("NAVIGATE", "OK", page.url)
        send_progress(45, "PO 목록 페이지 도달")
        _clean_modal_backdrops(page)

        # ── 5. 빈 결과 감지 — 검색 결과 0건이면 다운로드 단계 건너뛴다 ──
        # 페이지 안정화 잠시 대기 (결과 마커는 #selectDownloadButton 보다 먼저
        # 렌더링되는 경우가 많음)
        page.wait_for_timeout(800)
        if _is_empty_result(page):
            _step_log("EMPTY", "OK", f"{date_from} ~ {date_to}: 검색 결과 없음")
            send_progress(100, "검색 결과 없음")
            result = {
                "success": True,
                "empty": True,
                "vendor": vendor_id,
                "dateFrom": date_from,
                "dateTo": date_to,
            }
            send({"type": "result", "data": json.dumps(result, ensure_ascii=False)})
            send_log(f"[PO Download] 검색 결과 없음 ({date_from} ~ {date_to})")
            send_log("=" * 60)
            return  # finally 블록에서 CDP 정리

        # ── 6. 다운로드: click → Electron 이 저장 → 파일 polling → xlsx 변환 ──
        _step_log("DOWNLOAD", "START")
        send_progress(55, "다운로드 시도 중")

        saved_path = None
        # Electron will-download 훅이 저장할 경로 (ipc-handlers 와 일치)
        if args.sequence is not None:
            expected_csv = os.path.join(
                data_dir, date_from, vendor_id, f"{args.sequence:02d}", "po.csv"
            )
        else:
            # 폴백: 평면 파일명
            ymd = _today_str()
            seq = _next_sequence(data_dir, vendor_id, ymd)
            expected_csv = os.path.join(data_dir, _build_filename(vendor_id, ymd, seq, ext="csv"))

        if not _trigger_download(page):
            _step_log("DOWNLOAD", "FAIL", "다운로드 트리거 실패")
        else:
            send_progress(75, "파일 다운로드 대기 중")
            if _wait_for_download_file(expected_csv):
                send_progress(90, "xlsx 변환 중")
                saved_path = _convert_to_xlsx(expected_csv)
                if saved_path:
                    _step_log("DOWNLOAD", "OK", f"저장: {saved_path}")
                    _step_log("SAVE", "OK", saved_path)
                else:
                    _step_log("DOWNLOAD", "FAIL", "xlsx 변환 실패")
            else:
                _step_log("DOWNLOAD", "FAIL", "다운로드 완료 대기 실패")

        # ── 9. 결과 출력 ──
        _step_log("RESULT", "START")
        send_progress(95, "결과 정리 중")

        if saved_path:
            filename = os.path.basename(saved_path)
            result = {
                "success": True,
                "filePath": saved_path,
                "fileName": filename,
                "vendor": vendor_id,
                "dateFrom": date_from,
                "dateTo": date_to,
            }
            send({"type": "result", "data": json.dumps(result, ensure_ascii=False)})
            send_progress(100, "PO 다운로드 완료")
            _step_log("RESULT", "OK", f"파일: {filename}")
            send_log(f"[PO Download Complete] {filename}")
            send_log(f"  경로: {saved_path}")
        else:
            _step_log("RESULT", "FAIL", "다운로드 및 추출 모두 실패")
            send_error("PO 다운로드 최종 실패")
            result = {
                "success": False,
                "error": "다운로드 및 추출 모두 실패",
                "vendor": vendor_id,
            }
            send({"type": "result", "data": json.dumps(result, ensure_ascii=False)})
            sys.exit(1)

        send_log("=" * 60)
        send_log("po_download.py 정상 종료")
        send_log("=" * 60)

    finally:
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
