import React, { useEffect, useState, useCallback } from 'react';

/**
 * 결과/출력 뷰 — job 폴더의 최종 산출물 목록.
 *
 *   - 파일명 / 크기 / 수정 시각 / 개별 다운로드
 *   - 산출물 유형별 친절한 라벨 (po.xlsx → 원본 PO, confirmation.xlsx → 발주확정서 등)
 */

const TYPE_HINTS = {
  'po.xlsx':           { label: 'PO 원본',         icon: '📄' },
  'po.csv':            { label: 'PO 원본 (csv)',   icon: '📄' },
  'confirmation.xlsx': { label: '발주확정서',       icon: '📋' },
  'transport.json':    { label: '운송 배정',       icon: '🚚' },
  'manifest.json':     { label: '작업 메타',       icon: '🗂️' },
};

function hint(name) {
  return TYPE_HINTS[name] || { label: '', icon: '📁' };
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ResultView({ job, appendLog, onJobUpdated }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!job) return;
    const api = window.electronAPI;
    if (!api?.jobs?.listFiles) return;
    setLoading(true);
    setError('');
    const res = await api.jobs.listFiles(job.date, job.vendor, job.sequence);
    setLoading(false);
    if (!res?.success) {
      setError(res?.error || '파일 목록 조회 실패');
      setFiles([]);
      return;
    }
    setFiles(res.files || []);
  }, [job]);

  useEffect(() => { reload(); }, [reload]);

  const handleDownload = useCallback(async (fileName) => {
    const api = window.electronAPI;
    if (!api || !job) return;
    const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, fileName);
    if (!resolved?.success) {
      appendLog?.('error', `경로 해석 실패: ${resolved?.error}`);
      return;
    }
    const dateCompact = String(job.date).replace(/-/g, '');
    const seq = String(job.sequence).padStart(2, '0');
    const defaultName = `${job.vendor}-${dateCompact}-${seq}-${fileName}`;
    const res = await api.saveFileAs(resolved.path, defaultName);
    if (res?.canceled) return;
    if (!res?.success) {
      appendLog?.('error', `다운로드 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog?.('info', `[다운로드] ${res.path}`);
  }, [job, appendLog]);

  // 업로드 히스토리 — manifest 에서 절대 경로로 보관된 파일을 saveFileAs 로 다운로드
  const handleDownloadHistory = useCallback(async (entry) => {
    const api = window.electronAPI;
    if (!api) return;
    const defaultName = entry.fileName;
    const res = await api.saveFileAs(entry.path, defaultName);
    if (res?.canceled) return;
    if (!res?.success) {
      appendLog?.('error', `히스토리 다운로드 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog?.('info', `[다운로드] ${res.path}`);
  }, [appendLog]);

  const handleDeleteHistory = useCallback(async (entry) => {
    if (!job || !entry?.timestamp) return;
    if (!window.confirm(`'${entry.fileName}' 업로드 이력을 삭제하시겠습니까?\n스냅샷 파일도 함께 제거됩니다.`)) return;
    const api = window.electronAPI;
    const res = await api.jobs.deleteUploadHistory(job.date, job.vendor, job.sequence, entry.timestamp);
    if (!res?.success) {
      appendLog?.('error', `이력 삭제 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog?.('event', `[업로드 이력] 삭제: ${entry.fileName}`);
    if (res.manifest) onJobUpdated?.(res.manifest);
    reload();
  }, [job, appendLog, onJobUpdated, reload]);

  if (!job) {
    return <div className="result-view result-view--empty">활성 작업이 없습니다.</div>;
  }

  return (
    <div className="result-view">
      <div className="result-view__header">
        <h3 className="result-view__title">📊 작업 산출물</h3>
        <div className="result-view__meta">
          {job.vendor} · {job.date} · {job.sequence}차
          {job.phase && <> · phase: <code>{job.phase}</code></>}
        </div>
        <div className="result-view__spacer" />
        <button type="button" className="btn btn--secondary btn--sm" onClick={reload} disabled={loading}>
          🔄 새로고침
        </button>
      </div>

      {loading && <div className="result-view__empty">로드 중…</div>}
      {error && <div className="result-view__error">{error}</div>}

      {Array.isArray(job?.uploadHistory) && job.uploadHistory.length > 0 && (
        <section className="result-view__section">
          <h4 className="result-view__section-title">
            ✅ 업로드 이력 ({job.uploadHistory.length}회)
          </h4>
          <table className="result-table">
            <thead>
              <tr>
                <th className="result-table__col-label">#</th>
                <th>업로드 시각</th>
                <th className="result-table__col-name">스냅샷 파일</th>
                <th className="result-table__col-size">크기</th>
                <th className="result-table__col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {job.uploadHistory.map((h, i) => (
                <tr key={h.timestamp}>
                  <td className="result-table__col-label">#{i + 1}</td>
                  <td>{formatDate(new Date(h.timestamp).getTime())}</td>
                  <td className="result-table__col-name"><code>{h.fileName}</code></td>
                  <td className="result-table__col-size">{formatSize(h.size)}</td>
                  <td className="result-table__col-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => handleDownloadHistory(h)}
                    >⬇ 다운로드</button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => handleDeleteHistory(h)}
                      title="이 업로드 이력 및 스냅샷 파일 삭제"
                    >삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="result-view__empty">
          아직 생성된 산출물이 없습니다. PO 다운로드부터 시작하세요.
        </div>
      )}

      {files.length > 0 && (
        <section className="result-view__section">
          <h4 className="result-view__section-title">📁 작업 산출물</h4>
        <table className="result-table">
          <thead>
            <tr>
              <th className="result-table__col-label">유형</th>
              <th className="result-table__col-name">파일명</th>
              <th className="result-table__col-size">크기</th>
              <th className="result-table__col-mtime">수정 시각</th>
              <th className="result-table__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const h = hint(f.name);
              return (
                <tr key={f.name}>
                  <td className="result-table__col-label">
                    <span className="result-table__icon">{h.icon}</span>
                    <span className="result-table__label">{h.label || '—'}</span>
                  </td>
                  <td className="result-table__col-name"><code>{f.name}</code></td>
                  <td className="result-table__col-size">{formatSize(f.size)}</td>
                  <td className="result-table__col-mtime">{formatDate(f.mtime)}</td>
                  <td className="result-table__col-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => handleDownload(f.name)}
                    >
                      ⬇ 다운로드
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </section>
      )}
    </div>
  );
}
