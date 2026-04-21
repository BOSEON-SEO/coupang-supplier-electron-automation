import React, { useRef, useState } from 'react';

/**
 * 새 작업 생성 모달 — 두 가지 소스 중 선택:
 *
 *   1. '쿠팡에서 자동 가져오기' — 기존 동작. po_download.py 로 PO 다운로드
 *   2. '파일로 직접 업로드'     — 사용자가 xlsx 직접 업로드 → job 폴더의 po.xlsx 로 저장
 *
 * Props:
 *   - date, vendor, nextSequence: 표시용 메타 정보
 *   - onCancel()
 *   - onCoupang()             — 자동 가져오기 선택 시
 *   - onFile(fileBuffer, fileName)  — 파일 업로드 선택 시
 */
export default function NewJobModal({
  date, vendor, nextSequence,
  onCancel, onCoupang, onFile,
}) {
  const [mode, setMode] = useState(null); // null | 'coupang' | 'file'
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const handleCoupang = async () => {
    setMode('coupang');
    setBusy(true);
    try { await onCoupang(); } finally { setBusy(false); }
  };

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
  };

  const handleFileConfirm = async () => {
    const f = fileInputRef.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      await onFile(buf, f.name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="newjob-overlay" role="dialog" aria-modal="true">
      <div className="newjob-overlay__card">
        <div className="newjob-overlay__header">
          <h3 className="newjob-overlay__title">📝 새 작업 생성</h3>
          <button type="button" className="newjob-overlay__close" onClick={onCancel} disabled={busy}>
            ×
          </button>
        </div>
        <div className="newjob-overlay__meta">
          <span><code>{date}</code></span>
          <span>·</span>
          <span><b>{vendor}</b></span>
          <span>·</span>
          <span>{nextSequence}차</span>
        </div>

        {!mode && (
          <div className="newjob-options">
            <button
              type="button"
              className="newjob-option"
              onClick={handleCoupang}
              disabled={busy}
            >
              <span className="newjob-option__icon">🌐</span>
              <span className="newjob-option__title">쿠팡에서 자동으로 가져오기</span>
              <span className="newjob-option__desc">
                supplier.coupang.com 에 로그인된 세션으로 PO SKU 를 직접 다운로드합니다.
              </span>
            </button>
            <button
              type="button"
              className="newjob-option"
              onClick={() => setMode('file')}
              disabled={busy}
            >
              <span className="newjob-option__icon">📁</span>
              <span className="newjob-option__title">파일로 직접 업로드</span>
              <span className="newjob-option__desc">
                수동으로 받은 PO xlsx 파일을 업로드해 그대로 사용합니다.
              </span>
            </button>
          </div>
        )}

        {mode === 'file' && (
          <div className="newjob-file">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFilePick}
              className="newjob-file__input"
              disabled={busy}
            />
            <p className="newjob-file__hint">
              쿠팡 PO SKU 다운로드 양식(xlsx) 을 선택하세요.
              이 파일은 job 폴더의 <code>po.xlsx</code> 로 저장됩니다.
            </p>
            {fileName && (
              <div className="newjob-file__selected">
                선택됨: <code>{fileName}</code>
              </div>
            )}
            <div className="newjob-file__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => { setMode(null); setFileName(''); }}
                disabled={busy}
              >
                ← 뒤로
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleFileConfirm}
                disabled={busy || !fileName}
              >
                {busy ? '업로드 중…' : '✅ 이 파일로 생성'}
              </button>
            </div>
          </div>
        )}

        {mode === 'coupang' && busy && (
          <div className="newjob-busy">
            <div className="newjob-busy__spinner" />
            <span>쿠팡에서 PO 다운로드 중…</span>
          </div>
        )}
      </div>
    </div>
  );
}
