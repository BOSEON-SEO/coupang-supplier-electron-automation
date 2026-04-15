import * as XLSX from 'xlsx';

/**
 * Excel 양식 정의 및 직렬화/역직렬화
 *
 * 스키마 버전 필드를 첫 시트 "_meta" 에 포함 → 추후 DB 마이그레이션 대비.
 */

export const SCHEMA_VERSION = 1;

/**
 * 쿠팡 제출용 고정 포맷 컬럼 (업로드 양식 기준)
 *   - PO 번호 / SKU ID / 상품명 / 수량 / 납품여부
 */
export const COUPANG_COLUMNS = [
  { key: 'poNumber', label: 'PO 번호' },
  { key: 'skuId', label: 'SKU ID' },
  { key: 'productName', label: '상품명' },
  { key: 'quantity', label: '수량' },
  { key: 'deliveryStatus', label: '납품여부' },
];

/**
 * 내부 통합 양식 (현황 + DB 대체)
 *   - 쿠팡 양식 + 내부 메타(업데이트 시각, 작업자 메모)
 */
export const INTEGRATED_COLUMNS = [
  ...COUPANG_COLUMNS,
  { key: 'updatedAt', label: '수정 시각' },
  { key: 'memo', label: '메모' },
];

/**
 * rows → ArrayBuffer(xlsx)
 * @param {Array<Record<string, any>>} rows
 * @param {'coupang'|'integrated'} format
 * @param {{ vendor: string, date: string, sequence: number }} meta
 * @returns {ArrayBuffer}
 */
export function rowsToXlsx(rows, format, meta) {
  const columns = format === 'integrated' ? INTEGRATED_COLUMNS : COUPANG_COLUMNS;
  const headerLabels = columns.map((c) => c.label);

  const dataAoa = [
    headerLabels,
    ...rows.map((row) => columns.map((col) => row[col.key] ?? '')),
  ];

  const metaAoa = [
    ['schemaVersion', SCHEMA_VERSION],
    ['format', format],
    ['vendor', meta?.vendor ?? ''],
    ['date', meta?.date ?? ''],
    ['sequence', meta?.sequence ?? ''],
    ['savedAt', new Date().toISOString()],
    ['columns', JSON.stringify(columns.map((c) => c.key))],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataAoa), 'data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaAoa), '_meta');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out instanceof ArrayBuffer ? out : out.buffer;
}

/**
 * ArrayBuffer(xlsx) → { rows, meta, format }
 * @param {ArrayBuffer} buffer
 */
export function xlsxToRows(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const dataSheet = wb.Sheets['data'] || wb.Sheets[wb.SheetNames[0]];
  if (!dataSheet) throw new Error('data sheet missing');

  const aoa = XLSX.utils.sheet_to_json(dataSheet, { header: 1, defval: '' });
  const [header = [], ...body] = aoa;

  // _meta 읽기
  let meta = { schemaVersion: 1, format: 'coupang', vendor: '', date: '', sequence: '' };
  const metaSheet = wb.Sheets['_meta'];
  if (metaSheet) {
    const metaRows = XLSX.utils.sheet_to_json(metaSheet, { header: 1, defval: '' });
    for (const [k, v] of metaRows) {
      if (k) meta[k] = v;
    }
  }

  const columns = meta.format === 'integrated' ? INTEGRATED_COLUMNS : COUPANG_COLUMNS;
  // header label → key 매핑 (순서 기반 폴백)
  const labelToKey = new Map(columns.map((c) => [c.label, c.key]));
  const keys = header.map((label, i) => labelToKey.get(label) ?? columns[i]?.key ?? `col${i}`);

  const rows = body
    .filter((r) => r.some((cell) => cell !== '' && cell != null))
    .map((r) => {
      const obj = {};
      keys.forEach((k, i) => { obj[k] = r[i] ?? ''; });
      return obj;
    });

  return { rows, meta, format: meta.format };
}
