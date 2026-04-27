/**
 * TBNWS 플러그인 — 투비네트웍스 전용 커스터마이즈.
 *
 * 계획된 기능:
 *   1. ✅ po.postprocess: coupangCheckForm 응답으로 17컬럼 확장 파일 생성
 *   2. 재고조정 자동 채움 (stock-adjust.autofill)
 *   3. 제품 그룹핑 (product.group-key)
 *   4. 재고 반영 phase (registerPhase)
 *   5. job.completed 라이프사이클 (커스텀 파일 생성)
 *
 * 백엔드 HTTP 는 main-half(main.js) 에서 처리. renderer 는 ctx.ipcInvoke 로 호출.
 */

import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { KNOWN_SCOPES, KNOWN_HOOKS, KNOWN_VIEW_ROLES } from '../../core/plugin-api';
import { applyPoStyle } from '../../core/poStyler';
import TbnwsStockAdjustView from './StockAdjustView';
import EflexOutboundModal from './EflexOutboundModal';
import RelocationModal from './RelocationModal';
import ExportScheduleModal from './ExportScheduleModal';
import TbnwsCoupangExportModal from './TbnwsCoupangExportModal';
import { CoupangWarehousesManageButton } from './CoupangWarehousesModal';
import { COUPANG_WAREHOUSES_SEED } from './coupangWarehousesSeed';

// ═══════════════════════════════════════════════════════════════════
// 17컬럼 정의 — 어드민 프론트의 CoupangCheckModal 과 동일 순서·라벨
// ═══════════════════════════════════════════════════════════════════

/**
 * 백엔드 export_yn → 표시용 '가능' / '불가능'.
 * ERPService 의 UNORDERABLE_STATUSES = {N, 불가, 불가능} 과 동일 판정.
 */
function renderExportStatus(exportYn) {
  const v = String(exportYn ?? '').trim();
  if (!v) return '';
  return (v === 'N' || v === '불가' || v === '불가능') ? '불가능' : '가능';
}

/**
 * @param {object} r  CoupangOrderFormCheck 한 행 (백엔드 enrichStep2Defaults 적용 후)
 * @returns {[string, any][]}
 */
function toExtendedRow(r) {
  const orderQty = Number(r.order_quantity) || 0;
  const requestedQty = Number(r.requested_qty) || 0;
  const fulfillExportQty = Number(r.fulfillment_export_qty) || 0;
  const purchasePrice = Number(r.purchase_price) || 0;
  const deliveryPrice = Number(r.rtn_sku_delivery_price) || 0;
  const tobe = Number(r.rtn_tobe_stock) || 0;
  const fulfill = Number(r.rtn_fulfillment_stock) || 0;

  const totalPurchase = orderQty * purchasePrice;
  const diff = purchasePrice - deliveryPrice;

  return [
    ['발주번호',       r.coupang_order_seq ?? ''],
    ['상품코드',       r.tobe_product_code ?? ''],
    ['SKU ID',         r.sku_id ?? ''],
    ['SKU 이름',       r.sku_name ?? ''],
    ['SKU 바코드',     r.sku_barcode ?? ''],
    ['발주수량',       orderQty],
    ['확정수량',       requestedQty],
    ['반출수량',       fulfillExportQty],  // 풀필에서 반출해야 할 수량 (백엔드 fulfillment_export_qty)
    ['물류센터',       r.departure_warehouse ?? ''],
    ['매입가',         purchasePrice],
    ['총매입금',       totalPurchase],
    ['SKU 납품가',     deliveryPrice],
    ['매입-납품 차액', diff],
    ['투비재고',       tobe],
    ['풀필재고',       fulfill],
    ['투비바코드',     r.rtn_tobe_barcode ?? ''],
    ['바코드일치',     r.rtn_barcode_matched ?? ''],
    ['출고여부',       renderExportStatus(r.export_yn)],
    ['비고',           r.stock_remarks ?? ''],
  ];
}

/**
 * workDetail 응답의 skuList 원소를 startWork 응답 (CoupangOrderFormCheck) 과
 * 동일한 형태로 정규화.
 *
 * 주의:
 *   - DB 컬럼명 (`order_no`, `product_code`, `ordered_qty`, `logistics_center`,
 *     `delivery_price`, `stock_tobe`, `stock_fulfillment`, `tobe_barcode`) 과
 *     startWork 계산 컬럼명 (`rtn_*`) 모두 수용.
 *   - "확정수량"·"반출수량"은 **물류 단위**(logisticsList) 에 저장되므로
 *     (product_code, logistics_center) 기준으로 병합. sku level 은 보통 null.
 *   - `rtn_barcode_matched` 는 startWork 에서 enrich 되는 계산 필드이므로 로컬 계산.
 *
 * @param {object} r         skuList 원소
 * @param {Map<string, object>} [logiMap] key='product_code|logistics_center' 인덱스
 */
function normalizeSkuRow(r, logiMap) {
  const productCode = r.tobe_product_code ?? r.product_code ?? '';
  const center = r.departure_warehouse ?? r.logistics_center ?? '';
  const orderSeq = String(r.coupang_order_seq ?? r.order_no ?? '').trim();

  // 매칭 우선순위:
  //   ① precise (productCode + center + orderSeq) — logi 가 발주별로 분리된 경우
  //   ② loose 후보 1개만 — 같은 (pc, lc) 의 발주가 1개뿐이면 그대로 사용
  //   ③ loose 후보 여러 개 — null 처리 후 distributeLooseLogi 에서 비례 분배
  let logi = null;
  let matchedPrecise = false;
  if (logiMap?.precise && orderSeq) {
    const exact = logiMap.precise.get(`${productCode}|${center}|${orderSeq}`);
    if (exact) { logi = exact; matchedPrecise = true; }
  }
  if (!logi && logiMap?.loose) {
    const candidates = logiMap.loose.get(`${productCode}|${center}`) || [];
    if (candidates.length === 1) logi = candidates[0]; // 단일 후보만 안전
  }

  // 바코드 일치 로컬 계산 (startWork 의 enrichStep2Defaults 와 동일 규칙).
  const skuBarcode = String(r.sku_barcode ?? '').trim();
  const tobeBarcode = String(r.rtn_tobe_barcode ?? r.tobe_barcode ?? '').trim();
  const barcodeMatched = tobeBarcode
    ? (skuBarcode === tobeBarcode ? 'Y' : 'N')
    : '';

  return {
    coupang_order_seq:       r.coupang_order_seq ?? r.order_no ?? '',
    tobe_product_code:       productCode,
    sku_id:                  r.sku_id ?? '',
    sku_name:                r.sku_name ?? '',
    sku_barcode:             r.sku_barcode ?? '',
    order_quantity:          r.order_quantity ?? r.ordered_qty ?? 0,
    requested_qty:           logi?.confirmed_qty ?? logi?.requested_qty
                              ?? r.requested_qty ?? r.confirmed_qty ?? 0,
    fulfillment_export_qty:  logi?.fulfillment_export_qty ?? r.fulfillment_export_qty ?? 0,
    departure_warehouse:     center,
    purchase_price:          r.purchase_price ?? 0,
    rtn_sku_delivery_price:  r.rtn_sku_delivery_price ?? r.sku_delivery_price
                              ?? r.delivery_price ?? 0,
    rtn_tobe_stock:          r.rtn_tobe_stock ?? r.stock_tobe ?? 0,
    rtn_fulfillment_stock:   r.rtn_fulfillment_stock ?? r.stock_fulfillment ?? 0,
    rtn_tobe_barcode:        tobeBarcode,
    rtn_barcode_matched:     r.rtn_barcode_matched ?? r.barcode_matched ?? barcodeMatched,
    export_yn:               r.export_yn ?? '',
    stock_remarks:           r.stock_remarks ?? logi?.logistics_remarks ?? '',
    // 비례 분배 후처리용 임시 필드
    _logiKey:                `${productCode}|${center}`,
    _matchedPrecise:         matchedPrecise,
  };
}

/**
 * logisticsList 를 두 가지 키로 인덱싱.
 *
 *   precise: (productCode, center, orderSeq) — logi 가 발주별로 분리된 경우
 *   loose:   (productCode, center) → [logi 후보들] — 합산본/단일 케이스
 *
 * 백엔드가 logi 를 발주별로 주는지 합산본으로 주는지에 무관하게 동작.
 */
function buildLogisticsMap(logisticsList) {
  const precise = new Map();
  const loose = new Map();
  if (!Array.isArray(logisticsList)) return { precise, loose };
  for (const l of logisticsList) {
    const pc = l?.product_code ?? '';
    const lc = l?.logistics_center ?? '';
    if (!pc || !lc) continue;
    const ord = String(l?.coupang_order_seq ?? l?.order_no ?? '').trim();
    if (ord) precise.set(`${pc}|${lc}|${ord}`, l);
    const lk = `${pc}|${lc}`;
    if (!loose.has(lk)) loose.set(lk, []);
    loose.get(lk).push(l);
  }
  return { precise, loose };
}

/**
 * normalizeSkuRow 후처리 — precise 매칭 안 된 행들에 대해 발주별 비례 분배.
 *
 * 백엔드의 logisticsList 가 (productCode, center) 단위 합산본일 때:
 *   같은 (pc, lc) 그룹 안의 여러 발주 행이 normalizeSkuRow 단독으론 모두 같은
 *   합산값을 받아 합계가 부풀려짐. 이 함수가 order_quantity 비례로 재분배.
 *
 * precise 매칭으로 이미 정확한 logi 를 받은 행은 건드리지 않음.
 */
function distributeLooseLogi(normalized, logiMap) {
  if (!logiMap?.loose || !normalized?.length) {
    if (normalized) for (const r of normalized) { delete r._logiKey; delete r._matchedPrecise; }
    return;
  }
  // precise 매칭 안 된 행만 (pc, lc) 그룹핑
  const groups = new Map();
  for (const r of normalized) {
    if (r._matchedPrecise) continue;
    const k = r._logiKey;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, rows] of groups) {
    if (rows.length <= 1) continue; // 단일이면 normalizeSkuRow 의 loose 매칭이 이미 정확
    const candidates = logiMap.loose.get(k) || [];
    if (candidates.length === 0) continue;
    // 같은 (pc, lc) 의 모든 logi 후보를 합쳐서 총량 계산 (대부분 합산본 1개임)
    const totalConfirmed = candidates.reduce(
      (s, l) => s + Number(l.confirmed_qty ?? l.requested_qty ?? 0), 0,
    );
    const totalExport = candidates.reduce(
      (s, l) => s + Number(l.fulfillment_export_qty ?? 0), 0,
    );
    const sumOrders = rows.reduce((s, r) => s + Number(r.order_quantity || 0), 0);
    if (sumOrders <= 0) continue;

    let allocC = 0; let allocE = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const ratio = Number(r.order_quantity || 0) / sumOrders;
      const isLast = i === rows.length - 1;
      const conf = isLast ? (totalConfirmed - allocC) : Math.floor(totalConfirmed * ratio);
      const exp = isLast ? (totalExport - allocE) : Math.floor(totalExport * ratio);
      r.requested_qty = conf;
      r.fulfillment_export_qty = exp;
      allocC += conf;
      allocE += exp;
    }
  }
  // 임시 필드 정리
  for (const r of normalized) {
    delete r._logiKey;
    delete r._matchedPrecise;
  }
}

/** 응답 배열 → AOA (header + rows) */
function buildAoa(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return [[
      '발주번호','상품코드','SKU ID','SKU 이름','SKU 바코드','발주수량','확정수량','반출수량','물류센터',
      '매입가','총매입금','SKU 납품가','매입-납품 차액','투비재고','풀필재고',
      '투비바코드','바코드일치','출고여부','비고',
    ]];
  }
  const first = toExtendedRow(data[0]);
  const header = first.map(([label]) => label);
  const rows = data.map((r) => toExtendedRow(r).map(([, v]) => v));
  return [header, ...rows];
}

/** AOA → xlsx ArrayBuffer */
function buildWorkbookBuffer(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 컬럼 폭 (19컬럼)
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 32 }, { wch: 16 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 28 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TBNWS 확장');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// ═══════════════════════════════════════════════════════════════════
// NewJobModal 옵션 view — '풀필 재고 동기화' 체크박스
// ═══════════════════════════════════════════════════════════════════

const OPT_KEY_REFETCH = 'tbnws.refetchFulfillment';

function TbnwsNewJobOptions({ options, onChange, disabled }) {
  const checked = !!(options && options[OPT_KEY_REFETCH]);
  return (
    <div className="newjob-plugin-option">
      <label className="newjob-plugin-option__row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(OPT_KEY_REFETCH, e.target.checked)}
          disabled={disabled}
        />
        <div>
          <div className="newjob-plugin-option__label">
            풀필먼트 재고 동기화 진행
          </div>
          <div className="newjob-plugin-option__hint">
            체크 시, PO 다운 전에 내부 DB 의 풀필 재고를 최신화하여 발주서 검증에 정확한 반출 가능 수량이 반영됩니다.
          </div>
        </div>
      </label>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 원격 work 레코드 → 로컬 manifest 모양 skeleton
// ═══════════════════════════════════════════════════════════════════

// 앱 내부 vendor id 검증 패턴 — ipc-handlers 와 동일 (소문자+숫자+언더스코어, 2~20자).
const VENDOR_RE = /^[a-z0-9_]{2,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DB `category` (예: 'BASIC', 'CANON') → 앱 vendor id (소문자).
 * 단순 toLowerCase 로 충분하지 않은 특수 매핑이 생기면 여기에 테이블 추가.
 */
function toVendorId(category) {
  return String(category || '').trim().toLowerCase();
}

/**
 * 백엔드 work 레코드(coupang_inbound_work row) 를 로컬 manifest 와
 * 같은 모양의 객체로 변환. `remote: true` 플래그로 구분.
 *
 * 유효성 실패 (vendor regex 미통과, date 포맷 이상) 시 null 반환 —
 * 호출자가 스킵하도록 함.
 *
 * status → phase 매핑은 대략:
 *   DRAFT            → 'po_downloaded'
 *   LOGISTICS_LOCKED → 'assigned'
 *   CONFIRMED        → 'confirmed'
 *   COMPLETED        → 'uploaded'
 */
function toRemoteJobSkeleton(work) {
  const vendor = toVendorId(work.category);
  const date = String(work.inbound_date || '').slice(0, 10);
  if (!VENDOR_RE.test(vendor)) return null;
  if (!DATE_RE.test(date)) return null;

  const status = String(work.status || '').toUpperCase();
  const PHASE_MAP = {
    DRAFT: 'po_downloaded',
    LOGISTICS_LOCKED: 'assigned',
    CONFIRMED: 'confirmed',
    COMPLETED: 'uploaded',
  };
  return {
    schemaVersion: 1,
    vendor,
    date,
    sequence: Number(work.round) || 1,
    phase: PHASE_MAP[status] || 'po_downloaded',
    completed: status === 'COMPLETED',
    plugin: 'tbnws',
    remote: true,
    createdAt: work.created_at || null,
    updatedAt: work.updated_at || null,
    stats: {},
    pluginData: { tbnws: toTbnwsMeta(work) },
  };
}

function toTbnwsMeta(work) {
  return {
    workSeq: work.seq,
    status: String(work.status || '').toUpperCase(),
    stepCompleted: Number(work.step_completed) || 0,
    eflexRequested: String(work.eflex_requested || 'N').toUpperCase() === 'Y',
    exportScheduleSeq: work.export_schedule_seq ?? null,
    relocationSeq: work.relocation_seq ?? null,
    milkrunReflectedAt: work.milkrun_reflected_at ?? null,
  };
}

// 간단한 월 캐시 — calendar.list-day 가 같은 달에서 반복 호출될 때 재사용.
// 달/벤더 바뀌면 무효. 수 분 이상 안정적으로 쓰진 않음 (세션 내 캐시 용도만).
let monthCache = { key: null, works: [], ts: 0 };
const MONTH_CACHE_TTL_MS = 30 * 1000;

// ═══════════════════════════════════════════════════════════════════
// 전역 오버레이 호스트 — window event 로 모달 on/off
// ═══════════════════════════════════════════════════════════════════

const EFLEX_OPEN_EVENT = 'tbnws:open-eflex-modal';
const RELOCATION_OPEN_EVENT = 'tbnws:open-relocation-modal';
const EXPORT_SCHEDULE_OPEN_EVENT = 'tbnws:open-export-schedule-modal';
const COUPANG_EXPORT_OPEN_EVENT = 'tbnws:open-coupang-export-modal';

function TbnwsOverlayHost() {
  const [eflexJob, setEflexJob] = useState(null);
  const [relocationJob, setRelocationJob] = useState(null);
  const [exportJob, setExportJob] = useState(null);
  const [coupangExportJob, setCoupangExportJob] = useState(null);

  useEffect(() => {
    const openEflex = (e) => setEflexJob(e?.detail?.job || null);
    const openReloc = (e) => setRelocationJob(e?.detail?.job || null);
    const openExp   = (e) => setExportJob(e?.detail?.job || null);
    const openCpx   = (e) => setCoupangExportJob(e?.detail?.job || null);
    window.addEventListener(EFLEX_OPEN_EVENT, openEflex);
    window.addEventListener(RELOCATION_OPEN_EVENT, openReloc);
    window.addEventListener(EXPORT_SCHEDULE_OPEN_EVENT, openExp);
    window.addEventListener(COUPANG_EXPORT_OPEN_EVENT, openCpx);
    return () => {
      window.removeEventListener(EFLEX_OPEN_EVENT, openEflex);
      window.removeEventListener(RELOCATION_OPEN_EVENT, openReloc);
      window.removeEventListener(EXPORT_SCHEDULE_OPEN_EVENT, openExp);
      window.removeEventListener(COUPANG_EXPORT_OPEN_EVENT, openCpx);
    };
  }, []);
  if (eflexJob) {
    return <EflexOutboundModal job={eflexJob} onClose={() => setEflexJob(null)} />;
  }
  if (relocationJob) {
    return <RelocationModal job={relocationJob} onClose={() => setRelocationJob(null)} />;
  }
  if (exportJob) {
    return <ExportScheduleModal job={exportJob} onClose={() => setExportJob(null)} />;
  }
  if (coupangExportJob) {
    return <TbnwsCoupangExportModal job={coupangExportJob} onClose={() => setCoupangExportJob(null)} />;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// 플러그인 manifest
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'tbnws',
  name: 'TBNWS',
  version: '0.1.0',
  description: '투비네트웍스 전용 커스터마이즈. 작업 생성 시 풀필먼트 재고 동기화, PO → 자사 확장 파일(po-tbnws.xlsx) 생성, tobe_product_code 기준 재고조정 그룹 뷰, 확정수량 cross-sync 등을 제공. API Base URL 과 Bearer 토큰을 설정해야 동작합니다.',
  entitlement: 'tbnws.plugin',

  settingsSchema: [
    {
      key: 'apiBaseUrl',
      label: 'API Base URL',
      type: 'url',
      placeholder: 'https://api.tbnws.co.kr',
      description: 'TBNWS 사내 관리 백엔드 주소. 뒤의 /api 는 포함해도 생략해도 OK (자동 정규화). 예: https://api.tbnws.co.kr 또는 http://localhost:8080',
    },
    {
      key: 'apiToken',
      label: 'API 인증 토큰',
      type: 'password',
      description: 'Bearer 토큰 또는 세션 쿠키 값. 백엔드 관리자에게 문의.',
    },
    // 회사 정식 명칭 — 파렛트 적재리스트 등 산출물의 '업체명' 칸에 자동 채워짐.
    {
      key: 'companyFullName',
      label: '회사 정식 명칭',
      type: 'text',
      default: '주식회사 투비네트웍스글로벌',
      description: '파렛트 적재리스트 등 산출물의 "업체명" 칸에 자동 삽입되는 정식 명칭.',
    },
    // 이플렉스 반출 수령 정보 (admin 프론트와 동일 default)
    { key: 'eflexReceiverName', label: '이플렉스 반출 수령자명', type: 'text', default: '투비네트웍스글로벌' },
    { key: 'eflexPhone',        label: '이플렉스 반출 연락처',   type: 'text', default: '010-5011-1337' },
    { key: 'eflexZipCode',      label: '이플렉스 반출 우편번호', type: 'text', default: '17040' },
    { key: 'eflexAddress',      label: '이플렉스 반출 주소',     type: 'text', default: '경기 용인시 처인구 포곡읍 성산로 434' },
    { key: 'eflexRemark',       label: '이플렉스 반출 비고',     type: 'text', default: '쿠팡 입고 반출' },
    {
      key: 'eflexTestMode',
      label: '이플렉스 출고 테스트 모드',
      type: 'boolean',
      default: true,
      description: '체크 시 실제 백엔드로 전송하지 않고 요청 body 만 로그. 검증 후 체크 해제하여 실요청으로 전환하세요.',
    },
    // 출고예정 (applyStep4Schedule) 수취인 기본값 — exportProducts 각 item 공통 적용.
    // 어드민 프론트는 주문 row 에서 파생하지만 Electron 은 주문 정보가 없어 고정값 사용.
    { key: 'exportReceiverName',  label: '출고예정 수취인명',   type: 'text', default: '투비네트웍스글로벌' },
    { key: 'exportReceiverPhone', label: '출고예정 수취인 연락처', type: 'text', default: '010-5011-1337' },
    { key: 'exportReceiverContact', label: '출고예정 수취인 이메일', type: 'text', default: '' },
    { key: 'exportReceiverAddress', label: '출고예정 수취인 주소', type: 'text', default: '경기 용인시 처인구 포곡읍 성산로 434' },
    { key: 'exportReceiverMemo',  label: '출고예정 배송 메모',  type: 'text', default: '' },
    {
      key: 'exportPartnerName',
      label: '출고예정 파트너명',
      type: 'text',
      default: '쿠팡로켓',
      description: '백엔드 erp_partner.partner_name 과 정확히 일치해야 partner_code 매칭이 됨. 오타·띄어쓰기 금지.',
    },
    {
      key: 'exportCategoryCode',
      label: '출고예정 카테고리 코드',
      type: 'text',
      default: 'G',
      description: '상품코드 접두어와 동일 (G, F 등). 쿠팡 출고예정은 보통 G.',
    },
    {
      key: 'coupangWarehouses',
      label: '쿠팡 창고 관리',
      type: 'custom',
      description: '출고예정 모달에서 엑셀 "물류센터" 값 → 연락처/주소 자동 매칭에 사용. 최초 실행 시 seed 가 주입되며, 이후 언제든 추가·수정·삭제 가능.',
      render: ({ value, onChange }) => (
        React.createElement(CoupangWarehousesManageButton, { value, onChange })
      ),
    },
    {
      key: 'exportScheduleTestMode',
      label: '출고예정 테스트 모드',
      type: 'boolean',
      default: true,
      description: '체크 시 실제 ERP 로 전송하지 않고 요청 body 만 콘솔에 로그. 검증 후 체크 해제하여 실요청으로 전환하세요.',
    },
    // 재고이동 기본 창고 태그 — 모달에서 덮어쓸 수 있음
    { key: 'relocationFromTagDefault', label: '재고이동 기본 From 창고 태그', type: 'text', default: 'GJ' },
    { key: 'relocationToTagDefault',   label: '재고이동 기본 To 창고 태그',   type: 'text', default: 'GT' },
    {
      key: 'relocationTestMode',
      label: '재고이동 테스트 모드',
      type: 'boolean',
      default: true,
      description: '체크 시 실제 WMS 로 전송하지 않고 요청 body 만 콘솔에 로그. 검증 후 체크 해제하여 실요청으로 전환하세요.',
    },
  ],

  activate(ctx) {
    const disposables = [];

    // 쿠팡 창고 seed 주입 — 설정에 coupangWarehouses 가 비어있으면 1회 seed 로 채움.
    (async () => {
      try {
        const api = window.electronAPI;
        if (!api) return;
        const cur = await api.loadSettings();
        const curSettings = cur?.settings || {};
        const curPlugins = curSettings.plugins || {};
        const mine = curPlugins.tbnws || {};
        if (Array.isArray(mine.coupangWarehouses) && mine.coupangWarehouses.length > 0) return;
        await api.saveSettings({
          schemaVersion: cur?.schemaVersion || 1,
          settings: {
            ...curSettings,
            plugins: {
              ...curPlugins,
              tbnws: { ...mine, coupangWarehouses: COUPANG_WAREHOUSES_SEED },
            },
          },
        });
        window.dispatchEvent(new Event('settings-changed'));
        // eslint-disable-next-line no-console
        console.info(`[tbnws] coupangWarehouses seed 주입 (${COUPANG_WAREHOUSES_SEED.length}건)`);
      } catch (err) {
        console.warn('[tbnws] coupangWarehouses seed 주입 실패', err);
      }
    })();

    // NewJobModal 에 풀필 재고 동기화 체크박스 기여.
    disposables.push(
      ctx.registerView(KNOWN_VIEW_ROLES.NEWJOB_OPTIONS, {
        component: TbnwsNewJobOptions,
        priority: 10,
      }),
    );

    // 재고조정 모달 — variant='tbnws' 로 열린 경우에만 admin 스타일 그룹 뷰로 치환.
    // PO 원본 탭에서 여는 기본 variant 는 코어 StockAdjustView 유지.
    disposables.push(
      ctx.registerView(KNOWN_VIEW_ROLES.STOCK_ADJUST_MAIN, {
        component: TbnwsStockAdjustView,
        priority: 10,
        when: (whenCtx) => whenCtx.variant === 'tbnws',
      }),
    );

    // 전역 오버레이 호스트 — 이플렉스 출고 모달 등 tbnws 관련 전역 모달을 이 안에서 렌더.
    disposables.push(
      ctx.registerView(KNOWN_VIEW_ROLES.APP_OVERLAY, {
        component: TbnwsOverlayHost,
        priority: 10,
      }),
    );

    // 이플렉스 출고 버튼 — 투비 재고조정 탭에서만 노출 (scope 가 tabVariant 기반).
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.eflex.outbound',
        title: '이플렉스 출고',
        icon: '🚚',
        variant: 'success',
        scope: 'work.tab.tbnws.actions',
        order: 50,
        when: (whenCtx) => whenCtx?.job?.pluginData?.tbnws?.workSeq != null,
        handler: (args) => {
          const job = args?.job;
          if (!job) { alert('활성 작업이 없습니다.'); return; }
          if (job?.pluginData?.tbnws?.eflexRequested) {
            const ok = window.confirm(
              '이 작업은 이미 이플렉스 출고가 요청된 상태입니다.\n'
              + '정말 다시 요청하시겠습니까? (중복 전송 될 수 있음)',
            );
            if (!ok) return;
          }
          window.dispatchEvent(new CustomEvent(EFLEX_OPEN_EVENT, {
            detail: { job },
          }));
        },
      }),
    );

    // 재고이동 등록 버튼 — 투비 재고조정 탭.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.relocation.create',
        title: '재고이동 등록',
        icon: '📦',
        variant: 'info',
        scope: 'work.tab.tbnws.actions',
        order: 60,
        when: (whenCtx) => whenCtx?.job?.pluginData?.tbnws?.workSeq != null,
        handler: (args) => {
          const job = args?.job;
          if (!job) { alert('활성 작업이 없습니다.'); return; }
          window.dispatchEvent(new CustomEvent(RELOCATION_OPEN_EVENT, {
            detail: { job },
          }));
        },
      }),
    );

    // 출고예정 등록 버튼 — 투비 재고조정 탭.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.exportSchedule.create',
        title: '출고예정 등록',
        icon: '📅',
        variant: 'warning',
        scope: 'work.tab.tbnws.actions',
        order: 70,
        when: (whenCtx) => whenCtx?.job?.pluginData?.tbnws?.workSeq != null,
        handler: (args) => {
          const job = args?.job;
          if (!job) { alert('활성 작업이 없습니다.'); return; }
          window.dispatchEvent(new CustomEvent(EXPORT_SCHEDULE_OPEN_EVENT, {
            detail: { job },
          }));
        },
      }),
    );

    // 투비 쿠팡반출 — 발주확정서 탭의 '운송분배' 오른쪽.
    // 전용 양식을 엑셀로 주고받는 외부 물류팀 협업용 기능.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.coupangExport',
        title: '투비 쿠팡반출',
        icon: '📑',
        variant: 'phase-coupang-export',
        scope: KNOWN_SCOPES.WORK_TAB_CONFIRMATION_ACTIONS,
        order: 55,
        handler: (args) => {
          const job = args?.job;
          if (!job) { alert('활성 작업이 없습니다.'); return; }
          window.dispatchEvent(new CustomEvent(COUPANG_EXPORT_OPEN_EVENT, {
            detail: { job },
          }));
        },
      }),
    );

    // "startWork 재시도" 커맨드는 제거됨.
    // 백엔드 startWork 는 기존 workSeq 반환하지만 SKU 를 재초기화하는 파괴적 동작이라
    // 어드민이 이미 Step4/5 진행했으면 오히려 작업을 망가뜨림.
    // 원격 import 시점에 workDetail 로 po-tbnws.xlsx 를 이미 재구성하므로 수동 재시도 불필요.

    // job.pre-create 훅 — options.tbnws.refetchFulfillment 가 true 면
    // 풀필 재고 동기화 API 를 호출하고 완료 대기.
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.JOB_PRE_CREATE, async (payload, hookCtx, next) => {
        const refetch = payload?.options && payload.options[OPT_KEY_REFETCH];
        if (!refetch) return next();
        console.info('[tbnws] 풀필 재고 동기화 요청 시작');
        const res = await ctx.ipcInvoke('fulfillment.refetch');
        if (!res?.success) {
          // 실패를 throw 하면 CalendarView 가 alert 로 표시.
          throw new Error(`풀필 재고 동기화 실패: ${res?.error || 'unknown'}`);
        }
        console.info('[tbnws] 풀필 재고 동기화 완료');
        return next();
      }),
    );

    // WorkView 에 "검증·확정" 탭 기여 (PO ↔ 확정서 사이).
    //
    // scope=work.tab.extra 의 command 규약:
    //   - fileName: 탭이 로드할 파일 (po-tbnws.xlsx)
    //   - after: 'po' → PO 탭 뒤에 배치
    //   - onSave: 사용자가 확정수량 편집 후 저장 누를 때 호출.
    //             편집된 buffer 에서 확정수량 추출 → confirmation.xlsx 에 patch.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.poExtended',
        title: '투비 재고조정',
        icon: '🏢',
        scope: KNOWN_SCOPES.WORK_TAB_EXTRA,
        order: 50,
        fileName: 'po-tbnws.xlsx',
        after: 'po',
        readOnly: false,
        hasPoActions: true,
        tabVariant: 'tbnws',
        handler: () => {},
        onSave: async (buffer, { job, electronAPI }) => {
          // 1) 편집된 po-tbnws.xlsx 저장 전에 applyPoStyle 로 스타일 재적용.
          //    FortuneSheet ↔ xlsx 왕복 시 스타일 정보가 유실되는 것을 방어.
          let styledBuffer = buffer;
          try {
            const ab = buffer instanceof ArrayBuffer
              ? buffer
              : (buffer?.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer);
            styledBuffer = await applyPoStyle(ab);
          } catch (err) {
            console.warn('[tbnws] applyPoStyle 실패 — 원본 buffer 로 저장', err);
          }
          const tbnwsResolved = await electronAPI.resolveJobPath(
            job.date, job.vendor, job.sequence, 'po-tbnws.xlsx',
          );
          if (tbnwsResolved?.success) {
            await electronAPI.writeFile(tbnwsResolved.path, styledBuffer);
          }

          // 2) 편집된 buffer 에서 patches 추출
          const wb = XLSX.read(buffer, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) throw new Error('시트를 찾을 수 없습니다.');
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (aoa.length < 2) throw new Error('데이터 행이 없습니다.');
          const header = aoa[0].map((h) => String(h).trim());
          const col = (name) => header.indexOf(name);
          const iOrder = col('발주번호');
          const iWh = col('물류센터');
          const iBarcode = col('SKU 바코드');
          const iOrderQty = col('발주수량');
          const iConfirmedQty = col('확정수량');
          if (iOrder < 0 || iWh < 0 || iBarcode < 0 || iConfirmedQty < 0) {
            throw new Error('필수 컬럼을 찾을 수 없습니다.');
          }

          const [vRes, sRes] = await Promise.all([
            electronAPI.loadVendors(),
            electronAPI.loadSettings(),
          ]);
          const defaults = sRes?.settings || {};
          const vendorMeta = vRes?.vendors?.find?.((v) => v.id === job.vendor) || {};
          const override = vendorMeta.settings || {};
          const pick = (k) =>
            (override[k] !== undefined && override[k] !== '') ? override[k] : (defaults[k] ?? '');
          const defaultReason = pick('defaultShortageReason')
            || '협력사 재고부족 - 수입상품 입고지연 (선적/통관지연)';

          const patches = [];
          for (let i = 1; i < aoa.length; i += 1) {
            const row = aoa[i];
            const orderSeq = String(row[iOrder] ?? '').trim();
            const warehouse = String(row[iWh] ?? '').trim();
            const barcode = String(row[iBarcode] ?? '').trim();
            if (!orderSeq || !barcode) continue;
            const confirmedQty = String(row[iConfirmedQty] ?? 0);
            const confirmedNum = Number(confirmedQty) || 0;
            const orderNum = Number(row[iOrderQty] ?? 0) || 0;
            patches.push({
              key: `${orderSeq}|${warehouse}|${barcode}`,
              confirmedQty,
              shortageReason: confirmedNum < orderNum ? defaultReason : '',
            });
          }

          // 3) 세 파일 동시 sync. 단 po-tbnws.xlsx 는 방금 우리가 직접 썼으므로 제외
          //    (이중 write 로 인한 스타일 손실/구조 손상 방지).
          const res = await electronAPI.confirmedQty.sync(
            job.date, job.vendor, job.sequence, patches,
            { excludeFiles: ['po-tbnws.xlsx'] },
          );
          if (!res?.success) {
            throw new Error(res?.error || '확정수량 sync 실패');
          }
          const r = res.results || {};
          const parts = Object.entries(r)
            .filter(([, v]) => v?.success && !v.skipped && (v.patched || 0) > 0)
            .map(([f, v]) => `${f} ${v.patched}건`);
          if (parts.length === 0) {
            alert('반영된 파일이 없습니다. 복합키 매칭을 확인하세요.');
          } else {
            alert(`확정수량 반영 완료: ${parts.join(' · ')}`);
          }
        },
      }),
    );

    /**
     * 달력 원격 병합 — GET work.listByMonth 로 DB 의 coupang_inbound_work 를 가져와
     * 로컬 manifest 목록과 자연키 (date, vendor, round) 기준으로 merge.
     *
     * 원칙:
     *   - 로컬은 항상 source of truth. workSeq 는 기존 값 우선 (원격이 덮지 않음).
     *   - 원격에만 있는 작업은 `remote: true` 플래그로 달력에 표시. 클릭 시 로컬 skeleton 생성.
     *   - 네트워크·인증 실패는 로컬 표시를 망치면 안 되므로 try/catch 로 로컬 그대로 반환.
     */
    const fetchRemoteWorks = async (year, month, vendor) => {
      const key = `${year}-${month}-${vendor || ''}`;
      const now = Date.now();
      if (monthCache.key === key && (now - monthCache.ts) < MONTH_CACHE_TTL_MS) {
        return monthCache.works;
      }
      const res = await ctx.ipcInvoke('work.listByMonth', {
        year, month, vendor: vendor || null,
      });
      if (!res?.success || !Array.isArray(res.works)) {
        if (res && !res.success) {
          console.info('[tbnws] 원격 달력 조회 실패 — 로컬만 표시:', res.error);
        }
        monthCache = { key, works: [], ts: now };
        return [];
      }
      monthCache = { key, works: res.works, ts: now };
      return res.works;
    };

    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.CALENDAR_LIST_MONTH, async (payload) => {
        const { year, month, vendor, byDate } = payload || {};
        const merged = { ...(byDate || {}) };
        try {
          const works = await fetchRemoteWorks(year, month, vendor);
          if (works.length === 0) return merged;

          // 자연키 기반 group — 같은 (date, vendor, round) 은 1건으로 계수.
          // vendor 는 소문자 정규화 + regex 검증 통과한 것만 (invalid 는 skip).
          // 백엔드 필터를 신뢰하지 않고 클라이언트에서 한 번 더 vendor 필터 (방어적).
          const vendorFilter = vendor ? toVendorId(vendor) : null;
          const keysByDate = new Map();
          for (const w of works) {
            const date = String(w.inbound_date || '').slice(0, 10);
            const v = toVendorId(w.category);
            const round = Number(w.round) || 1;
            if (!DATE_RE.test(date) || !VENDOR_RE.test(v)) continue;
            if (vendorFilter && v !== vendorFilter) continue;
            if (!keysByDate.has(date)) keysByDate.set(date, new Set());
            keysByDate.get(date).add(`${v}|${round}`);
          }
          for (const [date, set] of keysByDate) {
            if (!merged[date]) {
              // 원격 전용 — 점 표시만, 미완료 가정
              merged[date] = { count: set.size, hasIncomplete: true, remoteOnly: true };
            }
            // 로컬 있는 날짜는 카운트 합산 대신 그대로 유지 (정확 카운트는 day panel 에서 처리)
          }
        } catch (err) {
          console.warn('[tbnws] calendar.list-month 병합 실패', err);
        }
        return merged;
      }),
    );

    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.CALENDAR_LIST_DAY, async (payload) => {
        const { date, vendor, jobs } = payload || {};
        const localJobs = Array.isArray(jobs) ? jobs.slice() : [];
        try {
          const y = Number(String(date || '').slice(0, 4));
          const m = Number(String(date || '').slice(5, 7));
          if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return localJobs;

          const works = await fetchRemoteWorks(y, m, vendor);
          const todaysWorks = works.filter(
            (w) => String(w.inbound_date || '').slice(0, 10) === date,
          );
          if (todaysWorks.length === 0) return localJobs;

          // 로컬 자연키 인덱스
          const byKey = new Map();
          for (const j of localJobs) byKey.set(`${j.vendor}|${j.sequence}`, j);

          // 방어적 vendor 필터 (백엔드 미필터 대응).
          const vendorFilter = vendor ? toVendorId(vendor) : null;
          for (const w of todaysWorks) {
            const v = toVendorId(w.category);
            const round = Number(w.round) || 1;
            if (!VENDOR_RE.test(v)) continue;
            if (vendorFilter && v !== vendorFilter) continue;
            const k = `${v}|${round}`;
            const existing = byKey.get(k);
            const tbnwsMeta = toTbnwsMeta(w);
            if (existing) {
              // 로컬 있음 — tbnws 메타만 주입. 기존 값 (특히 workSeq) 이 우선.
              const prev = (existing.pluginData && existing.pluginData.tbnws) || {};
              existing.pluginData = {
                ...(existing.pluginData || {}),
                tbnws: { ...tbnwsMeta, ...prev },
              };
            } else {
              const skeleton = toRemoteJobSkeleton(w);
              if (skeleton) byKey.set(k, skeleton);
            }
          }

          return Array.from(byKey.values()).sort((a, b) => {
            const v = (a.vendor || '').localeCompare(b.vendor || '');
            return v !== 0 ? v : (a.sequence - b.sequence);
          });
        } catch (err) {
          console.warn('[tbnws] calendar.list-day 병합 실패', err);
          return localJobs;
        }
      }),
    );

    /**
     * job.remote-import 훅 — 달력의 원격(☁) 카드 클릭 시 CalendarView 가 호출.
     *
     * 플로우:
     *   1) jobs.create 로 로컬 skeleton 생성 (plugin='tbnws', sequence 명시)
     *   2) workSeq 있으면:
     *      a) GET /…/{workSeq}/poFile      → po.xlsx 저장
     *      b) GET /…/workDetail?work_seq=X → skuList 로 po-tbnws.xlsx 재구성
     *   3) manifest 에 pluginData 주입 + source 기록
     *
     * workDetail 은 읽기 전용 — 어드민에서 수정한 값 그대로 보존됨.
     * (startWork 재호출은 파괴적 재초기화라 피함).
     */
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.REMOTE_JOB_IMPORT, async (payload) => {
        const remoteJob = payload?.job;
        if (!remoteJob?.date || !remoteJob?.vendor || remoteJob.sequence == null) {
          throw new Error('원격 job 정보 부족 (date/vendor/sequence 필요)');
        }
        const api = ctx.electronAPI;
        const workSeq = remoteJob?.pluginData?.tbnws?.workSeq;

        // 1) 로컬 skeleton
        const created = await api.jobs.create(remoteJob.date, remoteJob.vendor, {
          plugin: 'tbnws',
          sequence: remoteJob.sequence,
        });
        if (!created?.success) {
          throw new Error(created?.error || 'jobs.create 실패');
        }

        let poSaved = false;
        let tbnwsSaved = false;
        let dlFileName = null;

        if (workSeq != null) {
          // 2a) PO 파일 다운로드 → po.xlsx
          const dl = await ctx.ipcInvoke('work.downloadPoFile', { workSeq });
          if (dl?.success && dl.data) {
            const resolved = await api.resolveJobPath(
              remoteJob.date, remoteJob.vendor, remoteJob.sequence, 'po.xlsx',
            );
            if (resolved?.success) {
              const w = await api.writeFile(resolved.path, dl.data);
              if (w?.success) {
                poSaved = true;
                dlFileName = dl.fileName || null;
                const bytes = dl.data.byteLength ?? dl.data.length;
                const suffix = dl.converted ? ' (CSV→XLSX 변환)' : '';
                console.info(`[tbnws] 원격 PO 다운로드 완료${suffix} (${bytes} bytes, ${dl.fileName})`);
              } else {
                console.warn('[tbnws] po.xlsx 저장 실패:', w?.error);
              }
            }
          } else {
            console.warn('[tbnws] PO 파일 다운로드 실패:', dl?.error);
          }

          // 2b) workDetail 조회 → skuList 로 po-tbnws.xlsx 재구성
          const detail = await ctx.ipcInvoke('work.fetchDetail', { workSeq });
          // DEBUG: 응답 키 구조 덤프 (필드 매핑 조정용). 안정화 후 제거.
          if (detail?.success) {
            console.info('[tbnws] workDetail 응답 구조:', {
              workKeys: detail.work ? Object.keys(detail.work).sort() : null,
              skuListLen: detail.skuList?.length,
              skuSample: detail.skuList?.[0],
              logisticsListLen: detail.logisticsList?.length,
              logisticsSample: detail.logisticsList?.[0],
              logisticsCenterSample: detail.logisticsCenterList?.[0],
              logisticsPackageSample: detail.logisticsPackageList?.[0],
            });
          }
          if (detail?.success && Array.isArray(detail.skuList) && detail.skuList.length > 0) {
            try {
              const logiMap = buildLogisticsMap(detail.logisticsList);
              const normalized = detail.skuList.map((row) => normalizeSkuRow(row, logiMap));
              // 같은 (상품코드, 센터) 그룹의 발주들이 logi 합산값으로 부풀려지는 문제 보정 —
              // order_quantity 비례로 confirmed/export 재분배 (precise 매칭은 그대로 유지).
              distributeLooseLogi(normalized, logiMap);
              const aoa = buildAoa(normalized);
              const raw = buildWorkbookBuffer(aoa);
              const ab = raw.buffer
                ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
                : raw;
              const outBuffer = await applyPoStyle(ab);
              const resolved = await api.resolveJobPath(
                remoteJob.date, remoteJob.vendor, remoteJob.sequence, 'po-tbnws.xlsx',
              );
              if (resolved?.success) {
                const w = await api.writeFile(resolved.path, outBuffer);
                if (w?.success) {
                  tbnwsSaved = true;
                  console.info(`[tbnws] po-tbnws.xlsx 재구성 완료 (${normalized.length}행)`);
                } else {
                  console.warn('[tbnws] po-tbnws.xlsx 저장 실패:', w?.error);
                }
              }
            } catch (err) {
              console.warn('[tbnws] po-tbnws 재구성 실패', err);
            }
          } else if (detail && !detail.success) {
            console.warn('[tbnws] workDetail 조회 실패:', detail.error);
          }
        }

        // 3) manifest 업데이트 — pluginData + source
        const sourceFlag = poSaved && tbnwsSaved ? 'remote'
                        : poSaved                ? 'remote-partial'
                        :                          'remote-no-file';
        const patch = {
          pluginData: remoteJob.pluginData || {},
          source: sourceFlag,
        };
        if (dlFileName) patch.sourceFileName = dlFileName;
        const upd = await api.jobs.updateManifest(
          remoteJob.date, remoteJob.vendor, remoteJob.sequence, patch,
        );
        return upd?.manifest || created.manifest;
      }),
    );

    /**
     * po.postprocess 훅 — 원본 PO 를 startWork 로 전송해 작업 생성 + 검증.
     * 결과를 17컬럼 xlsx (어드민 프론트 CoupangCheckModal 와 동일 구조) 로 저장하고,
     * 백엔드의 work_seq 를 manifest.pluginData.tbnws.workSeq 에 영속화.
     *
     * 저장 위치: {job-folder}/po-tbnws.xlsx  (원본 po.xlsx 는 보존)
     * work_seq 는 이후 saveStep1/2/3·eFlexs 반출 등 후속 API 에서 사용됨.
     */
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.PO_POSTPROCESS, async (payload, hookCtx, next) => {
        try {
          const job = payload?.job;
          if (!job) {
            console.warn('[tbnws] payload.job 없어서 startWork 스킵');
            return next();
          }
          const res = await ctx.ipcInvoke('po.startWork', {
            fileName: payload?.fileName,
            fileBuffer: payload?.buffer,
            inboundDate: job.date,
            category: job.vendor || '',
            round: job.sequence,
          });
          if (!res?.success) {
            console.warn('[tbnws] startWork 실패:', res?.error);
            return next();
          }
          const data = Array.isArray(res.data) ? res.data : [];
          console.info('[tbnws] startWork 응답 수신:', {
            workSeq: res.workSeq,
            rowCount: data.length,
            sample: data[0],
          });

          // work_seq 를 manifest 에 영속화 (후속 API 호출에 사용)
          if (res.workSeq != null) {
            try {
              const existing = (job.pluginData && job.pluginData.tbnws) || {};
              await ctx.electronAPI.jobs.updateManifest(job.date, job.vendor, job.sequence, {
                pluginData: {
                  ...(job.pluginData || {}),
                  tbnws: { ...existing, workSeq: res.workSeq },
                },
              });
            } catch (err) {
              console.warn('[tbnws] manifest workSeq 저장 실패', err);
            }
          }

          // 응답 → 18컬럼 엑셀 빌드 → PO 원본과 동일 스타일 적용
          const aoa = buildAoa(data);
          const raw = buildWorkbookBuffer(aoa);
          // XLSX.write('array') → Uint8Array | ArrayBuffer. applyPoStyle 은 ArrayBuffer 전제.
          const ab = raw.buffer
            ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
            : raw;
          const outBuffer = await applyPoStyle(ab);
          const resolved = await ctx.electronAPI.resolveJobPath(
            job.date, job.vendor, job.sequence, 'po-tbnws.xlsx',
          );
          if (!resolved?.success) {
            console.warn('[tbnws] po-tbnws.xlsx 경로 해석 실패:', resolved?.error);
            return next();
          }
          const w = await ctx.electronAPI.writeFile(resolved.path, outBuffer);
          if (!w?.success) {
            console.warn('[tbnws] po-tbnws.xlsx 저장 실패:', w?.error);
            return next();
          }
          console.info(`[tbnws] po-tbnws.xlsx 저장됨 (${data.length}행): ${resolved.path}`);
          return next();
        } catch (err) {
          console.error('[tbnws] po.postprocess 실패', err);
          return next();
        }
      }),
    );

    // TODO: stock-adjust.autofill 훅 등록
    // TODO: product.group-key 훅 등록
    // TODO: registerPhase 로 '재고 반영' 단계 삽입
    // TODO: job.completed 라이프사이클 핸들러

    return () => { disposables.forEach((d) => d()); };
  },
};

export default manifest;
