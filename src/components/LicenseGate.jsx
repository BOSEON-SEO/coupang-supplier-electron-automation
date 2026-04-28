import React, { useState, useCallback } from 'react';

/**
 * 라이선스 입력 / 만료 안내 화면.
 *
 * App 의 license.status 가 unlicensed / invalid / expired 일 때 메인 앱 대신
 * 이 화면을 띄움. 검증 성공하면 license-changed 이벤트로 App 의 state 가
 * 갱신되어 자동으로 메인 앱이 마운트됨.
 *
 * 만료 케이스: 캐시된 (id, serial) 로 재검증만 시도하는 옵션도 제공.
 */
export default function LicenseGate({ license, onActivated }) {
  const cachedId = license?.id || '';
  const status = license?.status || 'unlicensed';
  const lastError = license?.lastError || null;

  const [id, setId] = useState(cachedId);
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleActivate = useCallback(async (e) => {
    if (e) e.preventDefault();
    const safeId = id.trim();
    const safeSerial = serial.trim();
    if (!safeId || !safeSerial) {
      setError('발급 ID 와 시리얼을 모두 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await window.electronAPI?.license?.activate(safeId, safeSerial);
      if (!res?.success) {
        setError(res?.error || '검증 실패');
      } else if (typeof onActivated === 'function') {
        onActivated(res.license);
      }
    } catch (err) {
      setError(`검증 호출 오류: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [id, serial, onActivated]);

  const handleReverify = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await window.electronAPI?.license?.reverify();
      if (!res?.success) {
        setError(res?.error || '재검증 실패');
      } else if (typeof onActivated === 'function') {
        onActivated(res.license);
      }
    } catch (err) {
      setError(`재검증 오류: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [onActivated]);

  const handleClear = useCallback(async () => {
    if (!window.confirm('저장된 라이선스를 지우고 처음부터 다시 입력하시겠습니까?')) return;
    setBusy(true);
    setError('');
    try {
      await window.electronAPI?.license?.clear();
      setId('');
      setSerial('');
    } finally {
      setBusy(false);
    }
  }, []);

  const headline = (() => {
    switch (status) {
      case 'expired': return '라이선스가 만료되었습니다';
      case 'invalid': return '라이선스 검증에 실패했습니다';
      default:        return '라이선스 인증이 필요합니다';
    }
  })();

  const subline = (() => {
    switch (status) {
      case 'expired':
        return '관리자에게 문의해 라이선스를 갱신한 뒤, 같은 시리얼로 재인증하거나 새 시리얼을 입력하세요.';
      case 'invalid':
        return lastError || '시리얼 또는 ID 가 올바르지 않거나, 서버 응답이 유효하지 않습니다.';
      default:
        return '발급받으신 ID 와 시리얼을 입력하세요. 첫 인증 후엔 로컬에 캐시되어 자동 검증됩니다.';
    }
  })();

  const showReverify = status === 'expired' && cachedId;

  return (
    <div className="license-gate">
      <div className="license-gate__card">
        <h1 className="license-gate__title">🔐 {headline}</h1>
        <p className="license-gate__sub">{subline}</p>

        <form className="license-gate__form" onSubmit={handleActivate}>
          <label className="license-gate__field">
            <span>발급 ID</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="예: tbnws-001"
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="license-gate__field">
            <span>시리얼</span>
            <input
              type="text"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="예: TBNWS-XXXX-YYYY-ZZZZ"
              disabled={busy}
            />
          </label>

          {error && <div className="license-gate__error">{error}</div>}

          <div className="license-gate__actions">
            {showReverify && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={handleReverify}
                disabled={busy}
              >
                ⟳ 캐시 시리얼로 재검증
              </button>
            )}
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
            >
              {busy ? '검증 중…' : '활성화'}
            </button>
          </div>
        </form>

        {cachedId && (
          <div className="license-gate__footer">
            <span className="license-gate__footer-text">
              저장된 라이선스: <code>{cachedId}</code> · {license?.serial || ''}
            </span>
            <button
              type="button"
              className="license-gate__clear"
              onClick={handleClear}
              disabled={busy}
            >
              저장된 라이선스 지우기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
