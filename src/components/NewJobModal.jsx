import React, { useMemo, useRef, useState, useCallback } from 'react';
import { ViewOutlet } from '../core/plugin-host';
import { KNOWN_VIEW_ROLES } from '../core/plugin-api';

/**
 * 새 작업 생성 모달 — 두 가지 소스 중 선택:
 *
 *   1. '쿠팡에서 자동 가져오기' — 기존 동작. po_download.py 로 PO 다운로드
 *   2. '파일로 직접 업로드'     — 사용자가 xlsx 직접 업로드 → job 폴더의 po.xlsx 로 저장
 *
 * 플러그인 옵션 (newjob.options role) — 플러그인이 체크박스 등을 기여하면
 * 그 값이 pluginOptions 에 쌓여 onCoupang/onFile 의 마지막 인자로 전달됨.
 *
 * Props:
 *   - date, vendor: 표시용 메타 정보
 *   - usedSequences: number[]  — 이미 생성된 차수 목록 (중복 방지)
 *   - defaultSequence: number  — 스피너 기본값 (보통 마지막+1)
 *   - onCancel()
 *   - onCoupang(sequence, options)             — 자동 가져오기 선택 시
 *   - onFile(fileBuffer, fileName, sequence, options)  — 파일 업로드 선택 시
 */
export default function NewJobModal({
  date, vendor, usedSequences = [], defaultSequence = 1,
  onCancel, onCoupang, onFile,
}) {
  const [mode, setMode] = useState(null); // null | 'coupang' | 'file'
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [sequence, setSequence] = useState(defaultSequence);
  const [pluginOptions, setPluginOptions] = useState({});
  const fileInputRef = useRef(null);

  // 플러그인 view 에 전달할 controlled onChange — key/value 로 옵션 업데이트
  const handlePluginOptionChange = useCallback((key, value) => {
    setPluginOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const used = useMemo(() => new Set(usedSequences), [usedSequences]);
  const isDuplicate = used.has(sequence);
  const invalid = !Number.isInteger(sequence) || sequence < 1 || sequence > 99;
  const seqError = invalid
    ? '1~99 사이의 숫자를 입력하세요.'
    : isDuplicate
      ? `이미 존재하는 차수입니다: ${sequence}차`
      : null;

  const step = (delta) => {
    setSequence((s) => {
      const next = (Number.isInteger(s) ? s : defaultSequence) + delta;
      if (next < 1) return 1;
      if (next > 99) return 99;
      return next;
    });
  };

  const handleCoupang = async () => {
    if (seqError) { alert(seqError); return; }
    setMode('coupang');
    setBusy(true);
    try { await onCoupang(sequence, pluginOptions); } finally { setBusy(false); }
  };

  const handleFilePick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
  };

  const handleFileConfirm = async () => {
    if (seqError) { alert(seqError); return; }
    const f = fileInputRef.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      await onFile(buf, f.name, sequence, pluginOptions);
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
          <span className="newjob-seq">
            <button
              type="button"
              className="newjob-seq__btn"
              onClick={() => step(-1)}
              disabled={busy || sequence <= 1}
              aria-label="차수 감소"
            >−</button>
            <input
              type="number"
              className={`newjob-seq__input${seqError ? ' is-invalid' : ''}`}
              min={1}
              max={99}
              value={Number.isInteger(sequence) ? sequence : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') { setSequence(NaN); return; }
                const n = parseInt(v, 10);
                if (Number.isFinite(n)) setSequence(n);
              }}
              disabled={busy}
            />
            <button
              type="button"
              className="newjob-seq__btn"
              onClick={() => step(1)}
              disabled={busy || sequence >= 99}
              aria-label="차수 증가"
            >+</button>
            <span className="newjob-seq__suffix">차</span>
          </span>
        </div>
        {seqError && (
          <div className="newjob-seq__error">{seqError}</div>
        )}

        {/* 플러그인 옵션 영역 — tbnws 등의 플러그인이 체크박스/폼 기여 */}
        <ViewOutlet
          role={KNOWN_VIEW_ROLES.NEWJOB_OPTIONS}
          ctx={{ date, vendor }}
          viewProps={{
            options: pluginOptions,
            onChange: handlePluginOptionChange,
            disabled: busy,
          }}
        />

        {!mode && (
          <div className="newjob-options">
            <button
              type="button"
              className="newjob-option"
              onClick={handleCoupang}
              disabled={busy || !!seqError}
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
              disabled={busy || !!seqError}
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
                disabled={busy || !fileName || !!seqError}
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
