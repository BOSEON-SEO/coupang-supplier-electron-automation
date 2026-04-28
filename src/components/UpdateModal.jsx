import React, { useEffect, useState, useCallback } from 'react';

/**
 * 자동 업데이트 모달 — main 의 update-service 가 brodcast 하는 status 를
 * 구독해 다음 단계에 모달을 띄운다:
 *   - available  → 새 버전 안내 + 릴리즈 노트 + [지금 설치 / 나중에]
 *   - downloading → 진행률
 *   - downloaded → [지금 재시작 / 나중에] (앱 종료 시 자동 설치되진 않음 —
 *                  사용자가 명시적으로 install 호출 필요)
 *   - error      → 메시지 + 닫기
 *   - 그 외      → 숨김
 *
 * "나중에" 는 세션 한정 dismiss — 다음 부팅 시 다시 자동 체크되면 또 뜬다.
 */

export default function UpdateModal() {
  const [status, setStatus] = useState({ state: 'idle' });
  const [dismissedVersion, setDismissedVersion] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cur = await window.electronAPI?.update?.get?.();
        if (!cancelled && cur) setStatus(cur);
      } catch (_) { /* 무시 */ }
    })();
    const off = window.electronAPI?.update?.onStatus?.((s) => setStatus(s || { state: 'idle' }));
    return () => {
      cancelled = true;
      if (typeof off === 'function') off();
    };
  }, []);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    try { await window.electronAPI?.update?.download?.(); }
    finally { setBusy(false); }
  }, []);

  const handleInstall = useCallback(async () => {
    setBusy(true);
    try { await window.electronAPI?.update?.install?.(); }
    finally { setBusy(false); }
  }, []);

  const handleLater = () => {
    setDismissedVersion(status?.version || 'unknown');
  };

  const state = status?.state;
  const showAvailable  = state === 'available'  && status.version !== dismissedVersion;
  const showDownloading = state === 'downloading';
  const showDownloaded  = state === 'downloaded' && status.version !== dismissedVersion;
  const showError       = state === 'error' && status.error && status.error !== dismissedVersion;

  if (!showAvailable && !showDownloading && !showDownloaded && !showError) return null;

  return (
    <div className="update-modal-backdrop" role="dialog" aria-modal="true">
      <div className="update-modal">
        <div className="update-modal__head">
          <span className="update-modal__title">
            {showAvailable && '🔔 새 버전이 있습니다'}
            {showDownloading && '⬇ 업데이트 다운로드 중'}
            {showDownloaded && '✅ 다운로드 완료'}
            {showError && '⚠ 업데이트 오류'}
          </span>
          {status.version && (
            <span className="update-modal__version">v{status.version}</span>
          )}
        </div>

        {showAvailable && (
          <>
            <ReleaseNotes notes={status.releaseNotes} />
            <div className="update-modal__actions">
              <button type="button" className="btn btn--secondary"
                      onClick={handleLater} disabled={busy}>나중에</button>
              <button type="button" className="btn btn--primary"
                      onClick={handleDownload} disabled={busy}>
                {busy ? '시작 중…' : '지금 다운로드'}
              </button>
            </div>
          </>
        )}

        {showDownloading && (
          <>
            <div className="update-modal__progress">
              <div className="update-modal__bar"
                   style={{ width: `${status.percent || 0}%` }} />
            </div>
            <div className="update-modal__progress-text">
              {status.percent || 0}%
              {status.total > 0 && (
                <> · {(status.transferred / 1_000_000).toFixed(1)}MB
                   / {(status.total / 1_000_000).toFixed(1)}MB</>
              )}
            </div>
          </>
        )}

        {showDownloaded && (
          <>
            <p className="update-modal__msg">
              새 버전이 다운로드 되었습니다. 지금 재시작해서 설치하시겠어요?
            </p>
            <div className="update-modal__actions">
              <button type="button" className="btn btn--secondary"
                      onClick={handleLater} disabled={busy}>나중에</button>
              <button type="button" className="btn btn--primary"
                      onClick={handleInstall} disabled={busy}>
                {busy ? '재시작 중…' : '지금 재시작 + 설치'}
              </button>
            </div>
          </>
        )}

        {showError && (
          <>
            <p className="update-modal__msg update-modal__msg--error">{status.error}</p>
            <div className="update-modal__actions">
              <button type="button" className="btn btn--secondary"
                      onClick={() => setDismissedVersion(status.error)}>닫기</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReleaseNotes({ notes }) {
  if (!notes) {
    return <p className="update-modal__msg">새 버전이 출시되었습니다.</p>;
  }
  // 간단한 markdown 비슷한 처리 — 줄 단위로 분할, '- ' / '* ' 는 li 로.
  const lines = String(notes).split(/\r?\n/);
  return (
    <div className="update-modal__notes">
      {lines.map((ln, i) => {
        const t = ln.trimStart();
        if (/^[-*]\s+/.test(t)) {
          return <li key={i}>{t.replace(/^[-*]\s+/, '')}</li>;
        }
        if (/^#+\s+/.test(t)) {
          return <h4 key={i}>{t.replace(/^#+\s+/, '')}</h4>;
        }
        if (!t) return <br key={i} />;
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
}
