import React, { useEffect, useRef, useState } from 'react';

/**
 * 투비 쿠팡반출 양식 모달.
 *
 * 목적: 외부 물류팀과 엑셀로 데이터 주고받기 위한 전용 양식.
 *   - 다운로드: 현재 confirmation.xlsx + transport.json + 이전 snapshot 을 조합해
 *              양식을 채움. 사용자에게 saveFileAs 로 제공.
 *   - 업로드: 사용자가 편집한 xlsx 를 선택 → 확인 후 앱 내부 데이터에 반영.
 *             확정수량은 cross-sync, 반출은 po-tbnws, 운송방법/박스/파렛트/송장은
 *             transport.json, 나머지(창고수량·비고) 는 coupang-export.json 스냅샷.
 *
 * 저장 위치: jobDir/coupang-export.json (snapshot) +
 *           jobDir/coupang-export-latest.xlsx (사용자가 마지막 올린 원본)
 */
export default function TbnwsCoupangExportModal({ job, onClose }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const fileInputRef = useRef(null);

  // 마지막 업로드 snapshot 로드 (있으면 UI 에 요약 표시)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = window.electronAPI;
        const resolved = await api.resolveJobPath(
          job.date, job.vendor, job.sequence, 'coupang-export.json',
        );
        if (!resolved?.success) return;
        const exists = await api.fileExists(resolved.path);
        if (!exists) return;
        const read = await api.readFile(resolved.path);
        if (!read?.success || !read.data) return;
        const text = new TextDecoder('utf-8').decode(read.data);
        const parsed = JSON.parse(text);
        if (!cancelled) setSnapshot(parsed);
      } catch {
        /* 무시 */
      }
    })();
    return () => { cancelled = true; };
  }, [job]);

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('양식 생성 중…');
    try {
      const api = window.electronAPI;
      const res = await api.tbnwsCoupangExport.generate(job.date, job.vendor, job.sequence);
      if (!res?.success) {
        alert(`양식 생성 실패: ${res?.error || 'unknown'}`);
        return;
      }
      setStatus(`생성 완료 (${res.rowCount}행)`);
      const dateCompact = String(job.date).replace(/-/g, '');
      const seq = String(job.sequence).padStart(2, '0');
      const defaultName = `${job.vendor}-${dateCompact}-${seq}-쿠팡반출.xlsx`;
      const dl = await api.saveFileAs(res.path, defaultName);
      if (dl?.canceled) { setStatus(''); return; }
      if (!dl?.success) {
        alert(`다운로드 실패: ${dl?.error ?? 'unknown'}`);
        return;
      }
      setStatus('다운로드 완료');
    } catch (err) {
      alert(`예외: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleUploadClick = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 동일 파일 재선택 가능하도록
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      alert('xlsx 파일만 업로드 가능합니다.');
      return;
    }
    const ok = window.confirm(
      `'${file.name}' 을 업로드합니다.\n`
      + '현재 발주확정서·PO·운송분배의 해당 컬럼 값이 덮어써집니다.\n'
      + '계속하시겠습니까?',
    );
    if (!ok) return;

    setBusy(true);
    setStatus('업로드 파싱 중…');
    try {
      const buf = await file.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      const api = window.electronAPI;
      const res = await api.tbnwsCoupangExport.apply(
        job.date, job.vendor, job.sequence, uint8,
      );
      if (!res?.success) {
        alert(`반영 실패: ${res?.error || 'unknown'}`);
        setStatus('');
        return;
      }
      setStatus(
        `반영 완료 — 확정수량 ${res.confirmedPatched}행 · 반출 ${res.fulfillPatched}행 · 운송 ${res.transportPatched}행`,
      );
      // 스냅샷 새로 읽어 UI 갱신
      try {
        const resolved = await api.resolveJobPath(
          job.date, job.vendor, job.sequence, 'coupang-export.json',
        );
        if (resolved?.success) {
          const read = await api.readFile(resolved.path);
          if (read?.success && read.data) {
            setSnapshot(JSON.parse(new TextDecoder('utf-8').decode(read.data)));
          }
        }
      } catch { /* 무시 */ }
      window.dispatchEvent(new Event('job:reload'));
    } catch (err) {
      alert(`예외: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  const snapshotRowCount = snapshot?.rows ? Object.keys(snapshot.rows).length : 0;
  const snapshotDate = snapshot?.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleString('ko-KR')
    : null;

  return (
    <div className="eflex-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="eflex-overlay__card" onClick={(e) => e.stopPropagation()}>
        <header className="eflex-overlay__header">
          <h3 className="eflex-overlay__title">
            📑 투비 쿠팡반출 양식
          </h3>
          <button type="button" className="eflex-overlay__close" onClick={onClose}>×</button>
        </header>

        <div className="eflex-overlay__body">
          <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
            외부 물류팀과 엑셀로 주고받는 전용 양식입니다.
            {' '}
            현재 상태(confirmation + 운송분배 + 이전 스냅샷)를 담아 내려받은 뒤,
            창고 담당자가 편집한 파일을 다시 올리면 해당 컬럼만 앱에 반영됩니다.
          </p>

          <div style={{ margin: '12px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
            <b>편집 가능 컬럼</b>: 반출 · 창고수량 · 확정수량 · 운송방법 ·
            박스번호 · 송장번호 · 파렛트번호 · 비고
          </div>

          {snapshot && (
            <div
              style={{
                padding: '8px 12px',
                background: '#f4f6f9',
                borderLeft: '3px solid #2b5cab',
                fontSize: 12,
                margin: '12px 0',
              }}
            >
              마지막 업로드 스냅샷: <b>{snapshotRowCount}행</b>
              {snapshotDate && <> · {snapshotDate}</>}
            </div>
          )}

          {status && (
            <div style={{ margin: '8px 0', color: 'var(--color-primary)', fontSize: 12 }}>
              {status}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleDownload}
              disabled={busy}
            >
              📥 양식 다운로드
            </button>
            <button
              type="button"
              className="btn btn--warning"
              onClick={handleUploadClick}
              disabled={busy}
            >
              📤 업로드 반영
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        </div>

        <footer className="eflex-overlay__footer">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={busy}
          >
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
