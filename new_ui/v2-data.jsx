// v2 data — composite-key model, role-separated workflow
const VENDOR = { id: 'canon', name: '캐논', code: 'CAN', color: 'oklch(0.55 0.14 250)', initial: 'C' };

// Composite key: warehouse + po + sku
// Lifecycle: NEW → PENDING_REVIEW → REJECTED | METHOD_NEEDED → IN_INBOX (ship|milk) → STAGED → SHIPPED
const STATES = ['NEW','PENDING_REVIEW','REJECTED','METHOD_NEEDED','IN_INBOX','STAGED','SHIPPED'];

// Active 차수 (today)
const ACTIVE_JOB = { vendor: 'canon', date: '2026-05-06', sequence: 1 };

// Rows for the active 차수 (S1-S2)
const ROWS = [
  { id: 1, po: '129868291', wh: '곤지', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 4,   confQty: 4,   method: 'ship',  state: 'METHOD_NEEDED', exp: '20260506', amt: 504000 },
  { id: 2, po: '129868269', wh: '안성4', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L',  reqQty: 13,  confQty: 0,   method: null,    state: 'REJECTED',       exp: '20260506', amt: 0,       short: '협력사 재고' },
  { id: 3, po: '129799598', wh: '안성4', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 192, confQty: 192, method: 'milk',  state: 'METHOD_NEEDED', exp: '20260506', amt: 11328000 },
  { id: 4, po: '129799598', wh: '안성4', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA M4',   reqQty: 4,   confQty: 4,   method: 'milk',  state: 'METHOD_NEEDED', exp: '20260506', amt: 256532  },
  { id: 5, po: '129755019', wh: '인천26', sku: '4185634', barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 48,  confQty: 48,  method: 'milk',  state: 'METHOD_NEEDED', exp: '20260506', amt: 2832000 },
  { id: 6, po: '129751864', wh: '안성5', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',   reqQty: 4,   confQty: 4,   method: 'ship',  state: 'METHOD_NEEDED', exp: '20260506', amt: 504000  },
  { id: 7, po: '129751765', wh: '안성4', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 5L',  reqQty: 5,   confQty: 0,   method: null,    state: 'REJECTED',       exp: '20260506', amt: 0,       short: '협력사 재고' },
  { id: 8, po: '129751765', wh: '안성4', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',       reqQty: 48,  confQty: 48,  method: 'milk',  state: 'METHOD_NEEDED', exp: '20260506', amt: 3078384 },
  { id: 9, po: '129722410', wh: '덕평2', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 96,  confQty: 96,  method: 'milk',  state: 'METHOD_NEEDED', exp: '20260506', amt: 5664000 },
  { id: 10, po: '129722410', wh: '덕평2', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 24,  confQty: 24,  method: 'milk',  state: 'METHOD_NEEDED', exp: '20260506', amt: 3024000 },
  { id: 11, po: '129701155', wh: '화성2', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',      reqQty: 8,   confQty: 8,   method: 'ship',  state: 'METHOD_NEEDED', exp: '20260506', amt: 513064  },
  { id: 12, po: '129701155', wh: '화성2', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L', reqQty: 12,  confQty: 12,  method: 'ship',  state: 'METHOD_NEEDED', exp: '20260506', amt: 1260000 },
];

// Inbox items — composite keys waiting for lot building.
// Mix of current job (5/6) AND carryover from earlier jobs (5/4, 5/5).
const SHIP_INBOX = [
  // Today's job
  { id: 's-1', wh: '곤지',  po: '129868291', sku: '4549292221', name: '캐논 컬러 잉크',  qty: 4,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-2', wh: '안성5', po: '129751864', sku: '4549292221', name: '캐논 컬러 잉크',  qty: 4,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-3', wh: '화성2', po: '129701155', sku: '4549292068', name: '캐논 PIXMA',      qty: 8,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-4', wh: '화성2', po: '129701155', sku: '4549292255', name: '캐논 가정용 13L', qty: 12, jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  // Carryover (어제부터 대기)
  { id: 's-5', wh: '동탄1', po: '129611001', sku: '4549292221', name: '캐논 컬러 잉크',  qty: 6,  jobDate: '2026-05-05', seq: 1, age: '1일', staged: false },
  { id: 's-6', wh: '동탄1', po: '129611001', sku: '4549292068', name: '캐논 PIXMA',      qty: 4,  jobDate: '2026-05-05', seq: 1, age: '1일', staged: false },
];

const MILK_INBOX = [
  // Today's job
  { id: 'm-1', wh: '안성4', po: '129799598', sku: '4549292062', name: '캐논 정품 잉크', qty: 192, jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-2', wh: '안성4', po: '129799598', sku: '4549292068', name: '캐논 PIXMA M4',  qty: 4,   jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-3', wh: '안성4', po: '129751765', sku: '4549292068', name: '캐논 PIXMA',     qty: 48,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-4', wh: '인천26', po: '129755019', sku: '4549292062', name: '캐논 정품 잉크', qty: 48,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-5', wh: '덕평2', po: '129722410', sku: '4549292062', name: '캐논 정품 잉크', qty: 96,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-6', wh: '덕평2', po: '129722410', sku: '4549292221', name: '캐논 컬러 잉크', qty: 24,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  // Carryover
  { id: 'm-7', wh: '곤지',  po: '129611055', sku: '4549292062', name: '캐논 정품 잉크', qty: 96,  jobDate: '2026-05-05', seq: 1, age: '1일', staged: true },
  { id: 'm-8', wh: '곤지',  po: '129611055', sku: '4549292068', name: '캐논 PIXMA',     qty: 12,  jobDate: '2026-05-05', seq: 1, age: '1일', staged: true },
];

// History (S6) — completed/uploaded shipments
const HISTORY = [
  { id: 'h-1', when: '2026-05-05 17:42', kind: '쉽먼트 업로드', wh: '평택1', count: 24, lots: 3, files: ['shipment-canon-20260505-pt1.xlsx','invoice-summary.csv'] },
  { id: 'h-2', when: '2026-05-05 16:18', kind: '밀크런 업로드', wh: '안성4·인천26·덕평2', count: 408, lots: 6, files: ['milkrun-canon-20260505.xlsx'] },
  { id: 'h-3', when: '2026-05-05 14:02', kind: '발주확정 업로드', wh: '12 SKU / 6 센터', count: 432, lots: 0, files: ['confirmation-canon-20260505-01.xlsx'] },
  { id: 'h-4', when: '2026-05-04 15:30', kind: '쉽먼트 업로드', wh: '동탄1·화성2', count: 38, lots: 4, files: ['shipment-canon-20260504.xlsx'] },
  { id: 'h-5', when: '2026-05-04 13:11', kind: '밀크런 업로드', wh: '안성4·덕평2', count: 264, lots: 4, files: ['milkrun-canon-20260504.xlsx'] },
];

// Job sequence list for sidebar
const JOBS = [
  { date: '2026-05-06', seq: 1, label: '오늘 1차', state: 'active' },
  { date: '2026-05-05', seq: 1, label: '5월 5일 1차', state: 'shipped' },
  { date: '2026-05-04', seq: 1, label: '5월 4일 1차', state: 'shipped' },
];

// Log lines
const LOG_LINES = [
  { ts: '14:27:16', lvl: 'info', msg: '차수 초기화: canon · 2026-05-06 · 1차' },
  { ts: '14:27:18', lvl: 'info', msg: 'PO 로드: 12 rows' },
  { ts: '14:27:21', lvl: 'info', msg: '투비 재고조정 매핑 OK' },
  { ts: '14:31:05', lvl: 'ok',   msg: '경영지원 검토 완료 — 반려 2건' },
  { ts: '14:33:12', lvl: 'info', msg: '운송방법 자동 추천 적용 (8 milk, 4 ship)' },
  { ts: '14:38:40', lvl: 'ok',   msg: '쿠팡 사이트 로그인 OK (partition: canon)' },
  { ts: '14:38:55', lvl: 'info', msg: 'Playwright: /po/confirm 진입' },
  { ts: '14:39:10', lvl: 'info', msg: 'POST /api/po/confirm — 200 OK (10 rows)' },
  { ts: '14:39:14', lvl: 'ok',   msg: '발주확정 업로드 완료' },
  { ts: '14:39:14', lvl: 'info', msg: '인박스 라우팅: ship +4, milk +6' },
];

window.V2 = {
  VENDOR, ACTIVE_JOB, ROWS, SHIP_INBOX, MILK_INBOX, HISTORY, JOBS, LOG_LINES, STATES,
};
