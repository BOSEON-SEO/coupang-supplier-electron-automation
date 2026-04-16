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
          const prepared = exportJson.sheets.map((s, i) => ({
            ...s,
            order: i,
          }));
          setSheets(prepared);
          setKey((k) => k + 1);
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
        showSheetTabs={sheets.length > 1}
        allowEdit={!readOnly}
        lang="ko"
      />
    </div>
  );
}
