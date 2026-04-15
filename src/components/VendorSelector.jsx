import React, { useEffect, useState } from 'react';

/**
 * 벤더 선택 드롭다운 + 벤더 추가 모달
 *
 * Props:
 *   - value: 현재 선택된 벤더 id
 *   - onChange: (vendorId) => void
 *
 * vendors.json 스키마:
 *   { schemaVersion: 1, vendors: [{ id, name, shippingSeq? }, ...] }
 */
export default function VendorSelector({ value, onChange }) {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const api = window.electronAPI;
      if (!api) { setLoading(false); return; }
      const data = await api.loadVendors();
      if (cancelled) return;
      setVendors(data?.vendors ?? []);
      setLoading(false);
      // 최초 벤더가 있고 선택값이 없으면 첫 벤더 선택
      if (!value && data?.vendors?.length) {
        onChange(data.vendors[0].id);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    setError('');
    const id = newId.trim().toLowerCase();
    const name = newName.trim() || id;
    if (!/^[a-z0-9_]{2,20}$/.test(id)) {
      setError('id는 영소문자/숫자/밑줄 2-20자 (파일명에 쓰임)');
      return;
    }
    if (vendors.some((v) => v.id === id)) {
      setError('이미 존재하는 벤더 id');
      return;
    }
    const next = {
      schemaVersion: 1,
      vendors: [...vendors, { id, name }],
    };
    const res = await window.electronAPI.saveVendors(next);
    if (!res?.success) {
      setError(`저장 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    setVendors(next.vendors);
    setShowAdd(false);
    setNewId('');
    setNewName('');
    onChange(id);
  };

  return (
    <div className="vendor-selector">
      <label className="vendor-selector__label" htmlFor="vendor-select">벤더</label>
      <select
        id="vendor-select"
        className="vendor-selector__select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        {vendors.length === 0 && (
          <option value="">(등록된 벤더 없음)</option>
        )}
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>{v.name} ({v.id})</option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn--secondary vendor-selector__add"
        onClick={() => setShowAdd(true)}
      >
        + 벤더 추가
      </button>

      {showAdd && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2 className="modal__title">벤더 추가</h2>
            <div className="modal__body">
              <div className="form-row">
                <label htmlFor="vendor-new-id">ID (파일명에 사용)</label>
                <input
                  id="vendor-new-id"
                  type="text"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="basic"
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label htmlFor="vendor-new-name">표시 이름</label>
                <input
                  id="vendor-new-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="베이직"
                />
              </div>
              {error && <div className="modal__error">{error}</div>}
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={() => { setShowAdd(false); setError(''); }}>
                취소
              </button>
              <button type="button" className="btn btn--primary" onClick={handleAdd}>
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
