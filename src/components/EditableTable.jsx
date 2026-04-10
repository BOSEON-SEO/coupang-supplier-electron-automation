import React from 'react';

/**
 * Editable Table 컴포넌트
 *
 * @param {{
 *   columns: { key: string, label: string, editable: boolean }[],
 *   rows: Record<string, any>[],
 *   onCellChange: (rowIndex: number, columnKey: string, newValue: string) => void
 * }} props
 *
 * - editable=true 컬럼: 셀 클릭 시 inline 편집 가능
 * - editable=false 컬럼: 읽기 전용 텍스트
 */
export default function EditableTable({ columns, rows, onCellChange }) {
  const handleChange = (rowIndex, columnKey, e) => {
    onCellChange(rowIndex, columnKey, e.target.value);
  };

  return (
    <div className="editable-table-wrapper">
      <table className="editable-table">
        <thead>
          <tr>
            <th className="editable-table__th editable-table__row-num">#</th>
            {columns.map((col) => (
              <th key={col.key} className="editable-table__th">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + 1}
                className="editable-table__empty"
              >
                데이터가 없습니다. PO 다운로드를 실행해주세요.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="editable-table__row">
                <td className="editable-table__td editable-table__row-num">
                  {rowIndex + 1}
                </td>
                {columns.map((col) => (
                  <td key={col.key} className="editable-table__td">
                    {col.editable ? (
                      <input
                        type="text"
                        className="editable-table__input"
                        value={row[col.key] ?? ''}
                        onChange={(e) => handleChange(rowIndex, col.key, e)}
                      />
                    ) : (
                      <span className="editable-table__text">
                        {row[col.key] ?? ''}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
