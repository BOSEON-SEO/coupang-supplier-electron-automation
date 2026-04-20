import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * 범용 2-pane 목록 관리 모달 (벤더관리 모달 패턴 재사용).
 *
 * 왼쪽: 항목 리스트 + "+ 새 항목"
 * 오른쪽: 선택된 항목의 필드 편집 폼
 *
 * Props:
 *   - title: string
 *   - items: Array<object>
 *   - fields: Array<{ key, label, placeholder?, required?, type? }>
 *   - idField?: string   — 유일성 검사에 쓰는 key (default: fields[0].key)
 *   - primaryField?: string   — 좌측 리스트 메인 표시 (default: idField)
 *   - secondaryField?: string — 좌측 리스트 보조 표시 (default: fields[1].key)
 *   - onSave: (items) => Promise<void>|void
 *   - onClose: () => void
 */
export default function ListManagerModal({
  title, items: initialItems, fields,
  idField, primaryField, secondaryField,
  onSave, onClose,
}) {
  const [items, setItems] = useState(initialItems || []);
  const [selectedIdx, setSelectedIdx] = useState(items.length > 0 ? 0 : -1); // -1 = 새 항목 모드
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const idKey = idField || fields[0]?.key || 'id';
  const primaryKey = primaryField || idKey;
  const secondaryKey = secondaryField || (fields[1]?.key !== idKey ? fields[1]?.key : fields[2]?.key);
  const idLabel = fields.find((f) => f.key === idKey)?.label || idKey;

  // 선택 변경 시 draft 세팅
  useEffect(() => {
    setError(''); setInfo('');
    if (selectedIdx === -1) {
      const empty = {};
      for (const f of fields) empty[f.key] = '';
      setDraft(empty);
    } else {
      setDraft({ ...(items[selectedIdx] || {}) });
    }
  }, [selectedIdx, items, fields]);

  const applyDraftToItems = useCallback(() => {
    const id = String(draft[idKey] ?? '').trim();
    if (!id) {
      setError(`${idLabel} 은(는) 필수입니다.`);
      return null;
    }
    // 중복 체크: 새 항목일 때 혹은 id 가 바뀐 경우
    const dupIdx = items.findIndex((it, i) =>
      String(it[idKey] ?? '').trim() === id && i !== selectedIdx);
    if (dupIdx >= 0) {
      setError(`이미 존재하는 ${idLabel}: ${id}`);
      return null;
    }
    const clean = {};
    for (const f of fields) clean[f.key] = String(draft[f.key] ?? '').trim();

    if (selectedIdx === -1) {
      return [...items, clean];
    }
    const next = items.slice();
    next[selectedIdx] = clean;
    return next;
  }, [draft, items, fields, idKey, idLabel, selectedIdx]);

  const handleApplyCurrent = () => {
    setError(''); setInfo('');
    const next = applyDraftToItems();
    if (!next) return;
    setItems(next);
    if (selectedIdx === -1) {
      setSelectedIdx(next.length - 1);
    }
    setInfo('반영되었습니다. "저장" 을 눌러야 설정 파일에 기록됩니다.');
  };

  const handleDelete = () => {
    if (selectedIdx === -1) return;
    const target = items[selectedIdx];
    if (!window.confirm(`'${target?.[idKey] ?? ''}' 을(를) 삭제하시겠습니까?`)) return;
    const next = items.filter((_, i) => i !== selectedIdx);
    setItems(next);
    setSelectedIdx(next.length > 0 ? 0 : -1);
    setInfo('삭제되었습니다. "저장" 을 눌러야 설정 파일에 반영됩니다.');
  };

  const handleSaveAll = async () => {
    setBusy(true); setError('');
    try {
      await onSave?.(items);
      onClose?.();
    } catch (err) {
      setError(`저장 실패: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal modal--vendor-mgmt">
        <h2 className="modal__title">{title}</h2>
        <div className="vendor-mgmt__body">
          <aside className="vendor-mgmt__list">
            <button
              type="button"
              className={`vendor-mgmt__list-item vendor-mgmt__list-item--new${selectedIdx === -1 ? ' is-active' : ''}`}
              onClick={() => setSelectedIdx(-1)}
            >
              + 새 항목
            </button>
            <div className="vendor-mgmt__list-divider" />
            {items.length === 0 && (
              <div className="vendor-mgmt__list-empty">
                항목이 없습니다.<br />오른쪽에서 새로 추가하세요.
              </div>
            )}
            {items.map((it, i) => (
              <button
                key={`${it[idKey] ?? ''}-${i}`}
                type="button"
                className={`vendor-mgmt__list-item${selectedIdx === i ? ' is-active' : ''}`}
                onClick={() => setSelectedIdx(i)}
              >
                <span className="vendor-mgmt__list-name">{it[primaryKey] || '(이름 없음)'}</span>
                {secondaryKey && it[secondaryKey] && (
                  <span className="vendor-mgmt__list-id">{it[secondaryKey]}</span>
                )}
              </button>
            ))}
          </aside>

          <section className="vendor-mgmt__editor">
            {fields.map((f) => (
              <div className="form-row" key={f.key}>
                <label htmlFor={`lm-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
                <input
                  id={`lm-${f.key}`}
                  type={f.type || 'text'}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                />
              </div>
            ))}
            {error && <div className="modal__error">{error}</div>}
            {info && <div className="modal__info">{info}</div>}
          </section>
        </div>

        <div className="modal__footer vendor-mgmt__footer">
          {selectedIdx !== -1 && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={handleDelete}
              disabled={busy}
            >
              삭제
            </button>
          )}
          <div className="vendor-mgmt__footer-spacer" />
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onClose}
            disabled={busy}
          >
            닫기
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleApplyCurrent}
            disabled={busy}
          >
            {selectedIdx === -1 ? '항목 추가' : '항목 변경 반영'}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSaveAll}
            disabled={busy}
          >
            💾 저장
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
