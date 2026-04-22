import React, { useEffect, useState, useCallback, useMemo } from 'react';

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

// 서류 다운로드 이력 테이블 — type별 섹션에서 공통 사용.
function DocsDownloadTable({ rows, openMap, onToggle, onOpenFolder, onDelete }) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          <th className="result-table__col-label">#</th>
          <th>다운로드 시각</th>
          <th>파일 수</th>
          <th className="result-table__col-name">폴더</th>
          <th className="result-table__col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h, i) => {
          const isOpen = !!openMap[h.timestamp];
          const fileCount = Array.isArray(h.files) ? h.files.length : 0;
          return (
            <React.Fragment key={h.timestamp}>
              <tr>
                <td className="result-table__col-label">#{i + 1}</td>
                <td>{formatDate(new Date(h.timestamp).getTime())}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => onToggle(h.timestamp)}
                    title={isOpen ? '접기' : '파일 목록 펼치기'}
                  >
                    {isOpen ? '▼' : '▶'} {fileCount}개
                  </button>
                </td>
                <td className="result-table__col-name">
                  <code className="result-view__folder">{h.folder}</code>
                </td>
                <td className="result-table__col-actions">
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => onOpenFolder(h.folder)}
                    title="탐색기에서 폴더 열기"
                  >📂 폴더 열기</button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => onDelete(h)}
                    title="이 이력만 제거 (파일 유지)"
                  >삭제</button>
                </td>
              </tr>
              {isOpen && fileCount > 0 && (
                <tr>
                  <td colSpan={5}>
                    <ul className={`result-download-files${h.type === 'shipment-docs' ? ' result-download-files--shipment' : ''}`}>
                      {h.files.map((f) => (
                        <li key={f.name}>
                          <code>{f.name}</code>
                          {f.size != null && <span className="result-view__dim"> · {formatSize(f.size)}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export default function ResultView({
  job, appendLog, onJobUpdated,
  pythonRunning = false, jobLocked = false,
  onDownloadMilkrunDocs, onDownloadShipmentDocs,
}) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 어떤 다운로드 폴더가 펼쳐져 있는지 — timestamp 를 키로 사용
  const [openDownloads, setOpenDownloads] = useState({});

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
    const api = window.electronAPI;
    if (!api) return;
    const typeLabel = entry.type || '처리';

    if (entry.type === '발주확정') {
      if (!window.confirm(`'${entry.fileName}' ${typeLabel} 이력을 삭제하시겠습니까?\n스냅샷 파일도 함께 제거됩니다.`)) return;
      const res = await api.jobs.deleteUploadHistory(job.date, job.vendor, job.sequence, entry.timestamp);
      if (!res?.success) {
        appendLog?.('error', `이력 삭제 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      appendLog?.('event', `[발주확정 이력] 삭제: ${entry.fileName}`);
      if (res.manifest) onJobUpdated?.(res.manifest);
      reload();
      return;
    }

    if (entry.type === '밀크런' || entry.type === '쉽먼트') {
      const key = entry.type === '밀크런' ? 'milkrunHistory' : 'shipmentHistory';
      const label = entry.center ? `${entry.type} · ${entry.center}` : entry.type;
      if (!window.confirm(`${formatDate(new Date(entry.timestamp).getTime())} ${label} 이력을 삭제하시겠습니까?`)) return;
      const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const prev = mres?.success ? (mres.manifest?.[key] || []) : [];
      const next = prev.filter((h) => h.timestamp !== entry.timestamp);
      const patch = { [key]: next.length ? next : null };
      const res = await api.jobs.updateManifest(job.date, job.vendor, job.sequence, patch);
      if (!res?.success) {
        appendLog?.('error', `이력 삭제 실패: ${res?.error ?? 'unknown'}`);
        return;
      }
      appendLog?.('event', `[${entry.type} 이력] 삭제: ${entry.timestamp}`);
      if (res.manifest) onJobUpdated?.(res.manifest);
      reload();
    }
  }, [job, appendLog, onJobUpdated, reload]);

  // ── 다운로드 폴더 열기 (OS 탐색기) ──
  const handleOpenDownloadFolder = useCallback(async (folderPath) => {
    const api = window.electronAPI;
    if (!api?.showItemInFolder || !folderPath) return;
    try {
      await api.showItemInFolder(folderPath);
    } catch (err) {
      appendLog?.('error', `폴더 열기 실패: ${err.message}`);
    }
  }, [appendLog]);

  // ── 다운로드 이력 한 건 삭제 ──
  const handleDeleteDownloadHistory = useCallback(async (entry) => {
    if (!job || !entry?.timestamp) return;
    const api = window.electronAPI;
    if (!api) return;
    const fileCount = Array.isArray(entry.files) ? entry.files.length : 0;
    if (!window.confirm(
      `${formatDate(new Date(entry.timestamp).getTime())} 다운로드 이력을 삭제하시겠습니까?\n`
      + `(${fileCount}개 파일 · manifest 에서만 제거 — 실제 파일은 유지됩니다)`
    )) return;
    const mres = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
    const prev = mres?.success ? (mres.manifest?.downloadHistory || []) : [];
    const next = prev.filter((h) => h.timestamp !== entry.timestamp);
    const patch = { downloadHistory: next.length ? next : null };
    const res = await api.jobs.updateManifest(job.date, job.vendor, job.sequence, patch);
    if (!res?.success) {
      appendLog?.('error', `다운로드 이력 삭제 실패: ${res?.error ?? 'unknown'}`);
      return;
    }
    appendLog?.('event', `[다운로드 이력] 삭제: ${entry.timestamp}`);
    if (res.manifest) onJobUpdated?.(res.manifest);
  }, [job, appendLog, onJobUpdated]);

  // ── 다운로드 이력을 type별로 분리 (오래된 → 최신 순, 처리 이력과 동일) ──
  const { milkrunDocs, shipmentDocs } = useMemo(() => {
    const all = Array.isArray(job?.downloadHistory) ? [...job.downloadHistory] : [];
    all.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return {
      milkrunDocs: all.filter((h) => h.type === 'milkrun-docs'),
      shipmentDocs: all.filter((h) => h.type === 'shipment-docs'),
    };
  }, [job]);

  // ── 서류 다운로드 실행 (이력 있으면 confirm 후 진행) ──
  const runDocsDownload = useCallback((kind) => {
    if (!job) return;
    const hist = kind === 'milkrun' ? milkrunDocs : shipmentDocs;
    const label = kind === 'milkrun' ? '밀크런 서류' : '쉽먼트 서류';
    if (hist.length > 0) {
      // 오름차순 정렬이므로 마지막 원소가 최근
      const lastTs = formatDate(new Date(hist[hist.length - 1].timestamp).getTime());
      const ok = window.confirm(
        `${label} 다운로드 기록이 이미 ${hist.length}회 있습니다 (최근: ${lastTs}).\n`
        + `다시 받으면 새 폴더에 저장되고 이력에 추가됩니다.\n\n`
        + `계속 진행하시겠습니까?`
      );
      if (!ok) return;
    }
    if (kind === 'milkrun') onDownloadMilkrunDocs?.();
    else onDownloadShipmentDocs?.();
  }, [job, milkrunDocs, shipmentDocs, onDownloadMilkrunDocs, onDownloadShipmentDocs]);

  // ── 업로드·밀크런·쉽먼트 이력을 단일 타임라인으로 병합 ──
  const mergedHistory = useMemo(() => {
    const items = [];
    if (Array.isArray(job?.uploadHistory)) {
      for (const h of job.uploadHistory) items.push({ type: '발주확정', ...h });
    }
    if (Array.isArray(job?.milkrunHistory)) {
      for (const h of job.milkrunHistory) items.push({ type: '밀크런', ...h });
    }
    if (Array.isArray(job?.shipmentHistory)) {
      for (const h of job.shipmentHistory) items.push({ type: '쉽먼트', ...h });
    }
    items.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return items;
  }, [job]);

  const typeBadgeClass = (t) => {
    if (t === '발주확정') return 'result-type-badge result-type-badge--upload';
    if (t === '밀크런')   return 'result-type-badge result-type-badge--milkrun';
    if (t === '쉽먼트')   return 'result-type-badge result-type-badge--shipment';
    return 'result-type-badge';
  };

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

      {mergedHistory.length > 0 && (
        <section className="result-view__section">
          <h4 className="result-view__section-title">
            ✅ 처리 이력 ({mergedHistory.length}회)
          </h4>
          <table className="result-table">
            <thead>
              <tr>
                <th className="result-table__col-label">#</th>
                <th className="result-table__col-type">유형</th>
                <th>처리 시각</th>
                <th className="result-table__col-name">스냅샷 파일</th>
                <th className="result-table__col-size">크기</th>
                <th className="result-table__col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {mergedHistory.map((h, i) => (
                <tr key={`${h.type}-${h.timestamp}`}>
                  <td className="result-table__col-label">#{i + 1}</td>
                  <td className="result-table__col-type">
                    <span className={typeBadgeClass(h.type)}>{h.type}</span>
                  </td>
                  <td>{formatDate(new Date(h.timestamp).getTime())}</td>
                  <td className="result-table__col-name">
                    {h.fileName ? <code>{h.fileName}</code> : <span className="result-view__dim">—</span>}
                  </td>
                  <td className="result-table__col-size">
                    {h.size != null ? formatSize(h.size) : <span className="result-view__dim">—</span>}
                  </td>
                  <td className="result-table__col-actions">
                    {h.path && h.fileName ? (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => handleDownloadHistory(h)}
                      >📥 다운로드</button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => handleDeleteHistory(h)}
                      title={`이 ${h.type} 이력 삭제`}
                    >삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── 쉽먼트 서류 섹션 — 쉽먼트 등록 이력이 있어야 실행 가능 ── */}
      {(() => {
        const hasShipmentReg = Array.isArray(job?.shipmentHistory) && job.shipmentHistory.length > 0;
        const canRun = !!job && !pythonRunning && !jobLocked && hasShipmentReg;
        const title = !hasShipmentReg
          ? '쉽먼트 등록 기록이 있어야 서류 다운로드가 가능합니다'
          : jobLocked ? '플러그인 창이 열려있습니다'
          : pythonRunning ? '자동화 진행 중입니다'
          : '쉽먼트 리스트에서 입고예정일 필터 후 Label/내역서를 페이지 순회하며 일괄 다운로드';
        return (
          <section className="result-view__section">
            <div className="result-view__section-header">
              <h4 className="result-view__section-title">
                📦 쉽먼트 서류 {shipmentDocs.length > 0 && <span className="result-view__dim">({shipmentDocs.length}회)</span>}
              </h4>
              <div className="result-view__section-actions">
                <button
                  type="button"
                  className="btn btn--phase-shipment btn--sm"
                  onClick={() => runDocsDownload('shipment')}
                  disabled={!canRun}
                  title={title}
                >📥 쉽먼트 서류 다운로드</button>
              </div>
            </div>
            {shipmentDocs.length === 0 ? (
              <div className="result-view__empty result-view__empty--inline">
                아직 다운로드한 쉽먼트 서류가 없습니다.
              </div>
            ) : (
              <DocsDownloadTable
                rows={shipmentDocs}
                openMap={openDownloads}
                onToggle={(ts) => setOpenDownloads((prev) => ({ ...prev, [ts]: !prev[ts] }))}
                onOpenFolder={handleOpenDownloadFolder}
                onDelete={handleDeleteDownloadHistory}
              />
            )}
          </section>
        );
      })()}

      {/* ── 밀크런 서류 섹션 — 밀크런 등록 이력이 있어야 실행 가능 ── */}
      {(() => {
        const hasMilkrunReg = Array.isArray(job?.milkrunHistory) && job.milkrunHistory.length > 0;
        const canRun = !!job && !pythonRunning && !jobLocked && hasMilkrunReg;
        const title = !hasMilkrunReg
          ? '밀크런 등록 기록이 있어야 서류 다운로드가 가능합니다'
          : jobLocked ? '플러그인 창이 열려있습니다'
          : pythonRunning ? '자동화 진행 중입니다'
          : '밀크런 리스트에서 각 행의 프린트·팔레트 부착 리스트를 일괄 다운로드';
        return (
          <section className="result-view__section">
            <div className="result-view__section-header">
              <h4 className="result-view__section-title">
                🚛 밀크런 서류 {milkrunDocs.length > 0 && <span className="result-view__dim">({milkrunDocs.length}회)</span>}
              </h4>
              <div className="result-view__section-actions">
                <button
                  type="button"
                  className="btn btn--phase-milkrun btn--sm"
                  onClick={() => runDocsDownload('milkrun')}
                  disabled={!canRun}
                  title={title}
                >📥 밀크런 서류 다운로드</button>
              </div>
            </div>
            {milkrunDocs.length === 0 ? (
              <div className="result-view__empty result-view__empty--inline">
                아직 다운로드한 밀크런 서류가 없습니다.
              </div>
            ) : (
              <DocsDownloadTable
                rows={milkrunDocs}
                openMap={openDownloads}
                onToggle={(ts) => setOpenDownloads((prev) => ({ ...prev, [ts]: !prev[ts] }))}
                onOpenFolder={handleOpenDownloadFolder}
                onDelete={handleDeleteDownloadHistory}
              />
            )}
          </section>
        );
      })()}

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
              <th className="result-table__col-filetype">유형</th>
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
                  <td className="result-table__col-filetype">
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
