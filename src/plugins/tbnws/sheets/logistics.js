/**
 * 물류작업 시트 — 재고매칭 결과를 창고(물류센터)별로 그룹핑,
 *                 쉽먼트/밀크런 + 박스·팔레트 분배 입력
 *
 * 입력: 재고매칭 시트
 * 출력: 물류작업 시트
 */

const WAREHOUSE_HEADER_STYLE = { bg: '#e3f2fd', bl: 1, fc: '#0d47a1' };
const COL_HEADER_STYLE = { bg: '#f5f5f5', bl: 1, fc: '#424242' };
const INPUT_STYLE = { bg: '#fffde7' };

const COLUMNS = [
  { key: 'skuId',    label: 'SKU ID',      readOnly: true  },
  { key: 'skuName',  label: '상품명',      readOnly: true  },
  { key: 'barcode',  label: '바코드',      readOnly: true  },
  { key: 'reqQty',   label: '신청수량',    readOnly: true  },
  { key: 'confQty',  label: '확정수량',    readOnly: false },
  { key: 'method',   label: '수단',        readOnly: false }, // 쉽먼트/밀크런
  { key: 'boxes',    label: '박스 분배',   readOnly: false }, // 예: "1x48, 2x48"
  { key: 'pallets',  label: '팔레트',      readOnly: false },
  { key: 'memo',     label: '비고',        readOnly: false },
];

function readMatchingSheet(matchingSheet) {
  if (!matchingSheet?.data) return [];

  const rows = [];
  const header = matchingSheet.data[0] || [];
  const keys = header.map((c) => String(c?.v ?? c?.m ?? ''));

  // 한국어 라벨 → 논리 키 매핑 (matching 시트 기준)
  const LABEL_KEY = {
    '발주번호': 'poNumber',
    '물류센터': 'warehouse',
    'SKU ID': 'skuId',
    '상품명': 'skuName',
    'SKU Barcode': 'barcode',
    '주문수량': 'orderQty',
    '출고여부': 'deliver',
    '출고신청': 'deliverQty',
    '반출수량': 'releaseQty',
    '비고': 'memo',
  };
  const colKeys = keys.map((label) => LABEL_KEY[label] || null);

  for (let r = 1; r < matchingSheet.data.length; r++) {
    const rowCells = matchingSheet.data[r];
    if (!rowCells) continue;
    const obj = {};
    for (let c = 0; c < rowCells.length; c++) {
      const key = colKeys[c];
      if (!key) continue;
      obj[key] = rowCells[c]?.v ?? rowCells[c]?.m ?? '';
    }
    // 출고여부 Y 이고 출고신청 수량 있는 행만 물류 대상
    const deliver = String(obj.deliver || '').trim().toUpperCase();
    const qty = Number(obj.deliverQty) || 0;
    if (deliver === 'Y' && qty > 0) {
      rows.push(obj);
    }
  }
  return rows;
}

export function buildLogisticsSheet(matchingSheet) {
  const rows = readMatchingSheet(matchingSheet);

  // 창고별 그룹
  const byWarehouse = new Map();
  for (const r of rows) {
    const w = r.warehouse || '(미지정)';
    if (!byWarehouse.has(w)) byWarehouse.set(w, []);
    byWarehouse.get(w).push(r);
  }

  const data = [];

  for (const [warehouse, items] of byWarehouse) {
    // 창고 배너 행: 한 줄에 창고명 + 합계
    const totalReq = items.reduce((a, b) => a + (Number(b.deliverQty) || 0), 0);
    const banner = Array(COLUMNS.length).fill(null);
    banner[0] = {
      v: `[${warehouse}]  총 신청 ${totalReq}개`,
      m: `[${warehouse}]  총 신청 ${totalReq}개`,
      ...WAREHOUSE_HEADER_STYLE,
    };
    data.push(banner);

    // 컬럼 헤더 행
    data.push(COLUMNS.map((col) => ({
      v: col.label, m: col.label, ...COL_HEADER_STYLE,
    })));

    // 각 SKU 행
    for (const it of items) {
      const srcQty = Number(it.deliverQty) || 0;
      const line = COLUMNS.map((col) => {
        let val = '';
        if (col.key === 'skuId')    val = it.skuId;
        else if (col.key === 'skuName') val = it.skuName;
        else if (col.key === 'barcode') val = it.barcode;
        else if (col.key === 'reqQty')  val = srcQty;
        else if (col.key === 'confQty') val = srcQty; // 기본값 = 신청수량
        const cell = { v: val ?? '', m: String(val ?? '') };
        if (!col.readOnly) Object.assign(cell, INPUT_STYLE);
        return cell;
      });
      data.push(line);
    }

    // 빈 줄 (그룹 간 간격)
    data.push([]);
  }

  return {
    name: '물류작업',
    data,
    config: {},
    frozen: { type: 'row' },
  };
}
