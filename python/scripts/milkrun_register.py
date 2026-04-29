"""
milkrun_register.py — 밀크런 대량 접수 폼 채움 (저장 직전 정지)

쿠팡 서플라이어 허브의 /milkrun/batchRegister 페이지에서, transport.json 의
'밀크런' assignment 들을 읽어 센터별 행을 채운다. **저장(#batchRegisterMilkrun)
버튼은 절대 클릭하지 않는다** — 운영자가 웹 뷰에서 직접 검토 후 수동 클릭.

흐름:
    1. CDP attach → 기존 페이지 재사용
    2. 로그인 보장
    3. /milkrun/batchRegister?warehousingPlannedAt={date} 로 이동
    4. 진입 공지 모달 자동 dismiss + backdrop 정리
    5. #boxCount_0 대기 — 행 로드
    6. enabled 행의 첫 번째 td 에서 센터명 추출 → transport.json 과 매칭
    7. 매칭된 행마다 출고지·박스수·팔레트·중량·상품종류·렌탈사 채움
    8. 하단 동의 체크박스 4개 (#milkrunGuidCheck1~4) 체크
    9. 여기서 정지 — 저장은 사용자 수동

인자:
    --vendor    <vendor_id>    벤더 식별자 (필수)
    --date      <YYYY-MM-DD>   밀크런 입고예정일 (필수)
    --sequence  <NN>           작업 차수 (필수, transport.json 위치 해석용)
    --skip-login               로그인 단계 건너뛰기

종료 코드:
    0 — 폼 채움 성공 (사용자 수동 저장 대기) 또는 처리할 밀크런 없음
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

BATCH_REGISTER_PATH = "/milkrun/batchRegister"

BUTTON_TIMEOUT_MS = 15_000
INTRO_DISMISS_ATTEMPTS = 6
INTRO_DISMISS_INTERVAL = 0.5

DEFAULT_WEIGHT = 999
DEFAULT_PRODUCT_TYPE = "상품"
DEFAULT_PALLET_RENTAL = "아주팔레트"

# 부트스트랩 좀비 모달 + backdrop 정리 JS (po_upload / reference 통합)
CLEANUP_MODALS_JS = """
() => {
    document.querySelectorAll('.modal.bootstrap-dialog').forEach(m => {
        if (m.offsetParent === null) {
            m.classList.remove('in');
            m.style.display = 'none';
            m.setAttribute('aria-hidden', 'true');
        }
    });
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}
"""

# 진입 공지 모달 dismiss 시도 — 보이는 .btn-default / close 클릭
DISMISS_DIALOG_JS = """
() => {
    const modals = Array.from(document.querySelectorAll('.modal.in, .modal[style*="display: block"]'));
    let dismissed = 0;
    for (const m of modals) {
        if (m.offsetParent === null) continue;
        // 우선순위: .btn-default (동의/확인) → [data-dismiss="modal"] → .close
        const btn = m.querySelector('.btn-default, button[data-dismiss="modal"], .close');
        if (btn) {
            btn.click();
            dismissed += 1;
        }
    }
    return dismissed;
}
"""


_config = {
    "skip_login": False,
}


def _step_log(step: str, status: str, message: str = "") -> None:
    text = f"[STEP:{step}:{status}]"
    if message:
        text += f" {message}"
    send_log(text)


def _cleanup_modals(page) -> None:
    try:
        page.evaluate(CLEANUP_MODALS_JS)
    except Exception:
        pass


def _dismiss_intro_dialogs(page) -> None:
    """공지/약관 모달이 fade-in 으로 늦게 뜨는 경우를 polling 으로 처리."""
    for attempt in range(INTRO_DISMISS_ATTEMPTS):
        time.sleep(INTRO_DISMISS_INTERVAL)
        try:
            dismissed = page.evaluate(DISMISS_DIALOG_JS)
            if dismissed and dismissed > 0:
                send_log(f"진입 모달 dismiss: {dismissed}개 (attempt {attempt + 1})")
                time.sleep(0.3)
                _cleanup_modals(page)
                break
        except Exception:
            continue
    # fade-out 여유
    time.sleep(1.0)
    _cleanup_modals(page)


# ─── transport.json 로드 ───────────────────────────────────────────

def _resolve_transport_path(vendor: str, date: str, sequence: int) -> str:
    data_dir = os.environ.get("COUPANG_DATA_DIR")
    if not data_dir:
        send_error("COUPANG_DATA_DIR 미설정")
        sys.exit(1)
    return os.path.join(
        data_dir, date, vendor, f"{sequence:02d}", "transport.json",
    )


def _load_milkrun_entries(path: str) -> list[dict]:
    """transport.json → 밀크런 entries (센터명 포함, 원본 필드 유지)."""
    if not os.path.exists(path):
        send_error(f"transport.json 이 없습니다: {path}")
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        send_error(f"transport.json 파싱 실패: {exc}")
        return []

    assignments = data.get("assignments") or {}
    entries = []
    for center, a in assignments.items():
        if not isinstance(a, dict):
            continue
        if a.get("transportType") != "밀크런":
            continue
        entries.append({
            "center": center,
            "originId": str(a.get("originId") or "").strip(),
            "totalBoxes": str(a.get("totalBoxes") or "").strip(),
            "pallets": a.get("pallets") or [],
        })
    return entries


# ─── 페이지 조작 ───────────────────────────────────────────────────

def _build_batch_url(date: str) -> str:
    return f"https://supplier.coupang.com{BATCH_REGISTER_PATH}?warehousingPlannedAt={date}"


def _navigate_to_batch_register(page, date: str) -> bool:
    url = _build_batch_url(date)
    send_log(f"밀크런 대량 접수 페이지로 이동: {url}")
    try:
        page.goto(url, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_error(f"page.goto 실패: {exc}")
        return False
    page.wait_for_timeout(1500)
    _cleanup_modals(page)
    if BATCH_REGISTER_PATH not in page.url:
        send_error(f"대상 경로에 도달하지 못함 — 현재 URL: {page.url}")
        return False
    return True


def _count_rows(page) -> int:
    try:
        return page.locator('input[id^="boxCount_"]').count()
    except Exception:
        return 0


def _enabled_row_indices(page, total: int) -> list[int]:
    """출고지 버튼이 enabled 인 행만 처리 대상."""
    enabled = []
    for i in range(total):
        try:
            btn = page.locator(f"#releaseAddressImport_{i}")
            if btn.count() == 0:
                continue
            if btn.first.is_enabled():
                enabled.append(i)
        except Exception:
            continue
    return enabled


def _read_row_center(page, index: int) -> str:
    """행의 첫 td 에서 센터명 추출. '안성4(14)' → '안성4'."""
    try:
        text = page.locator(f"#boxCount_{index}").evaluate(
            """el => {
                const tr = el.closest('tr');
                if (!tr) return '';
                const td = tr.querySelector('td');
                return td ? td.innerText.trim() : '';
            }"""
        )
    except Exception:
        return ""
    if not text:
        return ""
    i = text.find("(")
    return text[:i].strip() if i > 0 else text.strip()


def _fill_one_row(page, *, index: int, entry: dict, weight: int,
                  product_type: str, rental_company: str) -> dict:
    """단일 행 폼 채움. 실패 시 dict['error'] 에 사유."""
    result = {
        "index": index,
        "center": entry["center"],
        "boxCount": entry["totalBoxes"],
        "palletCount": len(entry["pallets"]),
        "error": None,
    }
    location_seq = entry["originId"]
    if not location_seq:
        result["error"] = "originId(출고지 seq) 미설정"
        return result

    try:
        _cleanup_modals(page)

        # 1) 출고지 선택 버튼 → 모달
        page.locator(f"#releaseAddressImport_{index}").click(timeout=BUTTON_TIMEOUT_MS)

        # 모달이 뜨는 동안 잠깐 대기 (fade-in)
        time.sleep(0.6)

        # 2) 모달에서 location_seq 선택 — 대기 전에 현재 DOM 에서 가용한 seq 들을 먼저 스냅.
        #    wait_for 타임아웃 시 사용자가 어떤 seq 가 실제로 있는지 볼 수 있게.
        loc_sel = (
            f'button[name="selectLocation"]'
            f'[data-supplier-milkrun-location-seq="{location_seq}"]'
        )
        loc_btn = page.locator(loc_sel)
        # 주의: 여기서 _cleanup_modals 를 부르면 방금 연 출고지 모달의 backdrop·body 상태까지
        # 함께 정리해서 모달이 "닫히는 중" 으로 진입, 내부 버튼이 hidden 이 된다. 부르지 않는다.
        try:
            loc_btn.first.wait_for(state="visible", timeout=BUTTON_TIMEOUT_MS)
        except Exception as wait_exc:
            # 진단 — 가용 seq 와 해당 출고지명 전부 로그
            try:
                # 버튼 자체 텍스트는 "선택" 이라 출고지 이름은 상위 tr 의 다른 td 에서 찾음.
                # 보통 첫 번째 td 가 이름/주소. 주소는 보조로 같이 제공.
                available = page.eval_on_selector_all(
                    'button[name="selectLocation"]',
                    """btns => btns
                        .filter(b => b.offsetParent !== null)
                        .map(b => {
                            const seq = b.getAttribute('data-supplier-milkrun-location-seq');
                            const tr = b.closest('tr');
                            let label = '';
                            let addr = '';
                            if (tr) {
                                const tds = Array.from(tr.querySelectorAll('td'))
                                    .map(td => (td.innerText || '').trim())
                                    .filter(t => t && t !== '선택');
                                label = tds[0] || '';
                                addr = tds.slice(1).join(' | ').slice(0, 80);
                            }
                            return { seq, label, addr };
                        })""",
                )
            except Exception:
                available = []
            if available:
                send_log(f"[진단] row {index} 모달 내 가용 출고지 목록 ({len(available)}개):")
                for a in available:
                    line = f"  seq={a.get('seq')!r}  name={a.get('label', '')!r}"
                    if a.get('addr'):
                        line += f"  addr={a.get('addr')!r}"
                    send_log(line)
                send_log(
                    f"[진단] 현재 요청한 seq={location_seq!r} 이 위 목록에 없습니다. "
                    "앱 설정 → 밀크런 기본 출고지 관리에서 올바른 seq 로 수정 후, "
                    "운송 분배 모달에서 해당 센터 출고지 재선택·저장하세요."
                )
            else:
                send_log(
                    f"[진단] row {index} 모달 내 selectLocation 버튼 0개 "
                    "— 모달이 안 열렸거나 사이트 DOM 구조가 변경됐을 수 있음"
                )
            raise wait_exc

        # 여러 모달이 stacking 되면서 오래된 backdrop 이 남아있으면 pointer events 가
        # 가로채지고, 심지어 force click 도 site 의 실제 핸들러까지 이벤트를 전달 못 함
        # (좌표상 backdrop 이 위에 있어서). 현재 모달의 backdrop(마지막 것)만 남기고
        # 이전 stale 들은 제거.
        page.evaluate(
            """() => {
                const bds = document.querySelectorAll('.modal-backdrop');
                if (bds.length > 1) {
                    for (let i = 0; i < bds.length - 1; i += 1) bds[i].remove();
                }
            }"""
        )

        # 클릭 방식을 순차 시도 + 매번 supplierLocationSeq_i 에 값이 박혔는지 검증.
        # JS click 이 가장 안정적 (backdrop 과 무관하게 요소에서 직접 이벤트 발사).
        click_methods = [
            ("js", lambda: loc_btn.first.evaluate("el => el.click()")),
            ("force", lambda: loc_btn.first.click(force=True, timeout=3_000)),
            ("normal", lambda: loc_btn.first.click(timeout=3_000)),
        ]

        applied = ""
        for method_name, do_click in click_methods:
            try:
                do_click()
            except Exception as exc:
                send_log(f"row {index} selectLocation ({method_name}) 예외: {exc}")
                continue
            time.sleep(0.7)
            try:
                applied = page.locator(
                    f"#supplierLocationSeq_{index}"
                ).input_value(timeout=1_500)
            except Exception:
                applied = ""
            if applied:
                send_log(
                    f"row {index} selectLocation — {method_name} click 적용됨 (seq={applied})"
                )
                break

        if not applied:
            result["error"] = "출고지 적용 실패 — 모든 click 방식에서 supplierLocationSeq 비어있음"
            return result

        # 선택 완료 후 모달이 닫히며 backdrop 잔재가 있을 수 있음 — 정리.
        _cleanup_modals(page)

        # 4) 박스 수량
        page.locator(f"#boxCount_{index}").fill(
            str(entry["totalBoxes"]), timeout=BUTTON_TIMEOUT_MS,
        )

        # 5) 팔레트 — 사이즈별로 1 row 씩 추가, 값 채움
        #
        # transport.json 의 pallet 필드와 UI placeholder 매핑이 어긋나 있음에 주의:
        #   transport.json key → UI placeholder → 쿠팡 사이트 input name
        #   pallet.width       → "가로"         → input[name="length"]
        #   pallet.height      → "세로"         → input[name="width"]    (!)
        #   pallet.depth       → "높이"         → input[name="height"]   (!)
        # TransportView UI 저장 구조가 이렇게 저장하고 있어서, 여기서는
        # 사용자의 '가로-세로-높이' 순서를 지키기 위해 key 이름이 아닌 '의미' 로 매핑.
        rental_for_row = rental_company

        # 같은 프리셋(이름·치수·렌탈사 동일) 끼리 묶어 한 행에 count=N 으로 입력.
        # 예: "아주팔레트 대" 가 5개면 5줄이 아니라 1줄 × count=5.
        # 그룹 순서는 첫 등장 순.
        groups: list[dict] = []  # [{key, sample, count}]
        for p in entry["pallets"]:
            key = (
                str(p.get("presetName") or "").strip(),
                str(p.get("width")  or "").strip(),
                str(p.get("height") or "").strip(),
                str(p.get("depth")  or "").strip(),
                str(p.get("rentalId") or "").strip(),
            )
            existing = next((g for g in groups if g["key"] == key), None)
            if existing:
                existing["count"] += int(str(p.get("count") or "1") or "1")
            else:
                groups.append({
                    "key": key,
                    "sample": p,
                    "count": int(str(p.get("count") or "1") or "1"),
                })

        for g in groups:
            pallet = g["sample"]
            page.locator(f"#addPallet_{index}").click(timeout=BUTTON_TIMEOUT_MS)
            time.sleep(0.3)
            pallet_body = page.locator(f"#palletBody_{index}")
            last_row = pallet_body.locator("tr").last
            horizontal = str(pallet.get("width")  or "").strip()  # '가로'
            vertical   = str(pallet.get("height") or "").strip()  # '세로' (key='height')
            tall       = str(pallet.get("depth")  or "").strip()  # '높이' (key='depth')
            pc = str(g["count"])  # 그룹 사이즈
            if horizontal:
                last_row.locator('input[name="length"]').fill(horizontal, timeout=BUTTON_TIMEOUT_MS)
            if vertical:
                last_row.locator('input[name="width"]').fill(vertical, timeout=BUTTON_TIMEOUT_MS)
            if tall:
                last_row.locator('input[name="height"]').fill(tall, timeout=BUTTON_TIMEOUT_MS)
            last_row.locator('input[name="count"]').fill(pc, timeout=BUTTON_TIMEOUT_MS)
            pallet_rental = str(pallet.get("rentalId") or "").strip()
            if pallet_rental:
                rental_for_row = pallet_rental

        # 6) 총 중량
        page.locator(f"#weight_{index}").fill(str(weight), timeout=BUTTON_TIMEOUT_MS)

        # 7) 상품 종류
        page.locator(f"#contents_{index}").fill(product_type, timeout=BUTTON_TIMEOUT_MS)

        # 8) 팔레트 렌탈사 select
        try:
            page.locator(f"#pltRentalCompany_{index}").select_option(
                value=rental_for_row, timeout=BUTTON_TIMEOUT_MS,
            )
        except Exception:
            # value 가 안 맞으면 label 로 재시도
            page.locator(f"#pltRentalCompany_{index}").select_option(
                label=rental_for_row, timeout=BUTTON_TIMEOUT_MS,
            )

        send_log(
            f"row {index} filled: center={entry['center']} "
            f"box={entry['totalBoxes']} pallets={len(entry['pallets'])} "
            f"weight={weight} product={product_type!r}"
        )
        return result
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result


def _check_final_consent(page) -> int:
    """하단 동의 체크박스 4개 체크."""
    checked = 0
    for i in range(1, 5):
        sel = f"#milkrunGuidCheck{i}"
        try:
            cb = page.locator(sel)
            if cb.count() == 0:
                continue
            if cb.is_checked():
                checked += 1
                continue
            try:
                cb.check(timeout=3_000)
            except Exception:
                cb.check(force=True, timeout=3_000)
            checked += 1
        except Exception as exc:
            send_log(f"동의 체크박스 {sel} 실패: {exc}")
    return checked


# ─── 메인 ────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="밀크런 대량 접수 폼 채움")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--skip-login", action="store_true")
    parser.add_argument("--weight", type=int, default=DEFAULT_WEIGHT)
    parser.add_argument("--product-type", default=DEFAULT_PRODUCT_TYPE)
    parser.add_argument("--rental-company", default=DEFAULT_PALLET_RENTAL)
    return parser.parse_args()


def main():
    args = parse_args()
    _config["skip_login"] = args.skip_login
    vendor_id = args.vendor.strip().lower()

    send_log("=" * 60)
    send_log("milkrun_register.py — 밀크런 대량 접수 (저장 직전 정지)")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  작업: {args.date} · {args.sequence}차")
    send_log(f"  기본값: weight={args.weight} product={args.product_type!r} rental={args.rental_company!r}")
    send_log("=" * 60)

    # ── transport.json 로드 & 밀크런 필터 ──
    _step_log("LOAD_PLAN", "START")
    tpath = _resolve_transport_path(vendor_id, args.date, args.sequence)
    entries = _load_milkrun_entries(tpath)
    if not entries:
        _step_log("LOAD_PLAN", "EMPTY", "밀크런으로 지정된 센터가 없음")
        send_log("[Milkrun Entries: 0] 처리할 밀크런 assignment 없음 — 종료")
        send({"type": "result", "data": json.dumps({
            "success": True, "status": "no_entries",
            "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
        }, ensure_ascii=False)})
        sys.exit(0)
    _step_log("LOAD_PLAN", "OK", f"{len(entries)}개 센터 (밀크런)")
    for e in entries:
        send_log(
            f"  - {e['center']}: originId={e['originId']} "
            f"box={e['totalBoxes']} pallets={len(e['pallets'])}"
        )

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
        _cleanup_modals(page)
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

        # ── 페이지 이동 ──
        _step_log("NAVIGATE", "START", f"{BATCH_REGISTER_PATH}?{args.date}")
        send_progress(35, "대량 접수 페이지로 이동")
        if not _navigate_to_batch_register(page, args.date):
            _step_log("NAVIGATE", "FAIL")
            sys.exit(1)
        _step_log("NAVIGATE", "OK", page.url)

        # ── 진입 모달 dismiss ──
        _step_log("DISMISS_INTRO", "START")
        _dismiss_intro_dialogs(page)
        _step_log("DISMISS_INTRO", "OK")

        # ── 행 로드 대기 ──
        _step_log("ROWS_WAIT", "START")
        try:
            page.locator("#boxCount_0").wait_for(state="attached", timeout=BUTTON_TIMEOUT_MS)
        except Exception:
            _step_log("ROWS_WAIT", "EMPTY", "검색 결과 0건")
            send_log("[Milkrun Rows: 0] 사이트에 표시된 행 없음")
            send({"type": "result", "data": json.dumps({
                "success": True, "status": "no_rows",
                "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
            }, ensure_ascii=False)})
            sys.exit(0)

        total = _count_rows(page)
        enabled = _enabled_row_indices(page, total)
        _step_log("ROWS_WAIT", "OK", f"total={total} enabled={len(enabled)}")

        if not enabled:
            send_log("처리 가능한(enabled) 행 없음 — 종료")
            send({"type": "result", "data": json.dumps({
                "success": True, "status": "no_enabled_rows",
                "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
            }, ensure_ascii=False)})
            sys.exit(0)

        # ── 센터명 ↔ entry 매칭 후 폼 채움 ──
        _step_log("FILL_ROWS", "START", f"entries={len(entries)}")
        send_progress(50, "행 채움 중")
        entry_by_center = {e["center"]: e for e in entries}

        results = []
        skipped_centers = []
        for idx in enabled:
            center = _read_row_center(page, idx)
            entry = entry_by_center.get(center)
            if entry is None:
                send_log(f"row {idx} center={center!r} — 매칭되는 transport 항목 없음 (건너뜀)")
                skipped_centers.append({"index": idx, "center": center})
                continue
            r = _fill_one_row(
                page,
                index=idx,
                entry=entry,
                weight=args.weight,
                product_type=args.product_type,
                rental_company=args.rental_company,
            )
            results.append(r)
            if r["error"]:
                _step_log("FILL_ROWS", "FAIL", f"row {idx}: {r['error']}")
                send_error(f"row {idx} ({r['center']}) 채움 실패: {r['error']}")
                sys.exit(1)

        _step_log("FILL_ROWS", "OK", f"{len(results)}행 채움")

        # ── 하단 동의 체크박스 ──
        _step_log("CONSENT", "START")
        send_progress(85, "동의 체크박스")
        checked = _check_final_consent(page)
        _step_log("CONSENT", "OK", f"{checked}/4")

        # ── 여기서 정지 ──
        _step_log("READY_TO_SUBMIT", "OK",
                  "웹 뷰에서 직접 '저장' (#batchRegisterMilkrun) 을 누르세요")
        send_progress(100, "밀크런 폼 채움 완료 — 수동 저장 대기")

        result_payload = {
            "success": True,
            "status": "filled",
            "readyToSubmit": True,
            "vendor": vendor_id,
            "date": args.date,
            "sequence": args.sequence,
            "rowsFilled": results,
            "rowsSkipped": skipped_centers,
            "consentChecked": checked,
            "finalUrl": page.url,
            "submitSelector": "#batchRegisterMilkrun",
            "note": "저장 버튼은 수동 — 웹 뷰에서 내용 확인 후 직접 클릭",
        }
        send({"type": "result", "data": json.dumps(result_payload, ensure_ascii=False)})
        send_log(f"[Milkrun Ready] {len(results)}행 채움 · 동의 {checked}/4 — 수동 저장 대기")
        send_log("=" * 60)

    finally:
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
