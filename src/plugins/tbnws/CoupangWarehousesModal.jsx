import React, { useMemo, useState } from 'react';

/**
 * 쿠팡 창고 관리 모달.
 *
 * 플러그인 설정 → 상세 → "쿠팡 창고 관리" 버튼으로 진입.
 * 내부에서 로컬 state 로 CRUD → "적용" 시 onApply 로 상위에 배열 전달.
 * 저장은 상위(PluginDetailModal)의 "저장" 버튼에서 일괄 처리.
 */

function cleanRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && String(r.centerName || '').trim())
    .map((r) => ({
      seq: Number(r.seq) || 0,
      centerName: String(r.centerName).trim(),
      contact: String(r.contact || '').trim(),
      contact2: r.contact2 && String(r.contact2).trim() ? String(r.contact2).trim() : null,
      address: String(r.address || '').trim(),
    }));
}

export function CoupangWarehousesModal({ rows: initialRows, onApply, onClose }) {
  const [rows, setRows] = useState(() => (Array.isArray(initialRows) ? initialRows.map((r) => ({ ...r })) : []));
  const [filter, setFilter] = useState('');

  const nextSeq = useMemo(
    () => rows.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0) + 1,
    [rows],
  );

  const update = (seq, field, value) => {
    setRows((prev) => prev.map((r) => (r.seq === seq ? { ...r, [field]: value } : r)));
  };
  const add = () => {
    setRows((prev) => [
      ...prev,
      { seq: nextSeq, centerName: '', contact: '', contact2: null, address: '' },
    ]);
  };
  const remove = (seq) => {
    setRows((prev) => prev.filter((r) => r.seq !== seq));
  };

  const filtered = useMemo(() => {
    const q = filter.trim();
    if (!q) return rows;
    return rows.filter((r) => String(r.centerName || '').includes(q));
  }, [rows, filter]);

  const apply = () => {
    const clean = cleanRows(rows);
    onApply(clean);
    onClose();
  };

  return (
    <div className="eflex-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="eflex-overlay__card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 960, maxWidth: '95vw' }}
      >
        <header className="eflex-overlay__header">
          <h3 className="eflex-overlay__title">
            🏭 쿠팡 창고 관리
            <span className="eflex-overlay__count">· {rows.length}건</span>
          </h3>
          <button type="button" className="eflex-overlay__close" onClick={onClose}>×</button>
        </header>

        <div className="eflex-overlay__body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input
              type="text"
              placeholder="센터명 검색…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 220 }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {filter ? `${filtered.length}/${rows.length} 건` : ''}
            </span>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn--secondary btn--sm" onClick={add}>
              ＋ 행 추가
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="eflex-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 60 }} className="num">seq</th>
                  <th style={{ minWidth: 140 }}>센터명 *</th>
                  <th style={{ minWidth: 140 }}>연락처1</th>
                  <th style={{ minWidth: 140 }}>연락처2</th>
                  <th style={{ minWidth: 300 }}>주소</th>
                  <th style={{ minWidth: 48 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 16 }}>
                      {rows.length === 0 ? '등록된 창고가 없습니다. ＋ 행 추가 버튼으로 추가하세요.' : '검색 결과가 없습니다.'}
                    </td>
                  </tr>
                ) : filtered.map((r) => (
                  <tr key={r.seq}>
                    <td className="num"><code>{r.seq}</code></td>
                    <td>
                      <input
                        type="text"
                        value={r.centerName || ''}
                        onChange={(e) => update(r.seq, 'centerName', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={r.contact || ''}
                        onChange={(e) => update(r.seq, 'contact', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={r.contact2 || ''}
                        onChange={(e) => update(r.seq, 'contact2', e.target.value || null)}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={r.address || ''}
                        onChange={(e) => update(r.seq, 'address', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--secondary btn--xs"
                        onClick={() => remove(r.seq)}
                        title="삭제"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10 }}>
            센터명은 <b>po-tbnws.xlsx의 '물류센터' 값과 exact match</b> 되어야 출고예정 모달에서 연락처/주소가 자동 매칭됩니다.
            {' '}'적용' 후 상세 모달의 <b>저장</b> 버튼까지 눌러야 실제로 저장됩니다.
          </div>
        </div>

        <footer className="eflex-overlay__footer">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={apply}>
            적용 ({cleanRows(rows).length}건)
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * 플러그인 설정 폼 안에서 사용할 트리거 버튼 + 모달 컨테이너.
 * settingsSchema 의 `type: 'custom'` render 함수가 이 컴포넌트를 반환하면 됨.
 */
export function CoupangWarehousesManageButton({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(value) ? value : [];
  return (
    <>
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={() => setOpen(true)}
      >
        🏭 쿠팡 창고 관리 ({list.length}건)
      </button>
      {open && (
        <CoupangWarehousesModal
          rows={list}
          onApply={(next) => onChange(next)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
