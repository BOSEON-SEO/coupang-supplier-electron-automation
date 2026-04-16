import ExcelJS from 'exceljs';

/**
 * 쿠팡 발주확정서 xlsx 빌더 (범용).
 *
 * 회사별 상수(회송담당자/주소 등)는 options 로 받는다.
 * 특수 분기(브랜드별 회송담당자 치환 등)는 회사 플러그인에서 options 를
 * 가공해서 넘기는 방식으로 처리.
 */

export const PO_HEADERS = [
  '발주번호', '물류센터', '입고유형', '발주상태',
  '상품번호', '상품바코드', '상품이름', '발주수량',
  '확정수량', '유통(소비)기한', '제조일자', '생산년도',
  '납품부족사유', '회송담당자', '회송담당자 연락처', '회송지주소',
  '매입가', '공급가', '부가세', '총발주 매입금',
  '입고예정일', '발주등록일시', 'Xdock',
];

// 엑셀 열 순서대로의 기본 너비 (쿠팡 양식 기준)
const PO_WIDTHS = [
  14, 12, 10, 14, 12, 16, 40, 10,
  10, 14, 12, 10, 28, 14, 18, 40,
  12, 12, 10, 14, 12, 20, 8,
];

const PO_FONT = { name: '맑은 고딕', size: 10 };
const PO_ALIGNMENT = { vertical: 'middle', horizontal: 'center', wrapText: false };
const PO_HEADER_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' },
};
const PO_EDITABLE_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};

// C=3(입고유형), I=9(확정수량), M=13(납품부족사유) - 사용자가 편집할 셀
const PO_EDITABLE_COLS = new Set([3, 9, 13]);

// 쿠팡이 제공하는 납품부족사유 옵션 (hiddenSheet 에 나열)
export const SHORTAGE_REASONS = [
  '협력사 재고부족 - 수입상품 입고지연 (선적/통관지연)',
  '협력사 재고부족 - 제조지연',
  '협력사 재고부족 - 기타',
  '쿠팡 발주오류',
  '단종/리뉴얼',
  '기타',
];

const thinBorder = { style: 'thin', color: { argb: 'FF9E9E9E' } };

function poHeaderBorder() {
  return {
    top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder,
  };
}

function poDataBorder() {
  return {
    top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder,
  };
}

function fmtComma(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US');
}

function toYYYYMMDD(v) {
  if (!v) return '';
  const s = String(v);
  // 이미 YYYYMMDD 또는 YYYY-MM-DD 형태면 그대로
  const digits = s.replace(/[^0-9]/g, '');
  return digits.slice(0, 8);
}

function fmtDateTime(v) {
  if (!v) return '';
  // 그대로 문자열로 반환 (파싱은 PO 원본에 맡김)
  return String(v);
}

/**
 * @param {Array<object>} masterData  MasterRow[] — parsePoSheets 결과
 * @param {object} options
 *   - returnContact: string
 *   - returnPhone: string
 *   - returnAddress: string
 *   - warehouseTransport: Record<string, '쉽먼트'|'밀크런'>
 *   - defaultTransport: '쉽먼트'|'밀크런' (default: '쉽먼트')
 * @returns {Promise<ArrayBuffer>}
 */
export async function buildConfirmationArrayBuffer(masterData, options = {}) {
  const {
    returnContact = '',
    returnPhone = '',
    returnAddress = '',
    warehouseTransport = {},
    defaultTransport = '쉽먼트',
  } = options;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('상품목록');

  ws.columns = PO_HEADERS.map((h, i) => ({ width: PO_WIDTHS[i] }));

  // 헤더 행
  const hr = ws.addRow(PO_HEADERS);
  hr.eachCell((cell) => {
    cell.font = PO_FONT;
    cell.alignment = PO_ALIGNMENT;
    cell.fill = PO_HEADER_FILL;
    cell.border = poHeaderBorder();
  });

  for (const row of masterData) {
    const transport = warehouseTransport[row.departure_warehouse] || defaultTransport;
    const confirmedQty = row.export_yn === 'N' ? '0' : String(row.confirmed_qty ?? row.order_quantity ?? 0);
    const confirmedNum = Number(confirmedQty) || 0;
    const orderQtyNum = Number(row.order_quantity) || 0;
    const shortageReason = (confirmedNum < orderQtyNum)
      ? SHORTAGE_REASONS[0]
      : '';

    const dr = ws.addRow([
      row.coupang_order_seq,               // A 발주번호
      row.departure_warehouse,             // B 물류센터
      transport,                           // C 입고유형
      '거래처확인요청',                      // D 발주상태 (고정)
      row.sku_id,                          // E 상품번호
      row.sku_barcode,                     // F 상품바코드
      row.sku_name,                        // G 상품이름
      String(row.order_quantity ?? ''),    // H 발주수량
      confirmedQty,                        // I 확정수량
      '',                                  // J 유통(소비)기한
      '',                                  // K 제조일자
      '',                                  // L 생산년도
      shortageReason,                      // M 납품부족사유
      returnContact,                       // N 회송담당자
      returnPhone,                         // O 회송담당자 연락처
      returnAddress,                       // P 회송지주소
      fmtComma(row.purchase_price),        // Q 매입가
      fmtComma(row.supply_price),          // R 공급가
      fmtComma(row.vat),                   // S 부가세
      fmtComma(row.total_purchase_amount), // T 총발주 매입금
      toYYYYMMDD(row.expected_arrival_date), // U 입고예정일
      fmtDateTime(row.order_date),         // V 발주등록일시
      row.xdock || 'N',                    // W Xdock
    ]);

    dr.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = PO_FONT;
      cell.alignment = PO_ALIGNMENT;
      cell.border = poDataBorder();
      if (PO_EDITABLE_COLS.has(col)) {
        cell.fill = PO_EDITABLE_FILL;
      }
    });
  }

  // 데이터 유효성 — 입고유형(C), 납품부족사유(M)
  const dataCount = masterData.length;
  for (let r = 2; r <= dataCount + 1; r += 1) {
    ws.getCell(`C${r}`).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['"쉽먼트,밀크런"'],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'ERROR', error: '잘못된 값을 입력하였습니다.',
    };
    ws.getCell(`M${r}`).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: [`hiddenSheet!$A$1:$A$${SHORTAGE_REASONS.length}`],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'ERROR', error: '잘못된 값을 입력하였습니다.',
    };
  }

  // hiddenSheet — 납품부족사유 선택 소스
  const hidden = wb.addWorksheet('hiddenSheet');
  hidden.state = 'veryHidden';
  SHORTAGE_REASONS.forEach((reason, i) => {
    hidden.getCell(`A${i + 1}`).value = reason;
  });

  const buffer = await wb.xlsx.writeBuffer();
  // ExcelJS 는 Uint8Array.buffer 를 반환할 수 있음 → 보정
  return buffer instanceof ArrayBuffer
    ? buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
