// v3 data
const VENDORS = [
  { id: 'canon', name: '캐논',  code: 'CAN', color: 'oklch(0.55 0.14 250)', initial: 'C' },
  { id: 'epson', name: '엡손',  code: 'EPS', color: 'oklch(0.55 0.16 30)',  initial: 'E' },
  { id: 'hp',    name: 'HP',    code: 'HP',  color: 'oklch(0.55 0.14 150)', initial: 'H' },
];

// Calendar jobs — 2026-05
const CAL_JOBS = [
  // May 4 - shipped
  { id: 'j-0504-1', vendor: 'canon', date: '2026-05-04', seq: 1, state: 'shipped', label: '5/4 1차', skus: 12, qty: 380 },
  // May 5 - shipped
  { id: 'j-0505-1', vendor: 'canon', date: '2026-05-05', seq: 1, state: 'shipped', label: '5/5 1차', skus: 14, qty: 410 },
  { id: 'j-0505-2', vendor: 'canon', date: '2026-05-05', seq: 2, state: 'shipped', label: '5/5 2차', skus: 4,  qty: 96  },
  // May 6 - active (today)
  { id: 'j-0506-1', vendor: 'canon', date: '2026-05-06', seq: 1, state: 'active',  label: '5/6 1차', skus: 12, qty: 432 },
  // May 7 - draft
  { id: 'j-0507-1', vendor: 'canon', date: '2026-05-07', seq: 1, state: 'draft',   label: '5/7 1차', skus: 0,  qty: 0   },
  // Other vendors
  { id: 'j-eps-0506-1', vendor: 'epson', date: '2026-05-06', seq: 1, state: 'shipped', label: '5/6 1차', skus: 7, qty: 220 },
  { id: 'j-hp-0505-1',  vendor: 'hp',    date: '2026-05-05', seq: 1, state: 'shipped', label: '5/5 1차', skus: 9, qty: 180 },
];

// Active 차수 rows
const ACTIVE_ROWS = [
  { id: 1, po: '129868291', wh: '곤지', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 4,   confQty: 4,   method: 'ship',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 20:13', amt: 504000, reviewed: true },
  { id: 2, po: '129868269', wh: '안성4', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L', reqQty: 13,  confQty: 0,   method: null,    state: 'REJECTED',       orderTime: '2026-05-04 19:55', amt: 0, short: '협력사 재고', reviewed: true },
  { id: 3, po: '129799598', wh: '안성4', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 192, confQty: 192, method: 'milk',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 17:30', amt: 11328000, reviewed: true },
  { id: 4, po: '129799598', wh: '안성4', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA M4',   reqQty: 4,   confQty: 4,   method: 'milk',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 17:30', amt: 256532, reviewed: true },
  { id: 5, po: '129755019', wh: '인천26', sku: '4185634', barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 48,  confQty: 48,  method: 'milk',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 16:11', amt: 2832000, reviewed: true },
  { id: 6, po: '129751864', wh: '안성5', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',   reqQty: 4,   confQty: 4,   method: 'ship',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 14:22', amt: 504000, reviewed: false },
  { id: 7, po: '129751765', wh: '안성4', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 5L',  reqQty: 5,   confQty: 5,   method: null,    state: 'METHOD_NEEDED', orderTime: '2026-05-04 14:18', amt: 215000, reviewed: false },
  { id: 8, po: '129751765', wh: '안성4', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',       reqQty: 48,  confQty: 48,  method: 'milk',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 14:18', amt: 3078384, reviewed: true },
  { id: 9, po: '129722410', wh: '덕평2', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 96,  confQty: 96,  method: 'milk',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 11:02', amt: 5664000, reviewed: false },
  { id: 10, po: '129722410', wh: '덕평2', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 24,  confQty: 24,  method: 'milk',  state: 'METHOD_NEEDED', orderTime: '2026-05-04 11:02', amt: 3024000, reviewed: false },
  { id: 11, po: '129701155', wh: '화성2', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',      reqQty: 8,   confQty: 8,   method: 'ship',  state: 'METHOD_NEEDED', orderTime: '2026-05-03 22:40', amt: 513064, reviewed: true },
  { id: 12, po: '129701155', wh: '화성2', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L', reqQty: 12,  confQty: 12,  method: 'ship',  state: 'METHOD_NEEDED', orderTime: '2026-05-03 22:40', amt: 1260000, reviewed: true },
];

const SHIP_INBOX = [
  { id: 's-1', wh: '곤지',  po: '129868291', sku: '4549292221', name: '캐논 컬러 잉크',  qty: 4,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-2', wh: '안성5', po: '129751864', sku: '4549292221', name: '캐논 컬러 잉크',  qty: 4,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-3', wh: '화성2', po: '129701155', sku: '4549292068', name: '캐논 PIXMA',      qty: 8,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-4', wh: '화성2', po: '129701155', sku: '4549292255', name: '캐논 가정용 13L', qty: 12, jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 's-5', wh: '동탄1', po: '129611001', sku: '4549292221', name: '캐논 컬러 잉크',  qty: 6,  jobDate: '2026-05-05', seq: 1, age: '1일', staged: false },
];

const MILK_INBOX = [
  { id: 'm-1', wh: '안성4', po: '129799598', sku: '4549292062', name: '캐논 정품 잉크', qty: 192, jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-2', wh: '안성4', po: '129799598', sku: '4549292068', name: '캐논 PIXMA M4',  qty: 4,   jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-3', wh: '안성4', po: '129751765', sku: '4549292068', name: '캐논 PIXMA',     qty: 48,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-4', wh: '인천26', po: '129755019', sku: '4549292062', name: '캐논 정품 잉크', qty: 48,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-5', wh: '덕평2', po: '129722410', sku: '4549292062', name: '캐논 정품 잉크', qty: 96,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-6', wh: '덕평2', po: '129722410', sku: '4549292221', name: '캐논 컬러 잉크', qty: 24,  jobDate: '2026-05-06', seq: 1, age: '방금', staged: false },
  { id: 'm-7', wh: '곤지',  po: '129611055', sku: '4549292062', name: '캐논 정품 잉크', qty: 96,  jobDate: '2026-05-05', seq: 1, age: '1일', staged: true },
];

// History — current job's POs + global history
const HISTORY = [
  { id: 'h-1', when: '2026-05-06 14:39', kind: '발주확정 업로드', wh: '12 SKU / 6 센터', count: 432, lots: 0, files: ['confirmation-canon-20260506.xlsx'], jobId: 'j-0506-1', poList: ['129868291','129868269','129799598','129755019','129751864','129751765','129722410','129701155'] },
  { id: 'h-2', when: '2026-05-05 17:42', kind: '쉽먼트 업로드',  wh: '평택1',  count: 24, lots: 3, files: ['shipment-canon-20260505-pt1.xlsx','invoice-summary.csv'], jobId: 'j-0505-1', poList: ['129611001'] },
  { id: 'h-3', when: '2026-05-05 16:18', kind: '밀크런 업로드',  wh: '안성4·인천26·덕평2', count: 408, lots: 6, files: ['milkrun-canon-20260505.xlsx'], jobId: 'j-0505-1', poList: ['129611055','129611042'] },
  { id: 'h-4', when: '2026-05-05 14:02', kind: '발주확정 업로드', wh: '14 SKU / 5 센터', count: 506, lots: 0, files: ['confirmation-canon-20260505.xlsx'], jobId: 'j-0505-1', poList: ['129611001','129611055','129611042'] },
  { id: 'h-5', when: '2026-05-04 15:30', kind: '쉽먼트 업로드',  wh: '동탄1·화성2',  count: 38, lots: 4, files: ['shipment-canon-20260504.xlsx'], jobId: 'j-0504-1', poList: ['129501112'] },
];

const LOG_LINES = [
  { ts: '14:27:16', lvl: 'info', msg: '차수 윈도우 열림: canon · 2026-05-06 · 1차' },
  { ts: '14:27:18', lvl: 'info', msg: 'PO 로드: 12 rows (필터: 발주일시 ≥ 2026-05-04 09:00)' },
  { ts: '14:27:18', lvl: 'info', msg: '중복 제외: 5/5 1차에서 4건 처리 중 → 스킵' },
  { ts: '14:31:05', lvl: 'ok',   msg: '검토 완료 — 반려 1건' },
  { ts: '14:33:12', lvl: 'plugin', msg: '[tbnws] 상품-센터 그룹핑 적용 (4 그룹)' },
  { ts: '14:38:40', lvl: 'ok',   msg: '쿠팡 사이트 로그인 OK (partition: canon)' },
  { ts: '14:39:14', lvl: 'ok',   msg: '발주확정 업로드 완료, 인박스 라우팅: ship +4, milk +6' },
];

// Available plugins
const PLUGINS = [
  {
    id: 'tbnws',
    name: 'tbnws',
    version: '1.2.0',
    enabled: true,
    purchased: true,
    color: 'oklch(0.55 0.18 320)',
    initial: 'T',
    description: '검토 단계에 상품×센터 그룹핑과 부가 컬럼을 추가합니다. 어드민 동기화 단계가 새로 생깁니다.',
    hooks: ['review.columns', 'review.grouping', 'admin-sync (new step)'],
    mode: 'inline+window',  // inline for grouping, window for admin-sync
  },
  {
    id: 'invoice-printer',
    name: '송장 일괄출력',
    version: '0.4.1',
    enabled: false,
    purchased: true,
    color: 'oklch(0.55 0.16 200)',
    initial: 'I',
    description: '쉽먼트 인박스 lot 빌더에 라벨 일괄 출력 버튼을 추가합니다.',
    hooks: ['inbox.ship.toolbar'],
    mode: 'inline',
  },
  {
    id: 'pallet-optim',
    name: '팔레트 자동 최적화',
    version: '0.2.0',
    enabled: false,
    purchased: false,
    price: 240000,
    color: 'oklch(0.55 0.14 80)',
    initial: 'P',
    description: '밀크런 lot 빌더에서 무게/부피 기준으로 팔레트 적재를 자동 최적화합니다.',
    hooks: ['inbox.milk.builder'],
    mode: 'window',
  },
];

// All POs in the system — superset of all 차수, plus orphans
// jobId = which 차수 each row belongs to. null = not assigned to any 차수 yet.
const ALL_POS = [
  // ===== Currently in j-0506-1 (active 차수) =====
  { id: 'p1',  jobId: 'j-0506-1', po: '129868291', wh: '곤지',  sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 4,   orderTime: '2026-05-04 20:13' },
  { id: 'p2',  jobId: 'j-0506-1', po: '129868269', wh: '안성4', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L', reqQty: 13,  orderTime: '2026-05-04 19:55' },
  { id: 'p3',  jobId: 'j-0506-1', po: '129799598', wh: '안성4', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 192, orderTime: '2026-05-04 17:30' },
  { id: 'p4',  jobId: 'j-0506-1', po: '129799598', wh: '안성4', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA M4',   reqQty: 4,   orderTime: '2026-05-04 17:30' },
  { id: 'p5',  jobId: 'j-0506-1', po: '129755019', wh: '인천26',sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 48,  orderTime: '2026-05-04 16:11' },
  { id: 'p6',  jobId: 'j-0506-1', po: '129751864', wh: '안성5', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',   reqQty: 4,   orderTime: '2026-05-04 14:22' },
  { id: 'p7',  jobId: 'j-0506-1', po: '129751765', wh: '안성4', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 5L',  reqQty: 5,   orderTime: '2026-05-04 14:18' },
  { id: 'p8',  jobId: 'j-0506-1', po: '129751765', wh: '안성4', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',       reqQty: 48,  orderTime: '2026-05-04 14:18' },
  { id: 'p9',  jobId: 'j-0506-1', po: '129722410', wh: '덕평2', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 96,  orderTime: '2026-05-04 11:02' },
  { id: 'p10', jobId: 'j-0506-1', po: '129722410', wh: '덕평2', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 24,  orderTime: '2026-05-04 11:02' },
  { id: 'p11', jobId: 'j-0506-1', po: '129701155', wh: '화성2', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',      reqQty: 8,   orderTime: '2026-05-03 22:40' },
  { id: 'p12', jobId: 'j-0506-1', po: '129701155', wh: '화성2', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L', reqQty: 12,  orderTime: '2026-05-03 22:40' },
  // ===== Already shipped in 5/5 1차 =====
  { id: 'p20', jobId: 'j-0505-1', po: '129611001', wh: '평택1', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 24,  orderTime: '2026-05-03 18:00' },
  { id: 'p21', jobId: 'j-0505-1', po: '129611055', wh: '곤지',  sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 96,  orderTime: '2026-05-03 16:30' },
  { id: 'p22', jobId: 'j-0505-1', po: '129611042', wh: '인천26',sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',      reqQty: 32,  orderTime: '2026-05-03 14:12' },
  // ===== Orphans — 어느 차수에도 안 묶인 신규 PO =====
  { id: 'po-orphan-1', jobId: null, po: '129880011', wh: '광주2', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크',  reqQty: 12, orderTime: '2026-05-06 09:14', isNew: true },
  { id: 'po-orphan-2', jobId: null, po: '129880022', wh: '광주2', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 24, orderTime: '2026-05-06 09:18', isNew: true },
  { id: 'po-orphan-3', jobId: null, po: '129881010', wh: '대전1', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L', reqQty: 6,  orderTime: '2026-05-06 11:02', isNew: true },
  { id: 'po-orphan-4', jobId: null, po: '129881044', wh: '대전1', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA',      reqQty: 8,  orderTime: '2026-05-06 11:35', isNew: true },
  { id: 'po-orphan-5', jobId: null, po: '129883050', wh: '곤지',  sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크',   reqQty: 48, orderTime: '2026-05-06 13:48', isNew: true },
];

window.V3 = { VENDORS, CAL_JOBS, ACTIVE_ROWS, SHIP_INBOX, MILK_INBOX, HISTORY, LOG_LINES, PLUGINS, ALL_POS };
