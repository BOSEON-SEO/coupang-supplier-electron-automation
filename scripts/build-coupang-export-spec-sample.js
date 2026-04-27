/**
 * WMS 연동 명세에 첨부할 예시 파일 — 5월 1일 쿠팡 1차 기준.
 *
 * spec (`WMS_연동_쿠팡반출_양식_명세.md`) 의 모든 케이스를 한 파일에 담음:
 *   - 단순 케이스 (분할 없음)
 *   - 분할 케이스 (한 SKU 가 여러 박스)
 *   - 쉽먼트 + 밀크런 혼합
 *   - 같은 센터 여러 SKU
 *   - SKU 단위 컬럼은 첫 분할 행에만 (빈 셀 스타일)
 *
 * 실행: node scripts/build-coupang-export-spec-sample.js
 * 결과: 프로젝트 루트에 `쿠팡반출_샘플_쿠팡_0501_1차.xlsx`
 */

const path = require('path');
const ExcelJS = require('exceljs');

// ── 스타일 ───────────────────────────────────────────────────────
const HEADER_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' },
};
const FONT = { name: '맑은 고딕', size: 10 };
const FONT_BOLD = { name: '맑은 고딕', size: 10, bold: true };
const BORDER = {
  top:    { style: 'thin', color: { argb: 'FFBDBDBD' } },
  bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
  left:   { style: 'thin', color: { argb: 'FFBDBDBD' } },
  right:  { style: 'thin', color: { argb: 'FFBDBDBD' } },
};

const HEADER = [
  '물류센터', '총 주문수량', '총 풀필반출', '발주번호', '상품코드',
  'SKU Barcode', '상품명', '신청수량', '반출', '창고수량', '확정수량',
  '운송방법', '박스번호', '송장번호', '파렛트번호', '비고',
];
const COL_WIDTHS = [10, 10, 10, 12, 14, 16, 38, 8, 8, 8, 8, 10, 8, 16, 10, 18];

// ── SKU 데이터 (센터, 발주, SKU, 분할 정보) ─────────────────────
//
// 형식: { wh, totalReq?, totalExport?, orderSeq, code, barcode, name,
//         reqQty, exportQty, whQty, remark, splits: [{qty, method, boxNo, palletNo, invoice}] }
//
// totalReq/totalExport: 센터의 첫 SKU 첫 행에만 표시 (자동 계산 안 함, 명시).
//
// splits 의 각 entry = 한 박스/파렛트 = 한 엑셀 행
// 첫 split 의 SKU 정보 (상품명/신청/반출/창고/비고) 는 채우고, 후속 split 은 빈 셀.

const skus = [
  // ─ 안성4 (밀크런, 파렛트 P1) ─
  // MG3090 — 단순 케이스 (분할 없음, 1행)
  {
    wh: '안성4', totalReq: 196, totalExport: 0,
    orderSeq: '129799598', code: '4185634', barcode: '4549292062830',
    name: '캐논 정품 잉크젯복합기 MG3090',
    reqQty: 192, exportQty: 0, whQty: 192, remark: '',
    splits: [
      { qty: 192, method: '밀크런', boxNo: '', palletNo: 'P1', invoice: '' },
    ],
  },
  // MG3090WH — 일부만 출고 (재고부족 케이스, 분할 없음)
  {
    wh: '안성4',
    orderSeq: '129799598', code: '55986452', barcode: '4549292250930',
    name: '캐논 PIXMA WiFi 잉크젯 복합기 MG3090WH 화이트',
    reqQty: 4, exportQty: 0, whQty: 4, remark: '재고부족',
    splits: [
      { qty: 4, method: '밀크런', boxNo: '', palletNo: 'P1', invoice: '' },
    ],
  },

  // ─ 안성5 (쉽먼트, 4박스로 분할) ─
  {
    wh: '안성5', totalReq: 4, totalExport: 0,
    orderSeq: '129751864', code: '42248566', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A',
    reqQty: 4, exportQty: 0, whQty: 4, remark: '',
    splits: [
      { qty: 1, method: '쉽먼트', boxNo: '1', palletNo: '', invoice: '32767234533' },
      { qty: 1, method: '쉽먼트', boxNo: '2', palletNo: '', invoice: '32767234544' },
      { qty: 1, method: '쉽먼트', boxNo: '3', palletNo: '', invoice: '32767234555' },
      { qty: 1, method: '쉽먼트', boxNo: '4', palletNo: '', invoice: '32767234566' },
    ],
  },

  // ─ 인천26 (밀크런) ─
  {
    wh: '인천26', totalReq: 48, totalExport: 0,
    orderSeq: '129755019', code: '4185634', barcode: '4549292062830',
    name: '캐논 정품 잉크젯복합기 MG3090',
    reqQty: 48, exportQty: 0, whQty: 48, remark: '',
    splits: [
      { qty: 48, method: '밀크런', boxNo: '', palletNo: 'P1', invoice: '' },
    ],
  },

  // ─ 호법 (쉽먼트, 박스 1개에 모두) ─
  {
    wh: '호법', totalReq: 4, totalExport: 2,
    orderSeq: '129868291', code: '42248566', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A',
    reqQty: 4, exportQty: 2, whQty: 2, remark: '풀필 2 + 창고 2',
    splits: [
      { qty: 4, method: '쉽먼트', boxNo: '1', palletNo: '', invoice: '32767234577' },
    ],
  },
];

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'coupang-automation';
  wb.created = new Date('2026-05-01');
  wb.modified = new Date();

  const ws = wb.addWorksheet('반출');

  // 헤더
  ws.addRow(HEADER);
  ws.getRow(1).height = 24;
  ws.getRow(1).eachCell((cell) => {
    cell.font = FONT_BOLD;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
  });
  COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // 데이터 — 센터 그룹 경계 추적
  let prevWh = null;
  for (const s of skus) {
    s.splits.forEach((sp, idx) => {
      const isFirstSplit = idx === 0;
      const isFirstOfCenter = isFirstSplit && prevWh !== s.wh;

      const values = [
        s.wh,                                             // 1. 물류센터 (모든 행)
        isFirstOfCenter ? s.totalReq : '',                // 2. 총 주문수량 (센터 첫 행만)
        isFirstOfCenter ? s.totalExport : '',             // 3. 총 풀필반출 (센터 첫 행만)
        s.orderSeq,                                       // 4. 발주번호 (모든 행)
        s.code,                                           // 5. 상품코드 (모든 행)
        s.barcode,                                        // 6. SKU Barcode (모든 행)
        isFirstSplit ? s.name : '',                       // 7. 상품명 (첫 분할만)
        isFirstSplit ? s.reqQty : '',                     // 8. 신청수량 (첫 분할만)
        isFirstSplit ? s.exportQty : '',                  // 9. 반출 (첫 분할만)
        isFirstSplit ? s.whQty : '',                      // 10. 창고수량 (첫 분할만)
        sp.qty,                                           // 11. 확정수량 (행마다)
        sp.method,                                        // 12. 운송방법 (행마다)
        sp.boxNo,                                         // 13. 박스번호 (행마다)
        sp.invoice,                                       // 14. 송장번호 (행마다)
        sp.palletNo,                                      // 15. 파렛트번호 (행마다)
        isFirstSplit ? s.remark : '',                     // 16. 비고 (첫 분할만)
      ];
      const row = ws.addRow(values);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = FONT;
        cell.border = BORDER;
        // 숫자 컬럼 우측 정렬
        if (typeof values[col - 1] === 'number') {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      });
      // SKU Barcode 는 숫자 보존 (긴 숫자가 지수표기 되지 않도록)
      row.getCell(6).numFmt = '0';
    });

    prevWh = s.wh;
  }

  const outPath = path.resolve(__dirname, '..', '쿠팡반출_샘플_쿠팡_0501_1차.xlsx');
  await wb.xlsx.writeFile(outPath);

  // 통계 로깅
  const totalSkus = skus.length;
  const totalRows = skus.reduce((s, sk) => s + sk.splits.length, 0);
  const splitSkus = skus.filter((sk) => sk.splits.length > 1).length;
  console.log(`생성 완료: ${outPath}`);
  console.log(`SKU ${totalSkus}종 · 엑셀 데이터 ${totalRows}행 · 분할 SKU ${splitSkus}종`);
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
