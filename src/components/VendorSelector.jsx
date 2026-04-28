import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * 벤더 선택 드롭다운 + 통합 관리 모달
 *
 * 상단 바:
 *   - 드롭다운 (선택)
 *   - "⚙ 관리" 버튼 → 관리 모달 오픈
 *
 * 관리 모달 (2-pane):
 *   왼쪽: 벤더 리스트 + "+ 새 벤더" 버튼
 *   오른쪽: 선택된 벤더 편집 폼 (이름, ID, PW, 저장/삭제)
 *   ※ shippingSeq 등 밀크런 관련 설정은 별도 "밀크런 관리" 메뉴에서 처리
 *
 * 자격증명은 Electron safeStorage로 암호화 저장.
 * 평문 password는 Renderer에 절대 반환되지 않는다 (hasPassword boolean만).
 *
 * Props:
 *   - value: 현재 선택된 벤더 id
 *   - onChange: (vendorId) => void
 */

const EMPTY_DRAFT = { id: '', name: '', newId: '', newPw: '' };
const LAST_VENDOR_KEY = 'coupang-supplier:lastVendor';

export default function VendorSelector({ value, onChange }) {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMgmt, setShowMgmt] = useState(false);

  // 관리 모달 상태
  const [selectedId, setSelectedId] = useState(null); // null 이면 "새 벤더 추가" 모드
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [credStatus, setCredStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadVendorList = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return [];
    const data = await api.loadVendors();
    const list = data?.vendors ?? [];
    setVendors(list);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadVendorList();
      if (cancelled) return;
      setLoading(false);

      // 벤더 0개 → 관리 모달 자동 오픈 (새 벤더 추가 모드)
      if (list.length === 0) {
        setSelectedId(null);
        setShowMgmt(true);
        return;
      }

      // 이미 외부에서 벤더가 선택되어 있으면 그대로
      if (value) return;

      // 마지막 선택 벤더 복원, 없거나 삭제됐으면 첫 벤더
      let restored = null;
      try {
        const last = window.localStorage?.getItem(LAST_VENDOR_KEY);
        if (last && list.some((v) => v.id === last)) restored = last;
      } catch {
        // localStorage 접근 불가 — 무시
      }
      onChange(restored ?? list[0].id);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택 벤더 변경 시 localStorage에 저장
  useEffect(() => {
    if (!value) return;
    try {
      window.localStorage?.setItem(LAST_VENDOR_KEY, value);
    } catch {
      // 무시
    }
  }, [value]);

  // 관리 모달 열림/닫힘 시 WCV 숨김/표시 — WCV는 native overlay라
  // 그렇게 하지 않으면 React 모달이 WCV에 가려져 조작 불가
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api) return;
    api.setVisible(!showMgmt);
  }, [showMgmt]);

  // 관리 모달: 벤더 선택 시 드래프트/자격증명 로드
  useEffect(() => {
    if (!showMgmt) return;
    setError(''); setInfo('');

    if (selectedId === null) {
      setDraft(EMPTY_DRAFT);
      setCredStatus(null);
      return;
    }

    const target = vendors.find((v) => v.id === selectedId);
    if (!target) return;

    setDraft({
      id: target.id,
      name: target.name ?? '',
      newId: '',
      newPw: '',
    });

    (async () => {
      const api = window.electronAPI;
      const res = await api.checkCredentials(selectedId);
      setCredStatus(res);
    })();
  }, [showMgmt, selectedId, vendors]);

  const handleSave = async () => {
    setError(''); setInfo('');
    const api = window.electronAPI;

    const id = (selectedId ?? draft.id).trim().toLowerCase();
    const name = draft.name.trim() || id;

    if (selectedId === null) {
      if (!/^[a-z0-9_]{2,20}$/.test(id)) {
        setError('id는 영소문자/숫자/밑줄 2-20자');
        return;
      }
      if (vendors.some((v) => v.id === id)) {
        setError('이미 존재하는 벤더 id');
        return;
      }
    }

    setBusy(true);
    try {
      const nextVendors = selectedId === null
        ? [...vendors, { id, name }]
        : vendors.map((v) => (v.id === id ? { ...v, name } : v));

      const saveRes = await api.saveVendors({ schemaVersion: 1, vendors: nextVendors });
      if (!saveRes?.success) {
        setError(`벤더 저장 실패: ${saveRes?.error ?? 'unknown'}`);
        return;
      }

      const hasNewCred = draft.newId.trim().length > 0 || draft.newPw.length > 0;
      if (hasNewCred) {
        const credRes = await api.saveCredentials(
          id,
          draft.newId.trim() || null,
          draft.newPw || null,
        );
        if (!credRes?.success) {
          setError(`자격증명 저장 실패: ${credRes?.error ?? 'unknown'}`);
          return;
        }
      }

      setVendors(nextVendors);
      if (selectedId === null) {
        setSelectedId(id);
        onChange(id);
      }
      setDraft((d) => ({ ...d, id, newId: '', newPw: '' }));
      const fresh = await api.checkCredentials(id);
      setCredStatus(fresh);
      setInfo(selectedId === null ? '새 벤더가 추가되었습니다.' : '저장되었습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVendor = async () => {
    if (selectedId === null) return;
    if (!window.confirm(`벤더 '${selectedId}'를 삭제하시겠습니까?\n저장된 자격증명도 함께 제거됩니다.`)) return;

    setBusy(true); setError(''); setInfo('');
    try {
      const api = window.electronAPI;
      const nextVendors = vendors.filter((v) => v.id !== selectedId);
      const res = await api.saveVendors({ schemaVersion: 1, vendors: nextVendors });
      if (!res?.success) {
        setError(`삭제 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      await api.deleteCredentials(selectedId);
      setVendors(nextVendors);

      if (value === selectedId) {
        onChange(nextVendors[0]?.id ?? '');
      }
      setSelectedId(null);
      setInfo('삭제되었습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCredentials = async () => {
    if (selectedId === null) return;
    if (!window.confirm(`'${selectedId}'의 저장된 자격증명을 삭제하시겠습니까?`)) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const api = window.electronAPI;
      const res = await api.deleteCredentials(selectedId);
      if (!res?.success) {
        setError(`자격증명 삭제 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      const fresh = await api.checkCredentials(selectedId);
      setCredStatus(fresh);
      setInfo('자격증명이 삭제되었습니다.');
    } finally {
      setBusy(false);
    }
  };

  const closeMgmt = () => {
    setShowMgmt(false);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setCredStatus(null);
    setError(''); setInfo('');
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
        onClick={() => setShowMgmt(true)}
      >
        ⚙ 관리
      </button>

      {showMgmt && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal modal--vendor-mgmt">
            <h2 className="modal__title">벤더 관리</h2>
            <div className="vendor-mgmt__body">
              <aside className="vendor-mgmt__list">
                <button
                  type="button"
                  className={`vendor-mgmt__list-item vendor-mgmt__list-item--new${selectedId === null ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(null)}
                >
                  + 새 벤더
                </button>
                <div className="vendor-mgmt__list-divider" />
                {vendors.length === 0 && (
                  <div className="vendor-mgmt__list-empty">
                    등록된 벤더가 없습니다.<br />
                    오른쪽에서 새 벤더를 추가하세요.
                  </div>
                )}
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`vendor-mgmt__list-item${selectedId === v.id ? ' is-active' : ''}`}
                    onClick={() => setSelectedId(v.id)}
                  >
                    <span className="vendor-mgmt__list-name">{v.name}</span>
                    <span className="vendor-mgmt__list-id">{v.id}</span>
                  </button>
                ))}
              </aside>

              <section className="vendor-mgmt__editor">
                <div className="form-row">
                  <label htmlFor="vm-id">ID (파일명/환경변수 키)</label>
                  <input
                    id="vm-id"
                    type="text"
                    value={selectedId ?? draft.id}
                    onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
                    disabled={selectedId !== null}
                    placeholder="basic"
                    autoFocus={selectedId === null}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="vm-name">표시 이름</label>
                  <input
                    id="vm-name"
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="기본"
                  />
                </div>
                <div className="vendor-mgmt__cred-section">
                  <div className="vendor-mgmt__cred-header">
                    <span>쿠팡 서플라이어 자격증명</span>
                    {credStatus && (
                      <span className="vendor-mgmt__cred-status">
                        {credStatus.hasId && credStatus.hasPassword ? (
                          <>
                            <span className="cred-badge cred-badge--ok">✓ 저장됨</span>
                            <span className="cred-source">
                              ({credStatus.source?.password === 'env' ? '환경변수' : '암호화 저장소'})
                            </span>
                          </>
                        ) : credStatus.hasId || credStatus.hasPassword ? (
                          <span className="cred-badge cred-badge--partial">◐ 일부만 저장됨</span>
                        ) : (
                          <span className="cred-badge cred-badge--none">○ 미설정</span>
                        )}
                      </span>
                    )}
                  </div>
                  {credStatus?.id && (
                    <div className="vendor-mgmt__cred-current">
                      저장된 ID: <code>{credStatus.id}</code>
                    </div>
                  )}
                  {credStatus && !credStatus.encryptionAvailable && (
                    <div className="modal__error">
                      OS 암호화(safeStorage)를 사용할 수 없습니다. 환경변수로만 관리 가능합니다.
                    </div>
                  )}
                  <div className="form-row">
                    <label htmlFor="vm-newid">
                      {credStatus?.hasId ? 'ID 변경 (비워두면 유지)' : 'ID'}
                    </label>
                    <input
                      id="vm-newid"
                      type="text"
                      autoComplete="off"
                      value={draft.newId}
                      onChange={(e) => setDraft((d) => ({ ...d, newId: e.target.value }))}
                      placeholder="supplier@example.com"
                    />
                  </div>
                  <div className="form-row">
                    <label htmlFor="vm-newpw">
                      {credStatus?.hasPassword ? 'PW 변경 (비워두면 유지)' : 'PW'}
                    </label>
                    <input
                      id="vm-newpw"
                      type="password"
                      autoComplete="new-password"
                      value={draft.newPw}
                      onChange={(e) => setDraft((d) => ({ ...d, newPw: e.target.value }))}
                      placeholder="••••••••"
                    />
                  </div>
                  {selectedId !== null && (credStatus?.hasId || credStatus?.hasPassword) && (
                    <button
                      type="button"
                      className="btn btn--secondary vendor-mgmt__cred-clear"
                      onClick={handleDeleteCredentials}
                      disabled={busy}
                    >
                      저장된 자격증명 삭제
                    </button>
                  )}
                </div>

                {error && <div className="modal__error">{error}</div>}
                {info && <div className="modal__info">{info}</div>}
              </section>
            </div>

            <div className="modal__footer vendor-mgmt__footer">
              {selectedId !== null && (
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={handleDeleteVendor}
                  disabled={busy}
                >
                  벤더 삭제
                </button>
              )}
              <div className="vendor-mgmt__footer-spacer" />
              <button
                type="button"
                className="btn btn--secondary"
                onClick={closeMgmt}
                disabled={busy}
              >
                닫기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSave}
                disabled={busy}
              >
                {selectedId === null ? '추가' : '저장'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
