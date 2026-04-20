import ExcelJS from 'exceljs';

/**
 * PO 원본 xlsx 에 발주확정서와 동일한 스타일(폰트·정렬·테두리·헤더/편집셀 fill)을
 * 적용한 버퍼를 반환한다. 디스크 파일은 건드리지 않고 "표시용" 버퍼만 생성.
 *
 * 매 로드 시 재적용되므로 idempotent — 저장 시 sheetsToXlsx 로 스타일이 일부
 * 유실되어도 다음 로드에서 다시 덮어씌워진다.
 */

const FONT = { name: '맑은 고딕', size: 10 };
const HEADER_FONT = { ...FONT, bold: true, color: { argb: 'FF1A237E' } };
const ALIGN = { vertical: 'middle', horizontal: 'center', wrapText: false };

const THIN = { style: 'thin', color: { argb: 'FF9E9E9E' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const HEADER_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' },
};
const EDITABLE_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};

// 확정서와 동일하게 "사용자가 수정할 여지 있는" 열에 노란 배경
const EDITABLE_HEADERS = new Set([
  '확정수량', '입고유형', '납품부족사유', '출고여부', '납품여부',
]);

// 헤더별 열 너비 힌트 (확정서 PO_WIDTHS 에 맞춤, 없으면 기본값)
const WIDTH_HINT = {
  '발주번호': 14, '주문번호': 14,
  '물류센터': 12, '입고유형': 10,
  '발주상태': 14, '발주현황': 14, '발주유형': 14,
  '상품번호': 12, 'SKU ID': 12,
  '상품바코드': 16, 'SKU Barcode': 16, 'SKU Barcode ': 16,
  '상품이름': 40, '상품명': 40, 'SKU 이름': 40,
  '발주수량': 10, '확정수량': 10, '입고수량': 10,
  '유통(소비)기한': 14, '제조일자': 12, '생산년도': 10, '생산연도': 10,
  '납품부족사유': 28, '회송담당자': 14, '회송담당자 연락처': 18, '회송지주소': 40,
  '매입가': 12, '공급가': 12, 'VAT': 10, '부가세': 10,
  '총발주 매입금': 14, '총매입금': 14,
  '입고예정일': 12, '발주일': 12, '발주등록일시': 20,
  'Xdock': 8, '매입유형': 12, '면세여부': 10,
  '출고여부': 10, '납품여부': 10,
};

export async function applyPoStyle(arrayBuffer) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return arrayBuffer;

    // 쿠팡 원본 PO 는 sheetFormatPr/defaultRowHeight 가 빠져있어
    // LuckyExcel fallback 이 큰 높이로 렌더된다. 확정서와 동일하게 15pt 로 고정.
    ws.properties.defaultRowHeight = 15;

    // 편집 대상 열 번호(1-based) 수집
    const editableCols = new Set();
    const headerRow = ws.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const label = String(cell.value ?? '').trim();
      if (EDITABLE_HEADERS.has(label)) editableCols.add(colNumber);
    });

    // 열 너비 힌트 적용
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const label = String(cell.value ?? '').trim();
      const w = WIDTH_HINT[label];
      if (w) ws.getColumn(colNumber).width = w;
    });

    // 모든 데이터 행에 스타일 적용 (row.height 는 건드리지 않음 —
    // 확정서와 동일하게 FortuneSheet defaultRowHeight 에 맡긴다)
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.font = HEADER_FONT;
          cell.alignment = ALIGN;
          cell.fill = HEADER_FILL;
          cell.border = BORDER;
        });
      } else {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = FONT;
          cell.alignment = ALIGN;
          cell.border = BORDER;
          if (editableCols.has(colNumber)) cell.fill = EDITABLE_FILL;
        });
      }
    });

    const out = await wb.xlsx.writeBuffer();
    return out instanceof ArrayBuffer
      ? out
      : out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  } catch {
    // 스타일 적용 실패 시 원본 그대로 반환 (뷰어가 깨지는 것보다 낫다)
    return arrayBuffer;
  }
}
