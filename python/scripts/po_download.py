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

# 쿠팡 PO SKU 페이지 셀렉터
SEL = {
    # 날짜 필터
    "date_from": "input[name='searchStartDate'], input#searchStartDate, input.datepicker:first-of-type",
    "date_to": "input[name='searchEndDate'], input#searchEndDate, input.datepicker:last-of-type",

    # 검색 버튼
    "search_btn": "#searchBtn, button.btn-search, button[type='submit'].search",

    # 다운로드 버튼
    "download_btn": "#downloadBtn, button.btn-download, a.btn-download, button:has-text('다운로드'), button:has-text('엑셀'), button:has-text('Excel')",

    # 테이블
    "data_table": "table.table, table#dataTable, .table-responsive table",
    "table_rows": "table.table tbody tr, table#dataTable tbody tr",
    "no_data": ".no-data, .empty-data, td:has-text('데이터가 없습니다'), td:has-text('조회 결과가 없습니다')",
}


# ─── 런타임 설정 (--base-url, --skip-login으로 변경 가능) ──────────

_config = {
    "base_url": "https://supplier.coupang.com",
    "skip_login": False,
}


def _get_po_url() -> str:
    """현재 config의 base_url로 PO SKU 목록 URL을 구성한다."""
    return f"{_config['base_url']}{PO_SKU_LIST_PATH}"


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


def _build_filename(vendor_id: str, ymd: str, seq: int) -> str:
    """벤더 파일명 생성: {vendor}-{YYYYMMDD}-{seq:02d}.xlsx"""
    return f"{vendor_id}-{ymd}-{seq:02d}.xlsx"


def _next_sequence(data_dir: str, vendor_id: str, ymd: str) -> int:
    """해당 벤더/날짜의 다음 차수 번호를 계산한다."""
    pattern = re.compile(
        rf"^{re.escape(vendor_id)}-{re.escape(ymd)}-(\d{{2}})\.xlsx$", re.IGNORECASE
    )
    max_seq = 0
    if os.path.isdir(data_dir):
        for name in os.listdir(data_dir):
            m = pattern.match(name)
            if m:
                max_seq = max(max_seq, int(m.group(1)))
    return min(99, max_seq + 1)


# ─── 페이지 네비게이션 ────────────────────────────────────────────

def _navigate_to_po_list(page) -> bool:
    """
    PO SKU 목록 페이지로 이동한다.

    SPA 라우팅 함정 대응:
        1. page.goto() 시도
        2. 실패 시 location.replace() 폴백
        3. URL에 /scm/purchase/order/sku/list 포함 확인

    Returns:
        True — 이동 성공
        False — 실패
    """
    current_url = page.url
    if PO_SKU_LIST_PATH in current_url:
        send_log(f"이미 PO SKU 목록 페이지에 있습니다: {current_url}")
        return True

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


# ─── 필터 설정 ────────────────────────────────────────────────────

def _set_date_filter(page, date_from: str, date_to: str) -> bool:
    """
    날짜 필터를 설정한다.

    쿠팡 사이트의 datepicker는 readonly input에 jQuery datepicker가 바인딩되어 있어
    직접 fill()이 안 되는 경우가 있다. evaluate()로 JS 직접 조작.

    Args:
        page: Playwright Page
        date_from: YYYY-MM-DD 형식
        date_to: YYYY-MM-DD 형식

    Returns:
        True — 설정 성공
    """
    send_log(f"날짜 필터 설정: {date_from} ~ {date_to}")

    # 방법 1: JS로 직접 input value 설정 + change 이벤트 발생
    set_date_js = """
    (selector, value) => {
        const inputs = document.querySelectorAll(selector);
        if (inputs.length === 0) return false;
        const input = inputs[0];
        // readonly 속성 일시 제거
        const wasReadonly = input.readOnly;
        input.readOnly = false;
        input.value = value;
        input.readOnly = wasReadonly;
        // jQuery datepicker 동기화
        if (window.jQuery && jQuery(input).datepicker) {
            try { jQuery(input).datepicker('setDate', value); } catch(e) {}
        }
        // 변경 이벤트 발생
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }
    """

    try:
        # 시작일 설정
        for sel in SEL["date_from"].split(", "):
            result = page.evaluate(set_date_js, sel.strip(), date_from)
            if result:
                send_log(f"시작일 설정 완료: {date_from} (셀렉터: {sel.strip()})")
                break
        else:
            send_log("시작일 input을 찾지 못함 — 기본값 사용")

        # 종료일 설정
        for sel in SEL["date_to"].split(", "):
            result = page.evaluate(set_date_js, sel.strip(), date_to)
            if result:
                send_log(f"종료일 설정 완료: {date_to} (셀렉터: {sel.strip()})")
                break
        else:
            send_log("종료일 input을 찾지 못함 — 기본값 사용")

    except Exception as exc:
        send_log(f"날짜 필터 설정 중 에러 (무시하고 계속): {exc}")

    return True


def _click_search(page) -> bool:
    """
    검색 버튼을 클릭한다.

    Returns:
        True — 클릭 성공
    """
    send_log("검색 버튼 클릭")

    for sel in SEL["search_btn"].split(", "):
        sel = sel.strip()
        try:
            el = page.query_selector(sel)
            if el:
                el.click()
                send_log(f"검색 버튼 클릭 완료 (셀렉터: {sel})")
                # 검색 결과 로드 대기
                page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
                try:
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass  # networkidle 타임아웃은 치명적이지 않음
                return True
        except Exception:
            continue

    # 폴백: Enter 키로 검색 시도
    send_log("검색 버튼을 찾지 못함 — Enter 키 폴백")
    try:
        page.keyboard.press("Enter")
        page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
        return True
    except Exception as exc:
        send_error(f"검색 실행 실패: {exc}")
        return False


# ─── 다운로드 ─────────────────────────────────────────────────────

def _click_download(page) -> Optional[object]:
    """
    다운로드 버튼을 클릭하고 다운로드를 시작한다.

    Playwright의 expect_download()를 사용하여 다운로드 이벤트를 캡처.

    Returns:
        Download 객체 또는 None (다운로드 시작 실패)
    """
    send_log("다운로드 버튼 탐색")
    _clean_modal_backdrops(page)

    for sel in SEL["download_btn"].split(", "):
        sel = sel.strip()
        try:
            el = page.query_selector(sel)
            if el:
                send_log(f"다운로드 버튼 발견 (셀렉터: {sel})")

                # expect_download로 다운로드 이벤트 캡처
                try:
                    with page.expect_download(timeout=DOWNLOAD_TIMEOUT_SEC * 1000) as download_info:
                        el.click()
                        send_log("다운로드 버튼 클릭 완료 — 다운로드 대기 중...")

                    download = download_info.value
                    send_log(f"다운로드 시작됨: {download.suggested_filename}")
                    return download

                except Exception as exc:
                    send_log(f"expect_download 실패 (셀렉터: {sel}): {exc}")
                    # 다음 셀렉터 시도
                    continue
        except Exception:
            continue

    send_error("다운로드 버튼을 찾을 수 없습니다")
    return None


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


def _save_download(tmp_path: str, data_dir: str, vendor_id: str) -> Optional[str]:
    """
    다운로드된 임시 파일을 {vendor}-{YYYYMMDD}-{seq}.xlsx로 저장한다.

    Args:
        tmp_path: 다운로드된 임시 파일 경로
        data_dir: 저장 디렉토리 (COUPANG_DATA_DIR)
        vendor_id: 벤더 식별자

    Returns:
        저장된 파일의 절대 경로 또는 None
    """
    ymd = _today_str()
    seq = _next_sequence(data_dir, vendor_id, ymd)
    filename = _build_filename(vendor_id, ymd, seq)
    dest_path = os.path.join(data_dir, filename)

    send_log(f"파일 저장: {filename} (차수: {seq})")

    try:
        shutil.copy2(tmp_path, dest_path)
        send_log(f"파일 저장 완료: {dest_path}")
        return dest_path
    except Exception as exc:
        send_error(f"파일 저장 실패: {exc}")
        return None


# ─── 테이블 데이터 추출 (다운로드 실패 시 폴백) ────────────────────

def _extract_table_data(page) -> list:
    """
    페이지의 테이블에서 데이터를 직접 추출한다.
    다운로드 버튼이 없거나 다운로드 실패 시 폴백으로 사용.

    Returns:
        dict 리스트 (rows)
    """
    send_log("테이블 데이터 직접 추출 시도")

    extract_js = """
    () => {
        const table = document.querySelector('table.table, table#dataTable, .table-responsive table');
        if (!table) return { error: 'table not found' };

        const headers = [];
        const headerCells = table.querySelectorAll('thead th, thead td');
        headerCells.forEach(th => headers.push(th.innerText.trim()));

        const rows = [];
        const bodyRows = table.querySelectorAll('tbody tr');
        bodyRows.forEach(tr => {
            const cells = [];
            tr.querySelectorAll('td').forEach(td => cells.push(td.innerText.trim()));
            if (cells.length > 0 && cells.some(c => c !== '')) {
                rows.push(cells);
            }
        });

        return { headers, rows, count: rows.length };
    }
    """

    try:
        result = page.evaluate(extract_js)

        if isinstance(result, dict) and result.get("error"):
            send_log(f"테이블 추출 실패: {result['error']}")
            return []

        headers = result.get("headers", [])
        raw_rows = result.get("rows", [])
        count = result.get("count", 0)

        send_log(f"테이블 추출: {count}행, 컬럼: {headers}")

        if not raw_rows:
            return []

        # 헤더-값 매핑
        rows = []
        for raw in raw_rows:
            row = {}
            for i, val in enumerate(raw):
                if i < len(headers):
                    row[headers[i]] = val
                else:
                    row[f"col{i}"] = val
            rows.append(row)

        return rows

    except Exception as exc:
        send_error(f"테이블 추출 에러: {exc}")
        return []


def _save_extracted_data(rows: list, data_dir: str, vendor_id: str) -> Optional[str]:
    """
    추출된 테이블 데이터를 openpyxl로 xlsx 파일로 저장한다.

    Returns:
        저장된 파일 경로 또는 None
    """
    if not rows:
        send_error("저장할 데이터가 없습니다")
        return None

    ymd = _today_str()
    seq = _next_sequence(data_dir, vendor_id, ymd)
    filename = _build_filename(vendor_id, ymd, seq)
    dest_path = os.path.join(data_dir, filename)

    try:
        import openpyxl

        wb = openpyxl.Workbook()
        ws_data = wb.active
        ws_data.title = "data"

        # 헤더
        if rows:
            headers = list(rows[0].keys())
            ws_data.append(headers)

            # 데이터
            for row in rows:
                ws_data.append([row.get(h, "") for h in headers])

        # _meta 시트
        ws_meta = wb.create_sheet("_meta")
        ws_meta.append(["schemaVersion", 1])
        ws_meta.append(["format", "coupang"])
        ws_meta.append(["vendor", vendor_id])
        ws_meta.append(["date", ymd])
        ws_meta.append(["sequence", seq])
        ws_meta.append(["savedAt", datetime.now().isoformat()])
        ws_meta.append(["source", "po_download_extract"])

        wb.save(dest_path)
        send_log(f"추출 데이터 저장 완료: {dest_path} ({len(rows)}행)")
        return dest_path

    except ImportError:
        send_error("openpyxl 미설치 — pip install openpyxl 필요")
        return None
    except Exception as exc:
        send_error(f"데이터 저장 실패: {exc}")
        return None


# ─── 메인 흐름 ────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="PO SKU 다운로드 자동화")
    parser.add_argument("--vendor", required=True, help="벤더 식별자 (예: basic)")
    parser.add_argument("--date-from", default=None, help="조회 시작일 (YYYY-MM-DD, 기본: 오늘)")
    parser.add_argument("--date-to", default=None, help="조회 종료일 (YYYY-MM-DD, 기본: 오늘)")
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
        # ── 2. 페이지 획득 ──
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

        # ── 4. PO SKU 목록 페이지 이동 ──
        _step_log("NAVIGATE", "START", _get_po_url())
        send_progress(30, "PO 목록 페이지 이동 중")
        if not _navigate_to_po_list(page):
            if _config["skip_login"]:
                _step_log("NAVIGATE", "FAIL", "PO 목록 페이지 이동 실패")
                send_error("PO 목록 페이지 이동 최종 실패")
                sys.exit(1)
            # 세션 만료 시 재로그인 후 재시도
            send_log("PO 페이지 이동 실패 — 재로그인 후 재시도")
            if ensure_logged_in(page, vendor_id):
                if not _navigate_to_po_list(page):
                    _step_log("NAVIGATE", "FAIL", "재시도 실패")
                    send_error("PO 목록 페이지 이동 최종 실패")
                    sys.exit(1)
            else:
                _step_log("NAVIGATE", "FAIL", "재로그인 실패")
                send_error("재로그인 실패")
                sys.exit(1)

        _step_log("NAVIGATE", "OK", page.url)
        send_progress(40, "PO 목록 페이지 도달")

        # ── 5. 필터 설정 ──
        _step_log("FILTER", "START", f"{date_from} ~ {date_to}")
        send_progress(45, "필터 설정 중")
        _set_date_filter(page, date_from, date_to)
        _step_log("FILTER", "OK")

        # ── 6. 검색 실행 ──
        _step_log("SEARCH", "START")
        send_progress(50, "검색 실행 중")
        _click_search(page)
        _clean_modal_backdrops(page)
        _step_log("SEARCH", "OK")

        # ── 7. 다운로드 시도 ──
        _step_log("DOWNLOAD", "START")
        send_progress(60, "다운로드 시도 중")

        saved_path = None
        download = _click_download(page)

        if download:
            send_progress(70, "다운로드 대기 중")
            tmp_path = _poll_download_complete(download)

            if tmp_path:
                send_progress(85, "파일 저장 중")
                saved_path = _save_download(tmp_path, data_dir, vendor_id)
                if saved_path:
                    _step_log("DOWNLOAD", "OK", f"저장: {saved_path}")
                    _step_log("SAVE", "OK", saved_path)
                else:
                    _step_log("DOWNLOAD", "FAIL", "파일 저장 실패")
            else:
                _step_log("DOWNLOAD", "FAIL", "다운로드 완료 대기 실패")
        else:
            _step_log("DOWNLOAD", "FAIL", "다운로드 버튼 미발견")
            send_log("다운로드 버튼 미발견 — 테이블 데이터 직접 추출 시도")

        # ── 8. 폴백: 테이블 데이터 직접 추출 ──
        if not saved_path:
            _step_log("EXTRACT", "START")
            send_progress(75, "테이블 데이터 추출 중")
            rows = _extract_table_data(page)
            if rows:
                send_progress(85, "추출 데이터 저장 중")
                saved_path = _save_extracted_data(rows, data_dir, vendor_id)
                if saved_path:
                    _step_log("EXTRACT", "OK", f"저장: {saved_path}")
                    _step_log("SAVE", "OK", saved_path)
                else:
                    _step_log("EXTRACT", "FAIL", "추출 데이터 저장 실패")
            else:
                _step_log("EXTRACT", "FAIL", "테이블 데이터 없음")
                send_error(
                    "다운로드와 테이블 추출 모두 실패했습니다. "
                    "페이지에 데이터가 없거나 셀렉터가 변경되었을 수 있습니다."
                )

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
