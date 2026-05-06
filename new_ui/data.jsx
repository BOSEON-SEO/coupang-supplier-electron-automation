// Mock data for the prototype.
const VENDORS = [
  { id: 'canon',    name: '캐논',     code: 'CAN', color: 'oklch(0.55 0.14 250)', initial: 'C' },
  { id: 'keychron', name: '키크론',   code: 'KCH', color: 'oklch(0.58 0.16 25)',  initial: 'K' },
  { id: 'sodastream', name: '소다스트림', code: 'SDS', color: 'oklch(0.62 0.14 155)', initial: 'S' },
  { id: 'philips', name: '필립스',   code: 'PHI', color: 'oklch(0.60 0.14 80)',  initial: 'P' },
];

const PHASES = [
  { key: 'po',    label: 'PO 다운' },
  { key: 'conf',  label: '발주 확정' },
  { key: 'tr',    label: '물류 처리' },
  { key: 'done',  label: '완료' },
];

// Calendar mock — month of April 2026
const MONTH = { y: 2026, m: 3 }; // 0-indexed (April)
const TODAY = 30;

function makeJobs() {
  // returns { 'YYYY-MM-DD': [job] }
  const j = {};
  const add = (day, vendor, seq, phase) => {
    const k = `2026-04-${String(day).padStart(2,'0')}`;
    if (!j[k]) j[k] = [];
    j[k].push({ vendor, seq, phase });
  };
  add(2, 'canon', 1, 4); add(2, 'philips', 1, 4);
  add(3, 'keychron', 1, 4);
  add(6, 'canon', 1, 4); add(6, 'sodastream', 1, 4); add(6, 'philips', 1, 4);
  add(7, 'canon', 1, 4); add(7, 'keychron', 1, 4);
  add(8, 'canon', 1, 4);
  add(9, 'philips', 1, 4); add(9, 'keychron', 1, 4); add(9, 'sodastream', 1, 4);
  add(13, 'canon', 1, 4); add(13, 'canon', 2, 4); add(13, 'philips', 1, 4);
  add(14, 'keychron', 1, 4); add(14, 'sodastream', 1, 4);
  add(15, 'canon', 1, 4); add(15, 'philips', 1, 4);
  add(16, 'philips', 1, 4); add(16, 'keychron', 1, 4); add(16, 'canon', 1, 4);
  add(20, 'canon', 1, 4); add(20, 'sodastream', 1, 4);
  add(21, 'philips', 1, 4); add(21, 'keychron', 1, 4);
  add(22, 'canon', 1, 4); add(22, 'canon', 2, 4); add(22, 'sodastream', 1, 4);
  add(23, 'philips', 1, 4);
  add(27, 'canon', 1, 4); add(27, 'keychron', 1, 4);
  add(28, 'canon', 1, 4); add(28, 'philips', 1, 4); add(28, 'sodastream', 1, 4);
  add(29, 'canon', 1, 4); add(29, 'philips', 1, 4); add(29, 'keychron', 1, 4); add(29, 'sodastream', 1, 4);
  // today — mix of phases
  add(30, 'canon', 1, 3);    // active
  add(30, 'keychron', 1, 1); // not started
  add(30, 'philips', 1, 2);  // mid
  add(30, 'sodastream', 1, 4);
  return j;
}
const JOBS = makeJobs();

// PO grid rows for the active job (캐논 / 2026-04-30 / 1차)
const PO_ROWS = [
  { id: 1, po: '129868291', wh: '곤지', method: '쉽먼트', status: '거래처확인', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크 70',  reqQty: 4,   confQty: 4,   exp: '20260430', mfg: '20260420', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 126000 },
  { id: 2, po: '129868269', wh: '안성4', method: '밀크런', status: '거래처확인', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 13L',  reqQty: 13,  confQty: 0,   exp: '20260430', mfg: '20260418', short: '협력사 재고',  contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 105000 },
  { id: 3, po: '129799598', wh: '안성4', method: '밀크런', status: '거래처확인', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크 192', reqQty: 192, confQty: 192, exp: '20260430', mfg: '20260415', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 59000  },
  { id: 4, po: '129799598', wh: '안성4', method: '밀크런', status: '거래처확인', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA M4',  reqQty: 4,   confQty: 4,   exp: '20260430', mfg: '20260417', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 64133  },
  { id: 5, po: '129755019', wh: '인천26', method: '밀크런', status: '거래처확인', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크 48',  reqQty: 48,  confQty: 48,  exp: '20260430', mfg: '20260414', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 59000  },
  { id: 6, po: '129751864', wh: '안성5', method: '쉽먼트', status: '거래처확인', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크 4',   reqQty: 4,   confQty: 4,   exp: '20260430', mfg: '20260420', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 126100 },
  { id: 7, po: '129751765', wh: '안성4', method: '밀크런', status: '거래처확인', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 5L',   reqQty: 5,   confQty: 0,   exp: '20260430', mfg: '20260419', short: '협력사 재고',  contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 105100 },
  { id: 8, po: '129751765', wh: '안성4', method: '밀크런', status: '거래처확인', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA 48',  reqQty: 48,  confQty: 48,  exp: '20260430', mfg: '20260418', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 64133  },
  { id: 9, po: '129722410', wh: '덕평2', method: '밀크런', status: '거래처확인', sku: '4185634',  barcode: '4549292062', name: '캐논 정품 잉크 96',  reqQty: 96,  confQty: 96,  exp: '20260430', mfg: '20260413', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 59000  },
  { id: 10, po: '129722410', wh: '덕평2', method: '밀크런', status: '거래처확인', sku: '42248566', barcode: '4549292221', name: '캐논 컬러 잉크 24',  reqQty: 24,  confQty: 24,  exp: '20260430', mfg: '20260416', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 126000 },
  { id: 11, po: '129701155', wh: '화성2', method: '쉽먼트', status: '거래처확인', sku: '55986452', barcode: '4549292068', name: '캐논 PIXMA 8',  reqQty: 8,   confQty: 8,   exp: '20260430', mfg: '20260417', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 64133  },
  { id: 12, po: '129701155', wh: '화성2', method: '쉽먼트', status: '거래처확인', sku: '66478945', barcode: '4549292255', name: '캐논 가정용 12L',  reqQty: 12,  confQty: 12,  exp: '20260430', mfg: '20260415', short: '',           contact: '신진우', addr: '경기 용인시', tel: '01077777491', amt: 105000 },
];

const LOG_LINES = [
  { ts: '14:27:16', lvl: 'info', msg: '작업 차수 초기화되었습니다.' },
  { ts: '14:27:16', lvl: 'info', msg: 'PO 파일 로드: canon 1차' },
  { ts: '14:27:17', lvl: 'info', msg: '투비 재고조정 로드 (po-tbnws.xlsx)' },
  { ts: '14:27:17', lvl: 'info', msg: '발주확정서 로드 — 12 rows' },
  { ts: '14:27:23', lvl: 'ok',   msg: '쿠팡 사이트 로그인 OK (partition: canon)' },
  { ts: '14:27:25', lvl: 'info', msg: 'WMS 결과 엑셀 매핑 — 4 센터, 6 lots' },
  { ts: '14:27:31', lvl: 'warn', msg: '안성4 / 팔레트 2: SKU 분배 미완 (잔여 14)' },
  { ts: '14:27:34', lvl: 'info', msg: '운송분배 자동 채움 — 안성4(192), 인천26(48), 화성2(20), 덕평2(120)' },
];

// Transport mock — warehouses with lots
const WAREHOUSES = [
  {
    id: 'as4', name: '안성4', addr: '경기 안성시 공도읍', method: '밀크런', total: 192,
    origin: '평택공장', boxCount: 96,
    lots: [
      {
        id: 'as4-m1', type: '밀크런',
        pallets: [
          { id: 'p1', preset: 'T11', boxCount: 48, label: '팔레트 1' },
          { id: 'p2', preset: 'T11', boxCount: 48, label: '팔레트 2' },
        ],
        skus: [
          { rowKey: '4549292062-canon-ink', name: '캐논 정품 잉크', barcode: '4549292062', alloc: { p1: 48, p2: 48 } },
          { rowKey: '4549292068-canon-pixma', name: '캐논 PIXMA M4', barcode: '4549292068', alloc: { p1: 4, p2: 0 } },
        ],
      },
    ],
  },
  {
    id: 'ic26', name: '인천26', addr: '인천 서구 가좌동', method: '밀크런', total: 48,
    origin: '평택공장', boxCount: 24,
    lots: [
      {
        id: 'ic26-m1', type: '밀크런',
        pallets: [
          { id: 'p1', preset: 'T11', boxCount: 48, label: '팔레트 1' },
        ],
        skus: [
          { rowKey: '4549292062-canon-ink', name: '캐논 정품 잉크', barcode: '4549292062', alloc: { p1: 48 } },
        ],
      },
    ],
  },
  {
    id: 'hs2', name: '화성2', addr: '경기 화성시 동탄', method: '쉽먼트', total: 20,
    origin: '평택공장', boxCount: 8,
    lots: [
      {
        id: 'hs2-s1', type: '쉽먼트',
        boxes: [
          { id: 'b1', label: '박스 1', invoice: '420138291' },
          { id: 'b2', label: '박스 2', invoice: '420138292' },
          { id: 'b3', label: '박스 3', invoice: '420138293' },
          { id: 'b4', label: '박스 4', invoice: '420138294' },
        ],
        skus: [
          { rowKey: '4549292068-canon-pixma', name: '캐논 PIXMA M4', barcode: '4549292068', alloc: { b1: 2, b2: 2, b3: 2, b4: 2 } },
          { rowKey: '4549292255-canon-13l', name: '캐논 가정용 13L', barcode: '4549292255', alloc: { b1: 3, b2: 3, b3: 3, b4: 3 } },
        ],
      },
    ],
  },
  {
    id: 'dp2', name: '덕평2', addr: '경기 이천시 마장면', method: '밀크런', total: 120,
    origin: '평택공장', boxCount: 60,
    lots: [
      {
        id: 'dp2-m1', type: '밀크런',
        pallets: [
          { id: 'p1', preset: 'T11', boxCount: 48, label: '팔레트 1' },
          { id: 'p2', preset: 'T11', boxCount: 48, label: '팔레트 2' },
          { id: 'p3', preset: 'T11', boxCount: 24, label: '팔레트 3' },
        ],
        skus: [
          { rowKey: '4549292062-canon-ink', name: '캐논 정품 잉크', barcode: '4549292062', alloc: { p1: 48, p2: 48, p3: 0 } },
          { rowKey: '4549292221-canon-color', name: '캐논 컬러 잉크', barcode: '4549292221', alloc: { p1: 0, p2: 0, p3: 24 } },
        ],
      },
    ],
  },
];

window.MOCK = { VENDORS, PHASES, MONTH, TODAY, JOBS, PO_ROWS, LOG_LINES, WAREHOUSES };
