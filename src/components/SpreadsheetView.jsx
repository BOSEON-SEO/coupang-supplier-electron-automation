import React, { useEffect, useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import LuckyExcel from 'luckyexcel';

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
      const file = new File([xlsxBuffer], fileName || 'data.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      LuckyExcel.transformExcelToLucky(file, (exportJson) => {
        if (exportJson?.sheets?.length) {
          const prepared = exportJson.sheets.map((s, i) => {
            const sheet = { ...s, order: i, frozen: { type: 'row' } };

            // 첫 행(헤더) 스타일 주입: 배경색 + 볼드 + 글자색
            if (sheet.data && Array.isArray(sheet.data) && sheet.data[0]) {
              sheet.data[0] = sheet.data[0].map((cell) => {
                if (!cell) return { bg: '#e8eaf6', bl: 1, fc: '#1a237e' };
                return { ...cell, bg: '#e8eaf6', bl: 1, fc: '#1a237e' };
              });
            } else if (sheet.celldata && Array.isArray(sheet.celldata)) {
              for (const cd of sheet.celldata) {
                if (cd.r === 0 && cd.v) {
                  cd.v = { ...cd.v, bg: '#e8eaf6', bl: 1, fc: '#1a237e' };
                }
              }
            }

            return sheet;
          });
          setSheets(prepared);
          setKey((k) => k + 1);
          // 마운트 직후 1초간 FortuneSheet 가 쏘는 onChange 무시
          ignoreUntilRef.current = Date.now() + 1000;
          // 편집 전에도 sheets 참조 가능하도록 부모에 즉시 전달
          onReady?.(prepared);
        } else {
          setError('시트 데이터를 추출할 수 없습니다.');
        }
      });
    } catch (err) {
      setError(`xlsx 파싱 실패: ${err.message}`);
    }
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
