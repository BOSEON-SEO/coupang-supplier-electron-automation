import React, { useState } from 'react';
import EditableTable from './EditableTable';
import LogPanel from './LogPanel';

/**
 * 작업 뷰 탭
 * - Editable Table: PO 데이터 표시 및 납품여부 수정
 * - 로그 패널: Python subprocess stdout/stderr 스트리밍
 * - 다운로드 버튼: 쿠팡 양식 / 통합 양식
 */

// 기본 컬럼 정의 (Phase 1 스켈레톤)
const DEFAULT_COLUMNS = [
  { key: 'poNumber', label: 'PO 번호', editable: false },
  { key: 'skuId', label: 'SKU ID', editable: false },
  { key: 'productName', label: '상품명', editable: false },
  { key: 'quantity', label: '수량', editable: false },
  { key: 'deliveryStatus', label: '납품여부', editable: true },
];

// 샘플 데이터 (개발 확인용)
const SAMPLE_DATA = [
  { poNumber: 'PO-2026-001', skuId: 'SKU-12345', productName: '샘플 상품 A', quantity: 100, deliveryStatus: '보냄' },
  { poNumber: 'PO-2026-001', skuId: 'SKU-12346', productName: '샘플 상품 B', quantity: 50, deliveryStatus: '반려' },
  { poNumber: 'PO-2026-002', skuId: 'SKU-12347', productName: '샘플 상품 C', quantity: 200, deliveryStatus: '' },
];

export default function WorkView() {
  const [rows, setRows] = useState(SAMPLE_DATA);
  const [logs, setLogs] = useState([
    { time: new Date().toISOString(), level: 'info', message: '작업 뷰가 초기화되었습니다.' },
  ]);

  const handleCellChange = (rowIndex, columnKey, newValue) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [columnKey]: newValue };
      return updated;
    });
  };

  const handleDownloadCoupang = () => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toISOString(), level: 'info', message: '쿠팡 양식 다운로드 요청...' },
    ]);
    // TODO: Phase 1에서 xlsx 라이브러리로 쿠팡 양식 생성
  };

  const handleDownloadIntegrated = () => {
    setLogs((prev) => [
      ...prev,
      { time: new Date().toISOString(), level: 'info', message: '통합 양식 다운로드 요청...' },
    ]);
    // TODO: Phase 1에서 xlsx 라이브러리로 통합 양식 생성
  };

  return (
    <div className="workview-container">
      <div className="workview-toolbar">
        <button className="btn btn--primary" onClick={handleDownloadCoupang} type="button">
          📥 쿠팡 양식 다운로드
        </button>
        <button className="btn btn--secondary" onClick={handleDownloadIntegrated} type="button">
          📥 통합 양식 다운로드
        </button>
      </div>

      <div className="workview-table-section">
        <EditableTable
          columns={DEFAULT_COLUMNS}
          rows={rows}
          onCellChange={handleCellChange}
        />
      </div>

      <div className="workview-log-section">
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}
