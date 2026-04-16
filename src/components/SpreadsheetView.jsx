import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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
 */
export default function SpreadsheetView({ xlsxBuffer, fileName, onChange, readOnly }) {
  const [sheets, setSheets] = useState(null);
  const [error, setError] = useState(null);
  const [key, setKey] = useState(0);
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
        } else {
          setError('시트 데이터를 추출할 수 없습니다.');
        }
      });
    } catch (err) {
      setError(`xlsx 파싱 실패: ${err.message}`);
    }
  }, [xlsxBuffer, fileName]);

  const handleChange = useCallback(
    (data) => {
      if (Date.now() < ignoreUntilRef.current) return;
      onChange?.(data);
    },
    [onChange],
  );

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
}
