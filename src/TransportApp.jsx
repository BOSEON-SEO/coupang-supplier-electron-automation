import React, { useEffect, useState, useCallback } from 'react';
import TransportView from './components/TransportView';

/**
 * 운송 분배 창 루트.
 *
 * confirmation.xlsx 의 "밀크런" 행을 물류센터별로 그룹핑해 보여주고,
 * 각 그룹별 (출고지/박스/중량/팔레트) 를 사용자가 지정 → transport.json 에 저장.
 *
 * 창이 열려있는 동안 메인창의 해당 job PO/발주확정서 탭은 편집 잠금.
 */
export default function TransportApp({ params }) {
  const { date, vendor } = params;
  const sequence = Number(params.sequence);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groups, setGroups] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [originList, setOriginList] = useState([]);
  const [rentalList, setRentalList] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.transport) {
      setError('transport API 가 초기화되지 않았습니다.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const res = await api.transport.load(date, vendor, sequence);
    setLoading(false);
    if (!res?.success) {
      setError(res?.error || '로드 실패');
      return;
    }
    setGroups(res.groups || []);
    setDefaults(res.defaults || {});
    setOriginList(res.originList || []);
    setRentalList(res.rentalList || []);
  }, [date, vendor, sequence]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback(async (assignments) => {
    const api = window.electronAPI;
    if (!api?.transport) return;
    setSaving(true);
    const res = await api.transport.save(date, vendor, sequence, assignments);
    setSaving(false);
    if (!res?.success) {
      setError(res?.error || '저장 실패');
      return;
    }
    await api.transport.close();
  }, [date, vendor, sequence]);

  const handleCancel = useCallback(async () => {
    const api = window.electronAPI;
    if (api?.transport) await api.transport.close();
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
          <span>🚚 운송 분배</span>
          <span className="stock-adjust-header__sep">·</span>
          <span>{vendor}</span>
          <span className="stock-adjust-header__sep">·</span>
          <span>{date}</span>
          <span className="stock-adjust-header__sep">·</span>
          <span>{sequence}차</span>
        </div>
      </header>

      {loading && <div className="stock-adjust-loading">발주확정서 읽는 중…</div>}
      {error && <div className="stock-adjust-error">{error}</div>}

      {!loading && !error && (
        <TransportView
          groups={groups}
          defaults={defaults}
          originList={originList}
          rentalList={rentalList}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
