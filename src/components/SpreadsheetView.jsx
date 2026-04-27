import React, { useEffect, useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────
// xlsx → fortune-sheet sheets 직접 변환.
// LuckyExcel 의존 제거 — LuckyExcel 이 ExcelJS 로 쓰인 파일의 일부 셀 값을
// 못 잡아 빈 셀로 렌더되는 글리치가 있어서 SheetJS 로 직접 파싱.
// ─────────────────────────────────────────────────────────────────
const HEADER_STYLE = { bg: '#e8eaf6', bl: 1, fc: '#1a237e' };

function cellTypeFromValue(v, t) {
  if (t === 'n') return { fa: 'General', t: 'n' };
  if (t === 'd') return { fa: 'yyyy-mm-dd', t: 'd' };
  if (t === 'b') return { fa: 'General', t: 'b' };
  return { fa: 'General', t: 's' };
}

function buildSheetsFromXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false, cellStyles: false });
  const sheets = [];
  wb.SheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const ref = ws['!ref'];
    if (!ref) {
      // 빈 시트라도 자리 차지하도록 최소 형태로 등록
      sheets.push({
        name, order: idx, data: [[null]], row: 1, column: 1,
        frozen: { type: 'row' }, config: {},
      });
      return;
    }
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r + 1;
    const cols = range.e.c + 1;

    const data = [];
    for (let r = 0; r <= range.e.r; r += 1) {
      const row = [];
      for (let c = 0; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell || cell.v == null || cell.v === '') {
          // 빈 셀 — 헤더 행이면 스타일만 적용된 빈 cell, 아니면 null
          if (r === 0) {
            row.push({ ...HEADER_STYLE });
          } else {
            row.push(null);
          }
          continue;
        }
        const cellObj = {
          v: cell.v,
          m: cell.w != null ? String(cell.w) : String(cell.v),
          ct: cellTypeFromValue(cell.v, cell.t),
        };
        if (r === 0) Object.assign(cellObj, HEADER_STYLE);
        row.push(cellObj);
      }
      data.push(row);
    }

    // !cols (열 너비) 가져와 luckysheet config.columnlen 으로 변환
    const columnlen = {};
    if (Array.isArray(ws['!cols'])) {
      ws['!cols'].forEach((c, i) => {
        if (c?.wch) columnlen[i] = Math.max(60, Math.round(c.wch * 7));
        else if (c?.wpx) columnlen[i] = c.wpx;
      });
    }

    sheets.push({
      name, order: idx, data, row: rows, column: cols,
      frozen: { type: 'row' },
      config: Object.keys(columnlen).length > 0 ? { columnlen } : {},
    });
  });
  return sheets;
}

/**
 * FortuneSheet 기반 스프레드시트 뷰.
 *
 * Props:
 *   - xlsxBuffer: ArrayBuffer (xlsx 원본)
 *   - fileName: string (변환 시 사용, 기본 'data.xlsx')
 *   - onChange: (sheets: Sheet[]) => void — 편집 시 호출
 *   - readOnly: boolean
 *
 * ref 메서드:
 *   - forceRerender(): FortuneSheet 인스턴스 재마운트 (렌더 깨짐 복구용)
 */
const SpreadsheetView = forwardRef(function SpreadsheetView(
  { xlsxBuffer, fileName, onChange, onReady, readOnly },
  ref,
) {
  const [sheets, setSheets] = useState(null);
  const [error, setError] = useState(null);
  const [key, setKey] = useState(0);
  // forceRerender 가 useEffect 재실행을 트리거해 LuckyExcel 변환부터 다시 돌리도록
  const [parseTrigger, setParseTrigger] = useState(0);
  const ignoreUntilRef = useRef(0);

  useEffect(() => {
    if (!xlsxBuffer) {
      setSheets(null);
      return;
    }

    setError(null);
    try {
      const prepared = buildSheetsFromXlsxBuffer(xlsxBuffer);
      if (!prepared.length) {
        setError('시트가 없습니다.');
        return;
      }
      setSheets(prepared);
      setKey((k) => k + 1);
      // 마운트 직후 1초간 FortuneSheet 가 쏘는 onChange 무시
      ignoreUntilRef.current = Date.now() + 1000;
      onReady?.(prepared);
    } catch (err) {
      setError(`xlsx 파싱 실패: ${err.message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xlsxBuffer, fileName, parseTrigger]);

  const handleChange = useCallback(
    (data) => {
      if (Date.now() < ignoreUntilRef.current) return;
      onChange?.(data);
    },
    [onChange],
  );

  // 외부에서 호출 가능한 명령들.
  //
  // forceRerender — 디자인/셀 깨짐 가벼운 복구.
  //   luckysheet/fortune-sheet 는 window resize 이벤트를 듣고 canvas 를 redraw.
  //   따라서 dispatchEvent('resize') 한 번이면 보통 깨짐 복구됨 (parseTrigger 안 씀).
  //   여러 번 dispatch 해서 비동기 layout 모두 catch.
  //
  // forceReparse — 데이터 자체가 깨졌을 때 사용 (LuckyExcel 부터 재파싱).
  //   resize redraw 로 안 풀리면 호출.
  useImperativeHandle(ref, () => ({
    forceRerender() {
      // 다중 dispatch — 첫 호출은 즉시, 나머지는 next frame/short delay 에 backup.
      const fire = () => {
        try { window.dispatchEvent(new Event('resize')); } catch (_) { /* 무시 */ }
      };
      fire();
      requestAnimationFrame(fire);
      setTimeout(fire, 50);
      setTimeout(fire, 200);
    },
    forceReparse() {
      setSheets(null);
      setError(null);
      setParseTrigger((t) => t + 1);
      ignoreUntilRef.current = Date.now() + 2000;
    },
  }), []);

  if (error) {
    return <div className="spreadsheet-empty spreadsheet-error">{error}</div>;
  }

  if (!sheets) {
    return <div className="spreadsheet-empty">데이터가 없습니다. PO 다운로드를 실행하세요.</div>;
  }

  return (
    <div className="spreadsheet-container">
      <Workbook
        key={key}
        data={sheets}
        onChange={handleChange}
        showToolbar={false}
        showFormulaBar={false}
        showSheetTabs
        allowEdit={!readOnly}
        defaultRowHeight={28}
        lang="ko"
      />
    </div>
  );
});

export default SpreadsheetView;
