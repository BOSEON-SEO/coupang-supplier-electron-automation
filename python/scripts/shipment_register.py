"""
shipment_register.py — 쿠팡 쉽먼트(택배) 폼 채움 (생성 버튼 클릭 직전 정지)

transport.json 의 `transportType === '쉽먼트'` assignment 중 하나를 골라,
쉽먼트 생성 4단계를 진행한다. **최종 #btn-create / '생성' 버튼은 절대 클릭하지 않음**
— 운영자가 웹 뷰에서 직접 검토 후 수동 클릭.

흐름 (reference 기준):
    1. /ibs/asn/active?type=parcel 진입 → '쉽먼트 생성' 버튼 → 출고지 모달
       → shipFromSeq 선택 → '다음' 클릭 → /ibs/shipment/parcel/form 도착
    2. FC select (센터명 매칭) + 입고예정일 → 검색 → 발주서 체크 → '발주서 선택 완료'
    3. #parcelCount 에 박스 수량 입력 → 다음
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
        raw_inv = a.get("boxInvoices") or []
        box_invoices = [str(x or "").strip() for x in raw_inv][:9]
        entries.append({
            "center": center,
            "boxCount": box_count,
            "skus": skus,
            "boxInvoices": box_invoices,
        })
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
    #
    # 주의: 쿠팡 사이트가 체크박스의 DOM state(.checked) 가 아니라 click 핸들러에서
    # 별도 JS 객체에 선택 PO 를 누적한다. 즉 `cb.checked = true` + dispatch('change')
    # 로는 사이트 내부 state 에 반영 안 됨 → '발주서 선택 완료' 후 버튼 클릭 시
    # "하나 이상의 발주서를 선택해주세요" alert 발생.
    # 해결: cb.click() 으로 네이티브 click 이벤트를 발사해 사이트 리스너가
    #       정상 호출되게 한다. 이미 checked 면 스킵(click 은 토글).
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
                            if (!cb.checked) cb.click();
                            n += 1;
                            break;
                        }
                    }
                });
                return n;
            }""",
            po_numbers,
        )
        send_log(f"발주서 체크: {checked}건 (요청 {len(po_numbers)}건, 네이티브 click)")
    else:
        # 전체 선택도 네이티브 click 으로 통일 — Playwright .check() 가
        # 내부적으로 click 을 호출하긴 하지만 일부 케이스에서 이벤트 전파가
        # 누락되는 사례가 있어 명시적으로 JS click.
        try:
            ok = page.evaluate(
                """() => {
                    const el = document.querySelector('#check-all');
                    if (!el) return false;
                    if (!el.checked) el.click();
                    return true;
                }"""
            )
            if not ok:
                send_error("#check-all 요소 없음")
                return False
            send_log("발주서 전체 선택 (네이티브 click)")
        except Exception as exc:
            send_error(f"전체 선택 실패: {exc}")
            return False

    # ── 체크 상태가 사이트 핸들러에 반영될 때까지 대기 ──
    # JS dispatchEvent + change 리스너가 비동기로 돌아서 sleep 만으론 부족한 경우가 있음.
    # 실제 DOM 에서 checked 개수가 1개 이상이 될 때까지 polling (최대 5초).
    checked_count = 0
    for attempt in range(25):  # 25 × 0.2 = 5초
        try:
            checked_count = page.evaluate(
                """() => document
                    .querySelectorAll('input[name="poSelected"]:checked')
                    .length"""
            )
        except Exception:
            checked_count = 0
        if checked_count > 0:
            break
        time.sleep(0.2)

    if checked_count == 0:
        send_error("발주서 체크 반영 실패 — 5초 대기 후에도 checked=0")
        return False
    send_log(f"발주서 체크 반영 확인: {checked_count}건 (대기 {attempt * 0.2 + 0.2:.1f}초)")

    # 반영 후 한 번 더 짧게 대기 — 사이트 내부 state 업데이트 여유
    time.sleep(0.8)

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
    # 주의: 쉽먼트 박스 수는 `#parcelCount` 이다. `#splitCount` 는 다른
    # 화면(밀크런 분할 등) 에서 쓰이는 입력이라 여기서는 hidden 상태로 34개
    # 가까이 매칭돼 visible 대기가 실패한다.
    try:
        inp = page.locator("#parcelCount")
        inp.wait_for(state="visible", timeout=BUTTON_TIMEOUT_MS)
        inp.fill(str(box_count), timeout=5_000)
    except Exception as exc:
        send_error(f"#parcelCount 입력 실패: {exc}")
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
    """filled SKU count 반환.

    사이트 동작:
        - 각 SKU 행에는 기본 1개 행만 존재. select[name="parcel"] + input[name="shippingQty"].
        - addParcel 버튼(`+`) 을 누르면 `#parcelAppendModal` 모달이 뜨며,
          `#splitCount` 에 N 을 입력하고 `#split` (분할하기) 를 누르면
          해당 SKU 가 N 개 행으로 분할된다.
        - 즉 박스마다 + 버튼을 누르는 게 아니라, "총 몇 개로 분할할지" 를
          한 번에 입력해서 전부 생성한 뒤 각 행을 채운다.
    """
    filled = 0
    for sku in skus:
        order = sku["po_number"]
        barcode = sku["barcode"]
        boxes = sku["boxes"]
        if not boxes:
            continue
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

            boxes_count = len(boxes)
            row = page.locator("table tbody tr").nth(row_idx)

            # ── 분할이 필요하면 + 버튼 → 모달 → splitCount → 분할하기 ──
            if boxes_count > 1:
                try:
                    add_btn = row.locator('button[name="addParcel"]').first
                    add_btn.click(timeout=5_000)
                except Exception:
                    # fallback: 첫번째 .btn-sm
                    row.locator("button.primary2-button, button.btn-sm").first.click(timeout=5_000)

                # 모달 대기
                modal = page.locator("#parcelAppendModal")
                try:
                    modal.wait_for(state="visible", timeout=5_000)
                except Exception as exc:
                    send_log(f"분할 모달이 뜨지 않음 po={order} barcode={barcode}: {exc}")
                    continue
                time.sleep(0.3)

                # splitCount — 모달 내부 스코프로 한정해 다른 화면의 #splitCount 와 충돌 회피
                try:
                    modal.locator("#splitCount").fill(str(boxes_count), timeout=5_000)
                except Exception as exc:
                    send_log(f"#splitCount 입력 실패 po={order}: {exc}")
                    continue
                time.sleep(0.3)

                # '분할하기' — id=split 또는 모달 내부 primary-button
                clicked_split = False
                for sel in ("#split", "#parcelAppendModal button.primary-button"):
                    try:
                        page.locator(sel).first.click(timeout=3_000)
                        clicked_split = True
                        break
                    except Exception:
                        continue
                if not clicked_split:
                    send_log(f"'분할하기' 클릭 실패 po={order}")
                    continue

                # 모달 닫힘 대기 + backdrop 정리
                try:
                    modal.wait_for(state="hidden", timeout=5_000)
                except Exception:
                    pass
                time.sleep(0.8)
                _cleanup_modals(page)

            # ── 각 박스 슬롯에 select + qty 입력 ──
            # 사이트 구조: 분할 후 **같은 <tr> 내부에 N 개의 select + input 이 세로로 누적**된다.
            # 즉 tr 는 여전히 1개, 그 안에 select[name="parcel"] 이 N 개.
            # nth(i) 로 해당 슬롯을 골라 각각 채운다.
            assigned = 0
            selects = row.locator('select[name="parcel"]')
            inputs = row.locator('input[name="shippingQty"]')
            # 개수 검증 — 분할이 제대로 반영됐는지
            try:
                slot_count = selects.count()
            except Exception:
                slot_count = 0
            if slot_count < boxes_count:
                send_log(
                    f"[WARN] po={order} barcode={barcode}: "
                    f"분할 슬롯 부족 ({slot_count}/{boxes_count}) — "
                    f"그래도 채울 수 있는 만큼 진행"
                )
            for i, box in enumerate(boxes):
                if i >= slot_count:
                    send_log(
                        f"박스 슬롯 없음 po={order} barcode={barcode} "
                        f"box={box['box_num']} (slot {i})"
                    )
                    continue
                try:
                    # value 우선 시도, 실패 시 label 폴백
                    try:
                        selects.nth(i).select_option(
                            value=f"박스 {box['box_num']}", timeout=3_000,
                        )
                    except Exception:
                        selects.nth(i).select_option(
                            label=f"박스 {box['box_num']}", timeout=3_000,
                        )
                    inputs.nth(i).fill(str(box["qty"]), timeout=5_000)
                    assigned += 1
                except Exception as exc:
                    send_log(
                        f"박스 슬롯 배정 실패 po={order} barcode={barcode} "
                        f"box={box['box_num']} (slot {i}): {exc}"
                    )

            if assigned == boxes_count:
                filled += 1
                send_log(
                    f"SKU 배정 완료: po={order} barcode={barcode} "
                    f"({assigned}/{boxes_count}박스)"
                )
            else:
                send_log(
                    f"SKU 배정 부분 성공: po={order} barcode={barcode} "
                    f"({assigned}/{boxes_count}박스)"
                )
        except Exception as exc:
            send_log(f"SKU 채움 실패 po={order} barcode={barcode}: {exc}")
    return filled


# ─── Step 4b: 'SKU 선택 완료' 클릭 ─────────────────────────────────

def _step4_confirm_sku_selection(page) -> bool:
    """배정 완료 후 'SKU 선택 완료' 버튼 클릭.

    사이트 HTML:
        <button type="button" class="btn primary-button float-r"
                name="confirmed" data-step="2">
            <span class="glyphicon glyphicon-check"></span>
            SKU 선택 완료
        </button>

    주의: `button[name="confirmed"]` 는 STEP2(발주서 선택 완료) 에서도 쓰여
    여러 개 존재할 수 있으므로, 텍스트 + name 조합으로 필터링.
    """
    selectors = [
        # 텍스트 기반 (가장 명확)
        'button[name="confirmed"]:has-text("SKU 선택 완료")',
        # role 기반 폴백
        # (아래는 Playwright locator chain 이 아니므로 별도 분기 처리)
    ]
    for sel in selectors:
        try:
            btn = page.locator(sel).first
            btn.wait_for(state="visible", timeout=3_000)
            btn.click(timeout=5_000)
            send_log("'SKU 선택 완료' 클릭")
            time.sleep(1.5)
            _cleanup_modals(page)
            return True
        except Exception:
            continue

    # 폴백 1: get_by_role + name
    try:
        page.get_by_role("button", name="SKU 선택 완료").click(timeout=5_000)
        send_log("'SKU 선택 완료' 클릭 (role 폴백)")
        time.sleep(1.5)
        _cleanup_modals(page)
        return True
    except Exception as exc:
        send_log(f"'SKU 선택 완료' role 폴백 실패: {exc}")

    # 폴백 2: JS 로 직접 — 텍스트 포함 confirmed 버튼 찾아 click
    try:
        ok = page.evaluate(
            """() => {
                const btns = Array.from(document.querySelectorAll('button[name="confirmed"]'));
                for (const b of btns) {
                    if (b.offsetParent === null) continue;
                    if ((b.innerText || '').includes('SKU 선택 완료')) {
                        b.click();
                        return true;
                    }
                }
                return false;
            }"""
        )
        if ok:
            send_log("'SKU 선택 완료' 클릭 (JS 폴백)")
            time.sleep(1.5)
            _cleanup_modals(page)
            return True
    except Exception as exc:
        send_error(f"'SKU 선택 완료' JS 폴백 실패: {exc}")
        return False
    send_error("'SKU 선택 완료' 버튼을 찾지 못했습니다")
    return False


# ─── Step 5: 택배사·발송일시·가송장번호 자동 입력 ───────────────────

def _parse_invoices(raw: str) -> list[str]:
    """개행/쉼표 혼용 파싱 → 최대 9개 trim."""
    if not raw:
        return []
    parts = []
    for chunk in raw.replace("\r", "\n").split("\n"):
        for item in chunk.split(","):
            item = item.strip()
            if item:
                parts.append(item)
            if len(parts) >= 9:
                break
        if len(parts) >= 9:
            break
    return parts[:9]


def _step5_fill_delivery(
    page,
    *,
    delivery_company: str,
    send_date: str,
    send_time: str,
    invoices: list[str],
) -> dict:
    """택배사 select / 발송일 / 발송시각 / 송장번호 N개 입력.

    각 항목은 값이 있을 때만 채움. 최종 '택배 쉽먼트 완료' 버튼은 누르지 않음.
    return: { 'company': bool, 'date': bool, 'time': bool, 'invoices': int, 'errors': [...] }
    """
    result = {"company": False, "date": False, "time": False, "invoices": 0, "errors": []}

    # ── 1) 택배사 ──
    if delivery_company:
        try:
            page.locator("#deliveryCompany").select_option(value=delivery_company, timeout=5_000)
            result["company"] = True
            send_log(f"택배사 선택: {delivery_company}")
        except Exception as exc:
            # chosen-select 로 display:none 인 경우 JS 폴백 (value 할당 + change 디스패치)
            try:
                page.evaluate(
                    """(v) => {
                        const el = document.querySelector('#deliveryCompany');
                        if (!el) return false;
                        el.value = v;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        // chosen.js refresh
                        if (window.jQuery && window.jQuery.fn && window.jQuery.fn.trigger) {
                            window.jQuery(el).trigger('chosen:updated');
                        }
                        return true;
                    }""",
                    delivery_company,
                )
                result["company"] = True
                send_log(f"택배사 선택 (JS 폴백): {delivery_company}")
            except Exception as exc2:
                result["errors"].append(f"택배사 선택 실패: {exc} / JS 폴백: {exc2}")
                send_log(f"택배사 선택 실패: {exc}")

    # ── 2) 발송일 ──
    # 날짜 input 이 bootstrap-datepicker 인 경우 fill 후 change 필요.
    if send_date:
        for sel in ("#shipDate", 'input[name="shipDate"]'):
            try:
                inp = page.locator(sel).first
                if inp.count() == 0:
                    continue
                inp.fill(send_date, timeout=5_000)
                page.evaluate(
                    """(s) => {
                        const el = document.querySelector(s);
                        if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
                    }""",
                    sel,
                )
                result["date"] = True
                send_log(f"발송일 입력: {send_date}")
                break
            except Exception as exc:
                result["errors"].append(f"발송일 실패 ({sel}): {exc}")
        if not result["date"]:
            send_log("발송일 input 을 찾지 못함")

    # ── 3) 발송 시각 ──
    if send_time:
        try:
            page.locator("#shipTime").fill(send_time, timeout=5_000)
            page.evaluate(
                """() => {
                    const el = document.querySelector('#shipTime');
                    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            result["time"] = True
            send_log(f"발송 시각 입력: {send_time}")
        except Exception as exc:
            result["errors"].append(f"발송 시각 실패: {exc}")
            send_log(f"발송 시각 실패: {exc}")

    # ── 4) 가송장번호 (박스별) ──
    if invoices:
        try:
            inputs = page.locator('input[name="invoice"]')
            slot_count = inputs.count()
            for i, inv in enumerate(invoices):
                if i >= slot_count:
                    send_log(f"송장 슬롯 부족 — {i+1}번째부터 입력 생략 (총 {slot_count}개 슬롯)")
                    break
                try:
                    inputs.nth(i).fill(inv, timeout=3_000)
                    result["invoices"] += 1
                except Exception as exc:
                    result["errors"].append(f"송장[{i}] 실패: {exc}")
            send_log(f"가송장번호 입력: {result['invoices']}개")
        except Exception as exc:
            result["errors"].append(f"송장 전체 실패: {exc}")
            send_log(f"송장 입력 실패: {exc}")

    return result


# ─── 메인 ────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="쉽먼트 폼 채움 (생성 직전 정지)")
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--sequence", type=int, required=True)
    parser.add_argument("--center", default=None, help="처리할 센터명 (생략 시 쉽먼트 첫 번째)")
    parser.add_argument("--ship-from", default=DEFAULT_SHIP_FROM_SEQ)
    parser.add_argument("--skip-login", action="store_true")
    # ── STEP5: 택배 송장 번호 자동 입력 ──
    parser.add_argument("--delivery-company", default="", help="#deliveryCompany option value (예: D000006)")
    parser.add_argument("--send-date",        default="", help="발송일 YYYY-MM-DD")
    parser.add_argument("--send-time",        default="", help="발송 시각 HH:MM")
    parser.add_argument("--invoices",         default="", help="가송장번호 목록 (개행 또는 쉼표 구분, 최대 9개)")
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
        send_progress(88, "SKU 배정")
        filled = _step4_fill_sku_assignments(page, target_entry["skus"])
        _step_log("STEP4", "OK", f"{filled}/{len(target_entry['skus'])}")

        # ── Step 4b: 'SKU 선택 완료' 클릭 ──
        _step_log("STEP4B", "START", "SKU 선택 완료")
        send_progress(92, "SKU 선택 완료")
        if not _step4_confirm_sku_selection(page):
            _step_log("STEP4B", "FAIL")
            # 실패해도 사용자에게 수동 클릭 기회는 줌 — 종료하지 않고 진행
        else:
            _step_log("STEP4B", "OK")

        # ── Step 5: 택배사·발송일시·가송장번호 ──
        # 센터별 boxInvoices 가 있으면 그걸 우선 사용 (빈 슬롯은 전역 --invoices 의 같은 index 로 fallback).
        global_invoices = _parse_invoices(args.invoices)
        center_invoices = target_entry.get("boxInvoices") or []
        if center_invoices:
            merged = []
            for i in range(target_entry["boxCount"]):
                v = center_invoices[i].strip() if i < len(center_invoices) else ""
                if not v and i < len(global_invoices):
                    v = global_invoices[i]
                if v:
                    merged.append(v)
            invoices = merged
        else:
            invoices = global_invoices
        has_step5_input = bool(
            args.delivery_company or args.send_date or args.send_time or invoices
        )
        step5_result = {}
        if has_step5_input:
            _step_log("STEP5", "START",
                      f"company={args.delivery_company!r} date={args.send_date!r} "
                      f"time={args.send_time!r} invoices={len(invoices)}")
            send_progress(96, "택배 송장 정보 입력")
            # STEP4B 후 화면 전환 여유
            time.sleep(1.0)
            step5_result = _step5_fill_delivery(
                page,
                delivery_company=args.delivery_company,
                send_date=args.send_date,
                send_time=args.send_time,
                invoices=invoices,
            )
            _step_log(
                "STEP5", "OK",
                f"company={step5_result.get('company')} date={step5_result.get('date')} "
                f"time={step5_result.get('time')} invoices={step5_result.get('invoices')}"
            )
        else:
            _step_log("STEP5", "SKIP", "설정값 없음")

        # ── 여기서 정지 ──
        _step_log("READY_TO_CREATE", "OK",
                  "웹 뷰에서 직접 '택배 쉽먼트 완료' 버튼을 누르세요 (자동 클릭 안 함)")
        send_progress(100, "쉽먼트 폼 채움 완료 — 수동 생성 대기")

        send({"type": "result", "data": json.dumps({
            "success": True, "status": "filled",
            "readyToCreate": True,
            "vendor": vendor_id, "date": args.date, "sequence": args.sequence,
            "center": target_entry["center"],
            "boxCount": target_entry["boxCount"],
            "skuFilled": filled,
            "skuTotal": len(target_entry["skus"]),
            "deliveryFilled": step5_result,
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
