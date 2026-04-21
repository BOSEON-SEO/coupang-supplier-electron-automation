"""
shipment_register.py — 쿠팡 쉽먼트(택배) 폼 채움 (생성 버튼 클릭 직전 정지)

transport.json 의 `transportType === '쉽먼트'` assignment 중 하나를 골라,
쉽먼트 생성 4단계를 진행한다. **최종 #btn-create / '생성' 버튼은 절대 클릭하지 않음**
— 운영자가 웹 뷰에서 직접 검토 후 수동 클릭.

흐름 (reference 기준):
    1. /ibs/asn/active?type=parcel 진입 → '쉽먼트 생성' 버튼 → 출고지 모달
       → shipFromSeq 선택 → '다음' 클릭 → /ibs/shipment/parcel/form 도착
    2. FC select (센터명 매칭) + 입고예정일 → 검색 → 발주서 체크 → '발주서 선택 완료'
    3. #splitCount 에 박스 수량 입력 → 다음
    4. SKU 테이블에서 발주번호+바코드 매칭 → 박스 배정 + 수량 입력 (분할 배정 지원)

실행 환경 (Electron Main 이 python:run 에서 자동 설정):
    CDP_ENDPOINT, COUPANG_DATA_DIR, COUPANG_ID_{VENDOR} / COUPANG_PW_{VENDOR}

인자:
    --vendor     <vendor_id>
    --date       <YYYY-MM-DD>
    --sequence   <NN>
    --center     <warehouse>    # 처리할 센터 하나 (생략 시 쉽먼트 첫 번째)
    --ship-from  <seq>          # 출고지 seq (생략 시 기본값)
    --skip-login

종료 코드: 0 성공(수동 생성 대기) / 쉽먼트 없음 · 1 실패
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
SHIPMENT_FORM_PATH = "/ibs/shipment/parcel/form"

BUTTON_TIMEOUT_MS = 15_000
INTRO_DISMISS_ATTEMPTS = 6
INTRO_DISMISS_INTERVAL = 0.5

# 기본 출고지 (벤더 설정 없을 때 폴백) — 나중에 settings 로 빼낼 것
DEFAULT_SHIP_FROM_SEQ = "6016"


# 공지 모달 dismiss + 좀비 backdrop 정리
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

DISMISS_DIALOG_JS = """
() => {
    const modals = Array.from(document.querySelectorAll('.modal.in, .modal[style*="display: block"]'));
    let dismissed = 0;
    for (const m of modals) {
        if (m.offsetParent === null) continue;
        const btn = m.querySelector('.btn-default, button[data-dismiss="modal"], .close');
        if (btn) { btn.click(); dismissed += 1; }
    }
    return dismissed;
}
"""


_config = {"skip_login": False}


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


def _load_already_registered_centers(vendor: str, date: str, sequence: int) -> set:
    """manifest.json 의 shipmentHistory 에서 이미 처리된 센터명 집합을 반환."""
    data_dir = os.environ.get("COUPANG_DATA_DIR")
    if not data_dir:
        return set()
    mpath = os.path.join(
        data_dir, date, vendor, f"{sequence:02d}", "manifest.json",
    )
    if not os.path.exists(mpath):
        return set()
    try:
        with open(mpath, "r", encoding="utf-8") as f:
            m = json.load(f)
    except Exception:
        return set()
    hist = m.get("shipmentHistory") or []
    return {
        str(h.get("center") or "").strip()
        for h in hist
        if isinstance(h, dict) and h.get("center")
    }


def _parse_row_key(row_key: str) -> tuple:
    """rowKey '{order}|{barcode}|{row}' → (order, barcode)."""
    parts = str(row_key).split("|")
    order = parts[0] if len(parts) > 0 else ""
    barcode = parts[1] if len(parts) > 1 else ""
    return order, barcode


def _load_shipment_entries(path: str) -> list[dict]:
    """transport.json → 쉽먼트 entries (센터 단위).

    각 entry:
        {
          "center": str,
          "boxCount": int,
          "skus": [
              {
                  "po_number": str, "barcode": str,
                  "boxes": [{"box_num": int, "qty": int}, ...]
              },
              ...
          ],
        }
    """
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
        if a.get("transportType") != "쉽먼트":
            continue
        box_count_val = a.get("boxCount")
        try:
            box_count = int(box_count_val) if box_count_val is not None else 0
        except Exception:
            box_count = 0
        sku_boxes = a.get("skuBoxes") or {}
        skus = []
        for row_key, box_assigns in sku_boxes.items():
            if not isinstance(box_assigns, list) or not box_assigns:
                continue
            order, barcode = _parse_row_key(row_key)
            if not order or not barcode:
                continue
            boxes = []
            for b in box_assigns:
                try:
                    box_num = int(str(b.get("boxNo") or "").strip() or 0)
                    qty = int(b.get("qty") or 0)
                except Exception:
                    continue
                if box_num <= 0 or qty <= 0:
                    continue
                boxes.append({"box_num": box_num, "qty": qty})
            if not boxes:
                continue
            skus.append({"po_number": order, "barcode": barcode, "boxes": boxes})
        if not skus:
            continue
        # boxCount 가 0 인데 skuBoxes 에서 최대 박스번호 추정 가능
        if box_count <= 0:
            box_count = max(b["box_num"] for s in skus for b in s["boxes"])
        entries.append({"center": center, "boxCount": box_count, "skus": skus})
    return entries


# ─── Step 1: 리스트 → 생성 모달 → 폼 진입 ────────────────────────

def _step1_open_form(page, vendor: str, ship_from_seq: str) -> bool:
    url = f"https://supplier.coupang.com{SHIPMENT_LIST_PATH}?type=parcel"
    send_log(f"쉽먼트 리스트로 이동: {url}")
    try:
        page.goto(url, timeout=LOGIN_NAVIGATION_TIMEOUT, wait_until="domcontentloaded")
    except Exception as exc:
        send_error(f"쉽먼트 리스트 이동 실패: {exc}")
        return False
    page.wait_for_timeout(1500)
    _dismiss_intro_dialogs(page)

    # '쉽먼트 생성' 버튼 클릭
    try:
        page.locator("#createShipmentBtn").click(timeout=BUTTON_TIMEOUT_MS)
    except Exception as exc:
        send_error(f"#createShipmentBtn 클릭 실패: {exc}")
        return False

    time.sleep(1.0)
    _cleanup_modals(page)

    # 출고지 select — 값이 이미 1개뿐이면 자동 선택일 수 있어 실패 무시
    if ship_from_seq:
        try:
            page.locator("#shipFromSeq").select_option(
                value=ship_from_seq, timeout=5_000,
            )
            send_log(f"출고지 선택: seq={ship_from_seq}")
        except Exception as exc:
            send_log(f"shipFromSeq select_option 생략 (자동선택 가능): {exc}")

    # '다음' 클릭
    clicked = False
    try:
        page.locator("#goCreate").click(timeout=5_000)
        clicked = True
    except Exception:
        try:
            page.get_by_role("button", name="다음").click(timeout=5_000)
            clicked = True
        except Exception as exc:
            send_error(f"'다음' 버튼 클릭 실패: {exc}")

    if not clicked:
        return False

    time.sleep(2.0)
    _cleanup_modals(page)

    if SHIPMENT_FORM_PATH not in page.url:
        send_error(f"쉽먼트 폼 페이지에 도달 못함 — 현재 URL: {page.url}")
        return False
    send_log(f"쉽먼트 폼 도착: {page.url}")
    return True


# ─── Step 2: 센터 + 날짜 필터 → 발주서 선택 ───────────────────────

def _step2_select_po(page, center: str, date: str, po_numbers: list) -> bool:
    try:
        fc = page.locator('select[name="fcCode"]')
        fc.wait_for(state="visible", timeout=BUTTON_TIMEOUT_MS)
    except Exception as exc:
        send_error(f"FC 선택 필터 로드 실패: {exc}")
        return False

    # 센터명이 option text 에 포함된 값 찾기
    matched = page.evaluate(
        """(name) => {
            const sel = document.querySelector('select[name="fcCode"]');
            if (!sel) return null;
            for (const opt of sel.options) {
                if (opt.text.includes(name)) return opt.value;
            }
            return null;
        }""",
        center,
    )
    if not matched:
        send_error(f"FC 목록에 '{center}' 가 없음")
        return False
    fc.select_option(value=matched, timeout=5_000)
    send_log(f"FC 선택: {center} (value={matched})")

    # 입고예정일
    try:
        page.locator('input[name="edd"]').fill(date, timeout=5_000)
    except Exception as exc:
        send_error(f"입고예정일 입력 실패: {exc}")
        return False

    # 검색
    try:
        page.locator("#searchPO").click(timeout=BUTTON_TIMEOUT_MS)
    except Exception as exc:
        send_error(f"발주서 검색 클릭 실패: {exc}")
        return False
    time.sleep(2.0)

    # 발주서 체크 — po_numbers 가 있으면 매칭 행만, 아니면 전체
    if po_numbers:
        checked = page.evaluate(
            """(poList) => {
                const rows = document.querySelectorAll('input[name="poSelected"]');
                let n = 0;
                rows.forEach(cb => {
                    const tr = cb.closest('tr');
                    if (!tr) return;
                    const text = tr.innerText;
                    for (const po of poList) {
                        if (text.includes(po)) {
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                            n += 1;
                            break;
                        }
                    }
                });
                return n;
            }""",
            po_numbers,
        )
        send_log(f"발주서 체크: {checked}건 (요청 {len(po_numbers)}건)")
    else:
        try:
            page.locator("#check-all").check(timeout=5_000)
            send_log("발주서 전체 선택")
        except Exception as exc:
            send_error(f"전체 선택 실패: {exc}")
            return False

    time.sleep(0.5)

    # '발주서 선택 완료'
    try:
        page.locator('button[name="confirmed"]').click(timeout=BUTTON_TIMEOUT_MS)
    except Exception as exc:
        send_error(f"'발주서 선택 완료' 클릭 실패: {exc}")
        return False
    time.sleep(2.0)
    _cleanup_modals(page)
    return True


# ─── Step 3: 박스 수량 → 다음 ────────────────────────────────────

def _step3_set_box_count(page, box_count: int) -> bool:
    try:
        inp = page.locator("#splitCount")
        inp.wait_for(state="visible", timeout=BUTTON_TIMEOUT_MS)
        inp.fill(str(box_count), timeout=5_000)
    except Exception as exc:
        send_error(f"#splitCount 입력 실패: {exc}")
        return False
    time.sleep(0.5)

    clicked = False
    for label in ("다음", "적용", "확인"):
        try:
            page.get_by_role("button", name=label).click(timeout=3_000)
            clicked = True
            break
        except Exception:
            continue
    if not clicked:
        try:
            page.locator("button.primary-button:visible").first.click(timeout=5_000)
            clicked = True
        except Exception:
            pass
    if not clicked:
        send_error("박스 수 확인 후 다음 버튼을 찾지 못함")
        return False
    time.sleep(2.0)
    _cleanup_modals(page)
    send_log(f"박스 수량 설정: {box_count}")
    return True


# ─── Step 4: SKU 별 박스 배정 + 수량 입력 ────────────────────────

def _step4_fill_sku_assignments(page, skus: list) -> int:
    """filled SKU count 반환."""
    filled = 0
    for sku in skus:
        order = sku["po_number"]
        barcode = sku["barcode"]
        boxes = sku["boxes"]
        try:
            row_idx = page.evaluate(
                """([po, bc]) => {
                    const rows = document.querySelectorAll('table tbody tr');
                    for (let i = 0; i < rows.length; i += 1) {
                        const t = rows[i].innerText;
                        if (t.includes(po) && t.includes(bc)) return i;
                    }
                    return -1;
                }""",
                [order, barcode],
            )
            if row_idx < 0:
                send_log(f"SKU 미매칭: po={order} barcode={barcode} (행 없음)")
                continue

            # 첫 박스 → 기존 행
            first = boxes[0]
            row = page.locator("table tbody tr").nth(row_idx)
            row.locator('select[name="parcel"]').select_option(
                value=f"박스 {first['box_num']}", timeout=5_000,
            )
            row.locator('input[name="shippingQty"]').fill(
                str(first["qty"]), timeout=5_000,
            )

            # 분할 — '+' 버튼 → 다음 행에 입력
            for extra in boxes[1:]:
                try:
                    add_btn = row.locator(
                        "button.primary2-button, button.btn-sm"
                    ).first
                    add_btn.click(timeout=5_000)
                    time.sleep(0.4)
                    row_idx += 1
                    new_row = page.locator("table tbody tr").nth(row_idx)
                    new_row.locator('select[name="parcel"]').select_option(
                        value=f"박스 {extra['box_num']}", timeout=5_000,
                    )
                    new_row.locator('input[name="shippingQty"]').fill(
                        str(extra["qty"]), timeout=5_000,
                    )
                except Exception as exc:
                    send_log(
                        f"분할 배정 실패 po={order} barcode={barcode} "
                        f"box={extra['box_num']}: {exc}"
                    )
            filled += 1
        except Exception as exc:
            send_log(f"SKU 채움 실패 po={order} barcode={barcode}: {exc}")
    return filled


# ─── 메인 ────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="쉽먼트 폼 채움 (생성 직전 정지)")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--center", default=None, help="처리할 센터명 (생략 시 쉽먼트 첫 번째)")
    parser.add_argument("--ship-from", default=DEFAULT_SHIP_FROM_SEQ)
    parser.add_argument("--skip-login", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    _config["skip_login"] = args.skip_login
    vendor_id = args.vendor.strip().lower()

    send_log("=" * 60)
    send_log("shipment_register.py — 쉽먼트 폼 채움 (생성 직전 정지)")
    send_log(f"  벤더: {vendor_id}")
    send_log(f"  작업: {args.date} · {args.sequence}차")
    send_log(f"  출고지 seq: {args.ship_from}")
    send_log("=" * 60)

    # ── transport.json 로드 & 쉽먼트 필터 ──
    _step_log("LOAD_PLAN", "START")
    tpath = _resolve_transport_path(vendor_id, args.date, args.sequence)
    entries = _load_shipment_entries(tpath)
    if not entries:
        _step_log("LOAD_PLAN", "EMPTY", "쉽먼트로 지정된 센터가 없음")
        send({"type": "result", "data": json.dumps({
            "success": True, "status": "no_entries",
            "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
        }, ensure_ascii=False)})
        sys.exit(0)

    # manifest.shipmentHistory 기준으로 이미 처리된 센터 제외 (--center 명시 시엔 무시)
    already = _load_already_registered_centers(vendor_id, args.date, args.sequence)
    pending = [e for e in entries if e["center"] not in already]

    # 처리할 센터 선택 — --center 우선, 아니면 pending 첫 번째
    target_entry = None
    if args.center:
        for e in entries:
            if e["center"] == args.center:
                target_entry = e
                break
        if target_entry is None:
            send_error(f"지정된 센터 '{args.center}' 가 쉽먼트 목록에 없음")
            sys.exit(1)
        if args.center in already:
            send_log(f"⚠ '{args.center}' 는 이미 shipmentHistory 에 있음 — 그대로 진행")
    else:
        if not pending:
            _step_log("LOAD_PLAN", "ALL_DONE",
                      f"모든 쉽먼트 센터 등록 완료 ({len(already)}개): {', '.join(sorted(already))}")
            send_log("[Shipment] 모든 쉽먼트 센터가 이미 등록됨 — 처리할 작업 없음")
            send({"type": "result", "data": json.dumps({
                "success": True, "status": "all_registered",
                "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
                "alreadyCenters": sorted(already),
            }, ensure_ascii=False)})
            sys.exit(0)
        target_entry = pending[0]
        if already:
            send_log(
                f"이미 등록된 {len(already)}개 센터 제외: {', '.join(sorted(already))} "
                f"→ 남은 {len(pending)}개 중 '{target_entry['center']}' 처리"
            )

    _step_log(
        "LOAD_PLAN", "OK",
        f"{target_entry['center']} · box={target_entry['boxCount']} · sku={len(target_entry['skus'])} "
        f"(전체 쉽먼트 센터 {len(entries)}개 중)"
    )
    for s in target_entry["skus"]:
        send_log(
            f"  - po={s['po_number']} barcode={s['barcode']} "
            f"boxes={[(b['box_num'], b['qty']) for b in s['boxes']]}"
        )

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
    _step_log("CDP_CONNECT", "OK", cdp_endpoint)
    send_progress(15, "CDP 연결 성공")

    try:
        page = find_vendor_page(conn.browser) or get_existing_page(conn.browser)
        _cleanup_modals(page)
        _step_log("PAGE_ACQUIRE", "OK", page.url)

        if _config["skip_login"]:
            _step_log("LOGIN", "SKIP")
        else:
            _step_log("LOGIN", "START")
            send_progress(25, "로그인 확인 중")
            if not ensure_logged_in(page, vendor_id):
                send_error("로그인 실패")
                sys.exit(1)
            _step_log("LOGIN", "OK")
            check_session_and_log(page)

        # ── Step 1 ──
        _step_log("STEP1", "START", "리스트 → 생성 모달 → 폼 진입")
        send_progress(35, "쉽먼트 폼 진입")
        if not _step1_open_form(page, vendor_id, args.ship_from):
            _step_log("STEP1", "FAIL")
            sys.exit(1)
        _step_log("STEP1", "OK")

        # ── Step 2 ──
        _step_log("STEP2", "START", f"FC={target_entry['center']}")
        send_progress(55, "발주서 선택")
        po_numbers = sorted({s["po_number"] for s in target_entry["skus"]})
        if not _step2_select_po(page, target_entry["center"], args.date, po_numbers):
            _step_log("STEP2", "FAIL")
            sys.exit(1)
        _step_log("STEP2", "OK")

        # ── Step 3 ──
        _step_log("STEP3", "START", f"box_count={target_entry['boxCount']}")
        send_progress(75, "박스 수량 설정")
        if not _step3_set_box_count(page, target_entry["boxCount"]):
            _step_log("STEP3", "FAIL")
            sys.exit(1)
        _step_log("STEP3", "OK")

        # ── Step 4 ──
        _step_log("STEP4", "START", f"skus={len(target_entry['skus'])}")
        send_progress(90, "SKU 배정")
        filled = _step4_fill_sku_assignments(page, target_entry["skus"])
        _step_log("STEP4", "OK", f"{filled}/{len(target_entry['skus'])}")

        # ── 여기서 정지 ──
        _step_log("READY_TO_CREATE", "OK",
                  "웹 뷰에서 직접 '생성' 버튼을 누르세요 (자동 클릭 안 함)")
        send_progress(100, "쉽먼트 폼 채움 완료 — 수동 생성 대기")

        send({"type": "result", "data": json.dumps({
            "success": True, "status": "filled",
            "readyToCreate": True,
            "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
            "center": target_entry["center"],
            "boxCount": target_entry["boxCount"],
            "skuFilled": filled,
            "skuTotal": len(target_entry["skus"]),
            "finalUrl": page.url,
            "note": "생성 버튼 수동 — 웹 뷰에서 내용 확인 후 직접 클릭",
        }, ensure_ascii=False)})
        send_log(
            f"[Shipment Ready] center={target_entry['center']} "
            f"box={target_entry['boxCount']} sku={filled}/{len(target_entry['skus'])} — 수동 생성 대기"
        )
        send_log("=" * 60)

    finally:
        if conn:
            conn.close()
            send_log("CDP 연결 종료")

    sys.exit(0)


if __name__ == "__main__":
    main()
