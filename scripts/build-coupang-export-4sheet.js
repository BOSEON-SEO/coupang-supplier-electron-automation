/**
 * 쿠팡반출 4-sheet 샘플 (minimal). 헤더 + 1~2행 예시만.
 * 실행: node scripts/build-coupang-export-4sheet.js
 * 결과: 프로젝트 루트에 `쿠팡반출_4sheet_샘플.xlsx`
 */

const path = require('path');
const ExcelJS = require('exceljs');

const BORDER = {
  top:    { style: 'thin', color: { argb: 'FFBDBDBD' } },
  bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
  left:   { style: 'thin', color: { argb: 'FFBDBDBD' } },
  right:  { style: 'thin', color: { argb: 'FFBDBDBD' } },
};
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
const EDIT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };
const READ_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
const FONT = { name: '맑은 고딕', size: 10 };
const FONT_HEAD = { name: '맑은 고딕', size: 10, bold: true };

function drawHeader(ws, headers, widths) {
  ws.addRow(headers);
  ws.getRow(1).height = 24;
  ws.getRow(1).eachCell((cell) => {
    cell.font = FONT_HEAD;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = HEAD_FILL;
    cell.border = BORDER;
  });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function drawRow(ws, values, editableCols = new Set()) {
  const row = ws.addRow(values);
  row.height = 18;
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.font = FONT;
    cell.border = BORDER;
    cell.fill = editableCols.has(col) ? EDIT_FILL : READ_FILL;
    cell.alignment = typeof values[col - 1] === 'number'
      ? { vertical: 'middle', horizontal: 'right' }
      : { vertical: 'middle', horizontal: 'left' };
    if (typeof values[col - 1] === 'number') cell.numFmt = '#,##0';
  });
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'coupang-automation';

  // ① 대시보드 — 센터별 총계 (자동 계산, 읽기전용)
  const wsDash = wb.addWorksheet('대시보드');
  drawHeader(
    wsDash,
    ['물류센터', '운송 구분', 'SKU 종', '총 신청수량', '총 반출수량', '총 확정수량', '박스 수', '파렛트 수'],
    [12, 14, 8, 12, 12, 12, 8, 10],
  );
  drawRow(wsDash, ['안성5', '쉽먼트', 1, 4, 0, 4, 4, 0]);
  drawRow(wsDash, ['호법',  '쉽먼트', 1, 4, 0, 4, 1, 0]);

  // ② SKU 수량 — (센터, 발주, 바코드) 당 1행, 수량 편집
  const wsSku = wb.addWorksheet('SKU 수량');
  drawHeader(
    wsSku,
    ['물류센터', '발주번호', '상품코드', 'SKU Barcode', '상품명',
     '주문수량', '신청수량', '반출수량', '창고수량', '확정수량', '비고'],
    [10, 12, 12, 16, 40, 10, 10, 10, 10, 10, 20],
  );
  // 편집 가능: 8 반출, 9 창고, 10 확정, 11 비고
  drawRow(
    wsSku,
    ['안성5', '129751864', '42248566', '4549292221473',
     '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', 4, 4, 0, 4, 4, ''],
    new Set([8, 9, 10, 11]),
  );
  drawRow(
    wsSku,
    ['호법', '129868291', '42248566', '4549292221473',
     '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', 4, 4, 0, 4, 4, ''],
    new Set([8, 9, 10, 11]),
  );

  // ③ 배정 — (센터, 발주, 바코드, 박스/파렛트) 당 1행
  const wsAsn = wb.addWorksheet('배정');
  drawHeader(
    wsAsn,
    ['물류센터', '발주번호', 'SKU Barcode', '상품명',
     '운송방법', '박스번호', '파렛트번호', '수량'],
    [10, 12, 16, 40, 10, 10, 12, 8],
  );
  // 편집 가능: 5 운송, 6 박스, 7 파렛트, 8 수량
  drawRow(
    wsAsn,
    ['안성5', '129751864', '4549292221473',
     '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', '쉽먼트', '1', '', 1],
    new Set([5, 6, 7, 8]),
  );
  drawRow(
    wsAsn,
    ['안성5', '129751864', '4549292221473',
     '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', '쉽먼트', '2', '', 1],
    new Set([5, 6, 7, 8]),
  );
  drawRow(
    wsAsn,
    ['호법', '129868291', '4549292221473',
     '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', '쉽먼트', '1', '', 4],
    new Set([5, 6, 7, 8]),
  );

  // ④ 송장 — (센터, 박스번호) 당 1행, 쉽먼트만
  const wsInv = wb.addWorksheet('송장');
  drawHeader(
    wsInv,
    ['물류센터', '박스번호', '송장번호', '비고'],
    [10, 10, 20, 20],
  );
  // 편집 가능: 3 송장, 4 비고
  drawRow(wsInv, ['안성5', '1', '32767234533', ''], new Set([3, 4]));
  drawRow(wsInv, ['안성5', '2', '32767234544', ''], new Set([3, 4]));
  drawRow(wsInv, ['호법',  '1', '32767234577', ''], new Set([3, 4]));

  const outPath = path.resolve(__dirname, '..', '쿠팡반출_4sheet_샘플.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`생성 완료: ${outPath}`);
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
