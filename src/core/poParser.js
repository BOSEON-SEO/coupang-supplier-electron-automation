/**
 * FortuneSheet sheets → MasterRow[] 변환.
 *
 * MasterRow (범용 쿠팡 PO 스키마):
 *   coupang_order_seq, departure_warehouse,
 *   sku_id, sku_barcode, sku_name,
 *   order_quantity, confirmed_qty, export_yn,
 *   purchase_price, supply_price, vat, total_purchase_amount,
 *   expected_arrival_date, order_date, xdock
 */

// PO 원본 xlsx 의 한국어 헤더 → MasterRow key 매핑
const HEADER_MAP = {
  '발주번호': 'coupang_order_seq',
  '주문번호': 'coupang_order_seq',
  '발주유형': null,
  '발주현황': null,
  '발주상태': null,
  '입고유형': 'transport',
  'SKU ID': 'sku_id',
  '상품번호': 'sku_id',
  'SKU 이름': 'sku_name',
  '상품이름': 'sku_name',
  '상품명': 'sku_name',
  'SKU Barcode': 'sku_barcode',
  'SKU Barcode ': 'sku_barcode',
  '상품바코드': 'sku_barcode',
  '물류센터': 'departure_warehouse',
  '입고예정일': 'expected_arrival_date',
  '발주일': 'order_date',
  '발주등록일시': 'order_date',
  '발주수량': 'order_quantity',
  '확정수량': 'confirmed_qty',
  '입고수량': null,
  '매입가': 'purchase_price',
  '공급가': 'supply_price',
  'VAT': 'vat',
  '부가세': 'vat',
  '총발주 매입금': 'total_purchase_amount',
  '총매입금': 'total_purchase_amount',
  '매입유형': null,
  '면세여부': null,
  '생산연도': null,
  '생산년도': null,
  '제조일자': null,
  '유통(소비)기한': null,
  'Xdock': 'xdock',
  '출고여부': 'export_yn',
  '납품여부': 'export_yn',
};

function readCellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'object') return cell.v ?? cell.m ?? '';
  return cell;
}

export function parsePoSheets(sheets) {
  if (!sheets?.length) return [];
  const sheet = sheets[0]; // 첫 시트가 PO 원본
  const data = sheet.data;
  if (!Array.isArray(data) || !data.length) return [];

  // 첫 행 = 헤더
  const headerRow = data[0] || [];
  const keyByCol = {};
  for (let c = 0; c < headerRow.length; c += 1) {
    const label = String(readCellText(headerRow[c])).trim();
    const key = HEADER_MAP[label];
    if (key) keyByCol[c] = key;
  }

  const rows = [];
  for (let r = 1; r < data.length; r += 1) {
    const rowCells = data[r];
    if (!rowCells) continue;
    const obj = {};
    for (let c = 0; c < rowCells.length; c += 1) {
      const key = keyByCol[c];
      if (!key) continue;
      obj[key] = readCellText(rowCells[c]);
    }
    // 발주번호/상품번호 하나라도 있으면 유효 행
    if (obj.coupang_order_seq || obj.sku_id || obj.sku_barcode) {
      rows.push(obj);
    }
  }

  return rows;
}
