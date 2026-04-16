/**
 * 재고매칭 시트 — PO 원본을 SKU별로 그룹핑, 출고여부/수량 입력 컬럼 추가
 *
 * 입력: PO 원본 시트 (FortuneSheet Sheet)
 * 출력: 재고매칭 시트 (FortuneSheet Sheet)
 */

const HEADER_STYLE = { bg: '#fff3e0', bl: 1, fc: '#e65100' };
const INPUT_STYLE = { bg: '#fffde7' };

const COLUMNS = [
  { key: 'poNumber',      label: '발주번호',    readOnly: true  },
  { key: 'warehouse',     label: '물류센터',    readOnly: true  },
  { key: 'skuId',         label: 'SKU ID',      readOnly: true  },
  { key: 'skuName',       label: '상품명',      readOnly: true  },
  { key: 'barcode',       label: 'SKU Barcode', readOnly: true  },
  { key: 'orderQty',      label: '주문수량',    readOnly: true  },
  { key: 'deliver',       label: '출고여부',    readOnly: false }, // Y/N
  { key: 'deliverQty',    label: '출고신청',    readOnly: false },
  { key: 'releaseQty',    label: '반출수량',    readOnly: false },
  { key: 'memo',          label: '비고',        readOnly: false },
];

// PO 원본 헤더 → key 매핑 (한국어 헤더명 기반)
const PO_HEADER_MAP = {
  '발주번호': 'poNumber',
  '물류센터': 'warehouse',
  'SKU ID': 'skuId',
  'SKU 이름': 'skuName',
  '상품명': 'skuName',
  'SKU Barcode': 'barcode',
  'SKU Barcode ': 'barcode',
  '발주수량': 'orderQty',
  '주문수량': 'orderQty',
};

function readPoSheet(poSheet) {
  // FortuneSheet celldata 또는 data 배열에서 행/열 파싱
  const cells = [];
  if (poSheet.data && Array.isArray(poSheet.data)) {
    for (let r = 0; r < poSheet.data.length; r++) {
      const row = poSheet.data[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell) continue;
        cells.push({ r, c, v: cell.v ?? cell.m ?? '' });
      }
    }
  } else if (poSheet.celldata) {
    for (const cd of poSheet.celldata) {
      cells.push({ r: cd.r, c: cd.c, v: cd.v?.v ?? cd.v?.m ?? '' });
    }
  }

  if (!cells.length) return [];

  // 첫 행 = 헤더, 각 열의 key 추정
  const headerByCol = {};
  for (const { r, c, v } of cells) {
    if (r !== 0) continue;
    const str = String(v).trim();
    const key = PO_HEADER_MAP[str];
    if (key) headerByCol[c] = key;
  }

  // 데이터 행 수집
  const rowsByR = {};
  for (const { r, c, v } of cells) {
    if (r === 0) continue;
    const key = headerByCol[c];
    if (!key) continue;
    rowsByR[r] = rowsByR[r] || {};
    rowsByR[r][key] = v;
  }

  return Object.values(rowsByR).filter((row) =>
    row.poNumber || row.skuId || row.barcode,
  );
}

export function buildMatchingSheet(poSheet) {
  const rows = readPoSheet(poSheet);

  const data = [];
  // 1행: 헤더
  data.push(
    COLUMNS.map((col) => ({
      v: col.label, m: col.label, ...HEADER_STYLE,
    })),
  );

  // 2행부터: 데이터
  for (const r of rows) {
    const line = COLUMNS.map((col) => {
      const val = r[col.key] ?? '';
      const cell = { v: val, m: String(val) };
      if (!col.readOnly) Object.assign(cell, INPUT_STYLE);
      return cell;
    });
    data.push(line);
  }

  return {
    name: '재고매칭',
    data,
    config: {},
    frozen: { type: 'row' },
  };
}
