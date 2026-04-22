import React, { useEffect, useState, useCallback } from 'react';
import StockAdjustView from './components/StockAdjustView';
import FindBar from './components/FindBar';

/**
 * 재고조정 창 루트.
 *
 * URL hash 에서 params 를 받아 po.xlsx 를 main process 가 읽어 SKU별로 그룹핑해
 * 돌려주고, 사용자가 각 발주 행별 출고수량(=확정수량) 을 지정하면 저장한다.
 *
 * 창이 열려있는 동안 메인창의 해당 job PO / 발주확정서 탭은 read-only.
 */
export default function StockAdjustApp({ params }) {
  const { date, vendor } = params;
  const sequence = Number(params.sequence);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.stockAdjust) {
      setError('stockAdjust API 가 초기화되지 않았습니다.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const res = await api.stockAdjust.load(date, vendor, sequence);
    setLoading(false);
    if (!res?.success) {
      setError(res?.error || '로드 실패');
      return;
    }
    setGroups(res.groups || []);
  }, [date, vendor, sequence]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async (patches) => {
    const api = window.electronAPI;
    if (!api?.stockAdjust) return;
    setSaving(true);
    const res = await api.stockAdjust.save(date, vendor, sequence, patches);
    setSaving(false);
    if (!res?.success) {
      setError(res?.error || '저장 실패');
      return;
    }
    // 저장 후 창은 유지 — 사용자가 직접 닫거나 취소로 나감.
  }, [date, vendor, sequence]);

  const handleCancel = useCallback(async () => {
    const api = window.electronAPI;
    if (api?.stockAdjust) await api.stockAdjust.close();
  }, []);

  if (!date || !vendor || !Number.isInteger(sequence) || sequence < 1) {
    return (
      <div className="stock-adjust-error">
        <p>잘못된 진입 파라미터입니다.</p>
        <pre>{JSON.stringify(params, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div className="stock-adjust-root">
      <header className="stock-adjust-header">
        <div className="stock-adjust-header__title">
          <span>📦 재고조정</span>
          <span className="stock-adjust-header__sep">·</span>
          <span>{vendor}</span>
          <span className="stock-adjust-header__sep">·</span>
          <span>{date}</span>
          <span className="stock-adjust-header__sep">·</span>
          <span>{sequence}차</span>
        </div>
      </header>

      {loading && <div className="stock-adjust-loading">PO 읽는 중…</div>}
      {error && <div className="stock-adjust-error">{error}</div>}

      {!loading && !error && (
        <StockAdjustView
          groups={groups}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
      <FindBar />
    </div>
  );
}
