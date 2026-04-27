/**
 * 쿠팡반출 통합 양식 샘플 빌더.
 *
 * 4개 시트 구조:
 *   ① 대시보드       — 센터별 총계 (읽기 전용)
 *   ② SKU 수량       — (센터, 발주, SKU) 당 1행 · 수량 편집 핵심
 *   ③ 배정           — (센터, 발주, SKU, 박스/파렛트) 당 1행 · 분할 배정
 *   ④ 송장           — 쉽먼트 박스별 송장번호 (센터, 박스번호) 당 1행
 *
 * 실행: node scripts/build-coupang-export-sample.js
 * 결과: 프로젝트 루트에 `쿠팡반출_통합양식_샘플.xlsx` 생성.
 */

const path = require('path');
const ExcelJS = require('exceljs');

// ── 스타일 상수 ──────────────────────────────────────────────────
const BORDER_THIN = {
  top:    { style: 'thin', color: { argb: 'FFBDBDBD' } },
  bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
  left:   { style: 'thin', color: { argb: 'FFBDBDBD' } },
  right:  { style: 'thin', color: { argb: 'FFBDBDBD' } },
};
const HEADER_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' },
};
const READONLY_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' },
};
const EDITABLE_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};
const DASHBOARD_FILL = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FA' },
};
const FONT_DEFAULT = { name: '맑은 고딕', size: 10 };
const FONT_BOLD    = { name: '맑은 고딕', size: 10, bold: true };
const FONT_HEADER  = { name: '맑은 고딕', size: 10, bold: true };
const ALIGN_CENTER = { vertical: 'middle', horizontal: 'center' };
const ALIGN_LEFT   = { vertical: 'middle', horizontal: 'left' };
const ALIGN_RIGHT  = { vertical: 'middle', horizontal: 'right' };

// ── 샘플 데이터 (스크린샷 기반) ────────────────────────────────
// canon 2026-04-29 1차 실제 시나리오:
//   안성4 — 밀크런
//     MG3090 (4549292062830) 쿠팡 192 → 출고 192 (전량)
//     MG3090WH 화이트 (4549292250930) 쿠팡 288 → 출고 4 (재고부족)
//     MG3090WH 화이트 (4549292250930) 두번째 발주 48 → 출고 0 (제외)
//     TS4091 (4549292255881) 쿠팡 13 → 출고 0 (제외)
//     TS4091 (4549292255881) 쿠팡 5  → 출고 0 (제외)
//   안성5 — 쉽먼트 (4박스로 분할)
//     TS7790A (4549292221473) 쿠팡 4 → 출고 4 (박스1~4 각 1)
//   인천26 — 밀크런
//     MG3090 (4549292062830) 쿠팡 48 → 출고 48
//   호법 — 쉽먼트 (박스 1개)
//     TS7790A (4549292221473) 쿠팡 4 → 출고 4 (박스1 에 4)

// SKU 수량 시트 데이터 — 출고수량이 0 인 행은 아예 제외 (보낼 것만 수록).
const skuRows = [
  {
    wh: '안성4', orderSeq: '129799598', code: '4185634',  barcode: '4549292062830',
    name: '캐논 정품 잉크젯복합기 MG3090',
    orderQty: 192, reqQty: 192, exportQty: 0, whQty: 192, confirmedQty: 192, remark: '',
  },
  {
    wh: '안성4', orderSeq: '129799598', code: '55986452', barcode: '4549292250930',
    name: '캐논 PIXMA WiFi 잉크젯 복합기 MG3090WH 화이트',
    orderQty: 288, reqQty: 4,   exportQty: 0, whQty: 4,   confirmedQty: 4,   remark: '재고부족',
  },
  {
    wh: '안성5', orderSeq: '129751864', code: '42248566', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A',
    orderQty: 4, reqQty: 4, exportQty: 0, whQty: 4, confirmedQty: 4, remark: '',
  },
  {
    wh: '인천26', orderSeq: '129755019', code: '4185634', barcode: '4549292062830',
    name: '캐논 정품 잉크젯복합기 MG3090',
    orderQty: 48, reqQty: 48, exportQty: 0, whQty: 48, confirmedQty: 48, remark: '',
  },
  {
    wh: '호법', orderSeq: '129868291', code: '42248566', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A',
    orderQty: 4, reqQty: 4, exportQty: 0, whQty: 4, confirmedQty: 4, remark: '',
  },
];

// 배정 시트 데이터 — 한 SKU 가 여러 박스/파렛트로 나뉠 수 있음.
// 운송방법 = 쉽먼트 → 박스번호 채움 / 밀크런 → 파렛트번호 채움.
const assignRows = [
  // 안성4 — 밀크런 (파렛트 1)
  { wh: '안성4', orderSeq: '129799598', barcode: '4549292062830',
    name: '캐논 정품 잉크젯복합기 MG3090', method: '밀크런',
    boxNo: '', palletNo: 'P1', qty: 192 },
  { wh: '안성4', orderSeq: '129799598', barcode: '4549292250930',
    name: '캐논 PIXMA WiFi 잉크젯 복합기 MG3090WH 화이트', method: '밀크런',
    boxNo: '', palletNo: 'P1', qty: 4 },

  // 안성5 — 쉽먼트 (박스 4개로 분할)
  { wh: '안성5', orderSeq: '129751864', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', method: '쉽먼트',
    boxNo: '1', palletNo: '', qty: 1 },
  { wh: '안성5', orderSeq: '129751864', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', method: '쉽먼트',
    boxNo: '2', palletNo: '', qty: 1 },
  { wh: '안성5', orderSeq: '129751864', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', method: '쉽먼트',
    boxNo: '3', palletNo: '', qty: 1 },
  { wh: '안성5', orderSeq: '129751864', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', method: '쉽먼트',
    boxNo: '4', palletNo: '', qty: 1 },

  // 인천26 — 밀크런
  { wh: '인천26', orderSeq: '129755019', barcode: '4549292062830',
    name: '캐논 정품 잉크젯복합기 MG3090', method: '밀크런',
    boxNo: '', palletNo: 'P1', qty: 48 },

  // 호법 — 쉽먼트 박스 1개
  { wh: '호법', orderSeq: '129868291', barcode: '4549292221473',
    name: '캐논 컬러 잉크젯 복합기 자동양면인쇄 TS7790A', method: '쉽먼트',
    boxNo: '1', palletNo: '', qty: 4 },
];

// 송장 시트 데이터 — 쉽먼트만. (센터, 박스번호) 당 1행.
const invoiceRows = [
  { wh: '안성5', boxNo: '1', invoice: '32767234533' },
  { wh: '안성5', boxNo: '2', invoice: '32767234544' },
  { wh: '안성5', boxNo: '3', invoice: '32767234555' },
  { wh: '안성5', boxNo: '4', invoice: '32767234566' },
  { wh: '호법',  boxNo: '1', invoice: '32767234577' },
];

// ── 대시보드 행 집계 ──────────────────────────────────────────────
function buildDashboardRows() {
  const byWh = new Map();
  for (const s of skuRows) {
    const w = byWh.get(s.wh) || {
      wh: s.wh, skuCount: 0, totalOrder: 0, totalReq: 0, totalExport: 0, totalConfirmed: 0,
      methods: new Set(), boxCount: 0, palletCount: 0,
    };
    w.skuCount += 1;
    w.totalOrder += s.orderQty;
    w.totalReq += s.reqQty;
    w.totalExport += s.exportQty;
    w.totalConfirmed += s.confirmedQty;
    byWh.set(s.wh, w);
  }
  const boxesByWh = new Set();
  const palletsByWh = new Set();
  for (const a of assignRows) {
    const w = byWh.get(a.wh);
    if (!w) continue;
    w.methods.add(a.method);
    if (a.boxNo) boxesByWh.add(`${a.wh}|${a.boxNo}`);
    if (a.palletNo) palletsByWh.add(`${a.wh}|${a.palletNo}`);
  }
  for (const w of byWh.values()) {
    w.boxCount = Array.from(boxesByWh).filter((k) => k.startsWith(`${w.wh}|`)).length;
    w.palletCount = Array.from(palletsByWh).filter((k) => k.startsWith(`${w.wh}|`)).length;
  }
  return Array.from(byWh.values()).sort((a, b) => a.wh.localeCompare(b.wh));
}

// ── 공통: 시트에 헤더 + 데이터 그리기 ─────────────────────────────
function drawSheet(ws, headers, rows, opts = {}) {
  const { widths = [], editableCols = new Set(), freezeHeader = true, rowFill } = opts;

  ws.addRow(headers);
  const headRow = ws.getRow(1);
  headRow.height = 24;
  headRow.eachCell((cell) => {
    cell.font = FONT_HEADER;
    cell.alignment = ALIGN_CENTER;
    cell.fill = HEADER_FILL;
    cell.border = BORDER_THIN;
  });
  for (let i = 0; i < headers.length; i += 1) {
    if (widths[i]) ws.getColumn(i + 1).width = widths[i];
  }
  if (freezeHeader) {
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  rows.forEach((r, idx) => {
    const excelRow = ws.addRow(r);
    excelRow.height = 18;
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = FONT_DEFAULT;
      cell.border = BORDER_THIN;
      if (editableCols.has(col)) {
        cell.fill = EDITABLE_FILL;
      } else if (rowFill) {
        cell.fill = rowFill(idx, r);
      } else {
        cell.fill = READONLY_FILL;
      }
      // 숫자 컬럼은 우측 정렬
      if (typeof r[col - 1] === 'number') {
        cell.alignment = ALIGN_RIGHT;
        cell.numFmt = '#,##0';
      } else {
        cell.alignment = ALIGN_LEFT;
      }
    });
  });
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'coupang-automation';
  wb.lastModifiedBy = 'coupang-automation';
  wb.created = new Date();
  wb.modified = new Date();

  // ═══════ 시트 ① 대시보드 ═══════
  const wsDash = wb.addWorksheet('대시보드', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
  });

  wsDash.addRow(['투비 쿠팡반출 통합 양식']);
  wsDash.getCell(1, 1).font = { name: '맑은 고딕', size: 16, bold: true };
  wsDash.mergeCells('A1:I1');
  wsDash.getRow(1).height = 30;
  wsDash.addRow(['벤더: canon  ·  입고예정일: 2026-04-29  ·  1차']);
  wsDash.getCell(2, 1).font = { name: '맑은 고딕', size: 11, italic: true, color: { argb: 'FF666666' } };
  wsDash.mergeCells('A2:I2');

  const dashHeaders = [
    '물류센터', '운송 구분', 'SKU 종', '총 주문수량', '총 신청수량',
    '총 반출수량', '총 확정수량', '박스 수', '파렛트 수',
  ];
  wsDash.addRow(dashHeaders);
  wsDash.getRow(3).height = 26;
  wsDash.getRow(3).eachCell((cell) => {
    cell.font = FONT_HEADER;
    cell.alignment = ALIGN_CENTER;
    cell.fill = HEADER_FILL;
    cell.border = BORDER_THIN;
  });
  [12, 14, 10, 14, 14, 14, 14, 10, 12].forEach((w, i) => {
    wsDash.getColumn(i + 1).width = w;
  });

  const dashRows = buildDashboardRows();
  for (const w of dashRows) {
    const methods = Array.from(w.methods).join(' + ') || '-';
    const row = wsDash.addRow([
      w.wh, methods, w.skuCount,
      w.totalOrder, w.totalReq, w.totalExport, w.totalConfirmed,
      w.boxCount, w.palletCount,
    ]);
    row.height = 22;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = col <= 2 ? FONT_BOLD : FONT_DEFAULT;
      cell.border = BORDER_THIN;
      cell.fill = DASHBOARD_FILL;
      if (col >= 3) {
        cell.alignment = ALIGN_RIGHT;
        cell.numFmt = '#,##0';
      } else {
        cell.alignment = ALIGN_CENTER;
      }
    });
  }

  // ─── 계단식 상세 섹션 (센터 → SKU → 박스/파렛트 배정) ───
  // 빈 행 하나 띄우고 섹션 제목.
  wsDash.addRow([]);
  const sectionTitleRow = wsDash.addRow(['상세 · 센터 → SKU → 배정 분할']);
  sectionTitleRow.getCell(1).font = { name: '맑은 고딕', size: 13, bold: true };
  wsDash.mergeCells(`A${sectionTitleRow.number}:I${sectionTitleRow.number}`);
  sectionTitleRow.height = 28;

  // 상세 섹션 헤더 (열 의미 재정의)
  const detailHeaders = [
    '물류센터', '센터 총 확정', '발주번호', 'SKU Barcode', '상품명',
    '운송방법', '박스/파렛트', '수량', '송장번호',
  ];
  const detailHeaderRow = wsDash.addRow(detailHeaders);
  detailHeaderRow.height = 24;
  detailHeaderRow.eachCell((cell) => {
    cell.font = FONT_HEADER;
    cell.alignment = ALIGN_CENTER;
    cell.fill = HEADER_FILL;
    cell.border = BORDER_THIN;
  });
  [10, 12, 12, 16, 34, 10, 14, 8, 16].forEach((w, i) => {
    const col = wsDash.getColumn(i + 1);
    if (!col.width || col.width < w) col.width = w;
  });

  // SKU 수량 · 배정 · 송장 을 join 해 상세 행 빌드
  //   (센터, 발주, 바코드) → 해당 SKU 의 assign 목록
  const assignByKey = new Map();
  for (const a of assignRows) {
    const k = `${a.wh}|${a.orderSeq}|${a.barcode}`;
    (assignByKey.get(k) || assignByKey.set(k, []).get(k)).push(a);
  }
  const invoiceByKey = new Map();
  for (const i of invoiceRows) {
    invoiceByKey.set(`${i.wh}|${i.boxNo}`, i.invoice);
  }

  // 센터별 totalConfirmed 맵
  const totalConfirmedByWh = new Map();
  for (const d of dashRows) totalConfirmedByWh.set(d.wh, d.totalConfirmed);

  // 센터 단위로 순회 → SKU 단위로 순회 → 배정 단위로 행 추가.
  // 병합 범위 추적: 센터 A 열 + 총확정 B 열 (센터 전체), SKU C~E (SKU 전체).
  const mergeOps = []; // { range: 'A5:A8' }

  for (const d of dashRows) {
    const wh = d.wh;
    // 해당 센터의 SKU 목록 (skuRows 에서 필터, 정렬은 원본 순서 유지)
    const skusInWh = skuRows.filter((s) => s.wh === wh);
    const centerStartRow = wsDash.rowCount + 1;
    let centerRowsAdded = 0;

    for (const s of skusInWh) {
      const key = `${s.wh}|${s.orderSeq}|${s.barcode}`;
      const assigns = assignByKey.get(key) || [];
      const skuStartRow = wsDash.rowCount + 1;

      if (assigns.length === 0) {
        // 배정 없음 — SKU 행 하나만 빈 배정으로
        const row = wsDash.addRow([
          centerRowsAdded === 0 ? wh : '',
          centerRowsAdded === 0 ? (totalConfirmedByWh.get(wh) || 0) : '',
          s.orderSeq, s.barcode, s.name,
          '-', '-', s.confirmedQty, '',
        ]);
        styleDetailRow(row);
        centerRowsAdded += 1;
      } else {
        assigns.forEach((a, idx) => {
          const isFirstOfSku = idx === 0;
          const boxLabel = a.boxNo ? `박스 ${a.boxNo}` : (a.palletNo ? `파렛트 ${a.palletNo}` : '');
          const invoice = a.boxNo ? (invoiceByKey.get(`${a.wh}|${a.boxNo}`) || '') : '';
          const row = wsDash.addRow([
            centerRowsAdded === 0 && isFirstOfSku ? wh : '',
            centerRowsAdded === 0 && isFirstOfSku ? (totalConfirmedByWh.get(wh) || 0) : '',
            isFirstOfSku ? s.orderSeq : '',
            isFirstOfSku ? s.barcode  : '',
            isFirstOfSku ? s.name     : '',
            a.method,
            boxLabel,
            a.qty,
            invoice,
          ]);
          styleDetailRow(row);
          centerRowsAdded += 1;
        });
      }

      // SKU 병합 (C:E) — 여러 assign 이 있을 때만
      const skuEndRow = wsDash.rowCount;
      if (skuEndRow > skuStartRow) {
        mergeOps.push({ range: `C${skuStartRow}:C${skuEndRow}` });
        mergeOps.push({ range: `D${skuStartRow}:D${skuEndRow}` });
        mergeOps.push({ range: `E${skuStartRow}:E${skuEndRow}` });
      }
    }

    // 센터 병합 (A, B)
    const centerEndRow = wsDash.rowCount;
    if (centerEndRow > centerStartRow) {
      mergeOps.push({ range: `A${centerStartRow}:A${centerEndRow}` });
      mergeOps.push({ range: `B${centerStartRow}:B${centerEndRow}` });
    }
  }

  // 모든 병합 일괄 적용 (중간에 값 비운 행들이라 안전)
  for (const op of mergeOps) {
    try { wsDash.mergeCells(op.range); }
    catch (e) { console.warn('merge skip:', op.range, e.message); }
  }

  function styleDetailRow(row) {
    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = FONT_DEFAULT;
      cell.border = BORDER_THIN;
      if (col === 1) {
        cell.font = FONT_BOLD;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
      } else if (col === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
        cell.numFmt = '#,##0';
      } else if (col === 8) {
        cell.alignment = ALIGN_RIGHT;
        cell.numFmt = '#,##0';
      } else if (col >= 3 && col <= 5) {
        cell.alignment = ALIGN_LEFT;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
      } else {
        cell.alignment = ALIGN_CENTER;
      }
    });
  }

  // ═══════ 시트 ② SKU 수량 ═══════
  const wsSku = wb.addWorksheet('SKU 수량');
  const skuHeaders = [
    '물류센터', '발주번호', '상품코드', 'SKU Barcode', '상품명',
    '주문수량', '신청수량', '반출수량', '창고수량', '확정수량', '비고',
  ];
  const skuData = skuRows.map((r) => ([
    r.wh, r.orderSeq, r.code, r.barcode, r.name,
    r.orderQty, r.reqQty, r.exportQty, r.whQty, r.confirmedQty, r.remark,
  ]));
  // 편집 가능 컬럼 인덱스(1-based): 반출수량(8), 창고수량(9), 확정수량(10), 비고(11)
  drawSheet(wsSku, skuHeaders, skuData, {
    widths: [10, 12, 12, 16, 40, 10, 10, 10, 10, 10, 20],
    editableCols: new Set([8, 9, 10, 11]),
  });
  // 센터 그룹 경계 — 상단 굵은 선
  let prevWh = null;
  for (let r = 2; r <= wsSku.rowCount; r += 1) {
    const wh = String(wsSku.getCell(r, 1).value ?? '');
    if (prevWh !== null && prevWh !== wh) {
      wsSku.getRow(r).eachCell((cell) => {
        cell.border = { ...cell.border, top: { style: 'medium', color: { argb: 'FF9E9E9E' } } };
      });
    }
    prevWh = wh;
  }

  // ═══════ 시트 ③ 배정 ═══════
  const wsAsn = wb.addWorksheet('배정');
  const asnHeaders = [
    '물류센터', '발주번호', 'SKU Barcode', '상품명',
    '운송방법', '박스번호', '파렛트번호', '수량',
  ];
  const asnData = assignRows.map((a) => ([
    a.wh, a.orderSeq, a.barcode, a.name,
    a.method, a.boxNo, a.palletNo, a.qty,
  ]));
  // 편집 가능: 운송방법(5), 박스번호(6), 파렛트번호(7), 수량(8)
  drawSheet(wsAsn, asnHeaders, asnData, {
    widths: [10, 12, 16, 40, 10, 10, 12, 10],
    editableCols: new Set([5, 6, 7, 8]),
  });
  // 같은 SKU 끼리 그룹 표시 — (센터+발주+바코드) 경계에 굵은 선
  let prevKey = null;
  for (let r = 2; r <= wsAsn.rowCount; r += 1) {
    const key = [
      String(wsAsn.getCell(r, 1).value ?? ''),
      String(wsAsn.getCell(r, 2).value ?? ''),
      String(wsAsn.getCell(r, 3).value ?? ''),
    ].join('|');
    if (prevKey !== null && prevKey !== key) {
      wsAsn.getRow(r).eachCell((cell) => {
        cell.border = { ...cell.border, top: { style: 'medium', color: { argb: 'FF9E9E9E' } } };
      });
    }
    prevKey = key;
  }

  // ═══════ 시트 ④ 송장 ═══════
  const wsInv = wb.addWorksheet('송장');
  const invHeaders = ['물류센터', '박스번호', '송장번호', '비고'];
  const invData = invoiceRows.map((i) => [i.wh, i.boxNo, i.invoice, '']);
  drawSheet(wsInv, invHeaders, invData, {
    widths: [10, 10, 20, 20],
    editableCols: new Set([3, 4]),
  });

  // ═══════ 설명 시트 (맨 뒤) ═══════
  const wsDoc = wb.addWorksheet('설명');
  const docLines = [
    ['투비 쿠팡반출 통합 양식 — 사용 규칙'],
    [''],
    ['이 양식은 4개 시트로 구성됩니다.'],
    [''],
    ['① 대시보드'],
    ['  - 센터별 총계. 읽기 전용. 수정하지 마세요.'],
    ['  - 앱에서 다운로드 시 자동 계산되며, 업로드 시 무시됩니다.'],
    [''],
    ['② SKU 수량 (편집 가능)'],
    ['  - (물류센터 + 발주번호 + SKU Barcode) 당 1행.'],
    ['  - 주문수량·신청수량은 참고용 (편집해도 앱에 반영 안 됨).'],
    ['  - 편집 가능: 반출수량 / 창고수량 / 확정수량 / 비고.'],
    ['  - 확정수량이 주문수량보다 작으면 발주확정서에 "납품부족사유" 자동 기재.'],
    [''],
    ['③ 배정 (편집 가능)'],
    ['  - (물류센터 + 발주번호 + SKU Barcode + 박스/파렛트) 당 1행.'],
    ['  - 한 SKU 가 여러 박스로 나뉘면 여러 행으로 반복.'],
    ['  - 운송방법에 따라 박스번호(쉽먼트) 또는 파렛트번호(밀크런) 채움.'],
    ['  - 수량 합계는 SKU 수량 시트의 "확정수량" 과 일치해야 함.'],
    [''],
    ['④ 송장 (편집 가능, 쉽먼트만 해당)'],
    ['  - (물류센터 + 박스번호) 당 1행.'],
    ['  - 쉽먼트 박스에 부여된 운송사 송장번호.'],
    ['  - 배정 시트의 박스번호와 매칭해서 앱이 박스별 송장 관리.'],
    [''],
    ['주의'],
    ['  - 발주번호 + SKU Barcode 는 앱의 고유 ID. 절대 수정 금지.'],
    ['  - 물류센터 이름도 수정 금지.'],
    ['  - 새로운 행 추가 시 SKU 수량 시트에 먼저 등록한 뒤 배정 시트에서 분할.'],
  ];
  for (const line of docLines) {
    const row = wsDoc.addRow(line);
    if (line[0]?.startsWith('①') || line[0]?.startsWith('②')
        || line[0]?.startsWith('③') || line[0]?.startsWith('④')
        || line[0]?.startsWith('업로드')
        || line[0]?.startsWith('주의')) {
      row.getCell(1).font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FF1B4B99' } };
    } else if (line[0] === '투비 쿠팡반출 통합 양식 — 사용 규칙') {
      row.getCell(1).font = { name: '맑은 고딕', size: 14, bold: true };
    } else {
      row.getCell(1).font = FONT_DEFAULT;
    }
  }
  wsDoc.getColumn(1).width = 100;

  const outPath = path.resolve(__dirname, '..', '쿠팡반출_통합양식_샘플.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`생성 완료: ${outPath}`);
  console.log(`시트: 대시보드(${dashRows.length}센터) · SKU 수량(${skuRows.length}행) · 배정(${assignRows.length}행) · 송장(${invoiceRows.length}행) · 설명`);
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
