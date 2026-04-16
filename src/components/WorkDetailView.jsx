import React, { useEffect, useState, useCallback } from 'react';
import WebView from './WebView';
import WorkView from './WorkView';
import PhaseStepper from './PhaseStepper';

/**
 * 작업 상세 view — 사이드바 '작업' 메뉴에서 표시.
 *
 * 구성:
 *   - 상단 작업 헤더: 벤더 · 날짜 · 차수 + phase stepper + 완료 버튼 + 달력으로 돌아가기
 *   - 본문: WebView (WCV) + 하단 작업 패널 토글 (기존 그대로)
 *
 * Props:
 *   - job: manifest 또는 null
 *   - vendor: 헤더 벤더 (보통 job.vendor 와 동기화)
 *   - workOpen, onToggleWork, panelHeight: 작업 패널 토글 상태
 *   - onJobUpdated: (manifest) => void
 *   - onBackToCalendar: () => void
 */
export default function WorkDetailView({
  job, vendor, workOpen, onToggleWork, panelHeight,
  onJobUpdated, onBackToCalendar,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // PO 다운로드 결과를 받아 manifest.phase 갱신
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPythonDone || !job) return;
    const unsub = api.onPythonDone(async (data) => {
      const name = data?.scriptName || '';
      if (!name.includes('po_download.py')) return;
      if (data.exitCode !== 0 || data.killed) return;

      // PO 다운 성공 → manifest phase 그대로 (po_downloaded 유지) + stats 업데이트는 후속
      // 일단 manifest 다시 읽어서 부모에 전달
      const res = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      if (res?.success) onJobUpdated?.(res.manifest);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [job, onJobUpdated]);

  const handleComplete = useCallback(async () => {
    if (!job) return;
    if (!window.confirm(`${job.vendor} ${job.sequence}차 작업을 완료 처리하시겠습니까?\n완료 후에는 이 차수에 더 작업할 수 없습니다.`)) return;
    setBusy(true);
    setError('');
    const api = window.electronAPI;
    const res = await api.jobs.complete(job.date, job.vendor, job.sequence);
    setBusy(false);
    if (!res?.success) {
      setError(res?.error || '완료 처리 실패');
      return;
    }
    onJobUpdated?.(res.manifest);
  }, [job, onJobUpdated]);

  if (!job) {
    return (
      <div className="work-detail-empty">
        <p>활성 작업이 없습니다.</p>
        <button type="button" className="btn btn--primary" onClick={onBackToCalendar}>
          📅 달력으로 가기
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="work-detail-header">
        <button
          type="button"
          className="btn btn--secondary work-detail-header__back"
          onClick={onBackToCalendar}
          title="달력으로"
        >
          ← 달력
        </button>
        <div className="work-detail-header__title">
          <span className="work-detail-header__vendor">{job.vendor}</span>
          <span className="work-detail-header__sep">·</span>
          <span>{job.date}</span>
          <span className="work-detail-header__sep">·</span>
          <span className="work-detail-header__seq">{job.sequence}차</span>
          {job.completed && <span className="work-detail-header__completed">✓ 완료</span>}
        </div>
        <div className="work-detail-header__stepper">
          <PhaseStepper phase={job.phase} completed={job.completed} />
        </div>
        <button
          type="button"
          className="btn btn--secondary work-detail-header__complete"
          onClick={handleComplete}
          disabled={busy || job.completed}
          title={job.completed ? '이미 완료됨' : '이 차수 작업을 종료'}
        >
          ✓ 작업 완료
        </button>
      </div>
      {error && <div className="modal__error" style={{ margin: '0 16px 8px' }}>{error}</div>}

      <section className="app-pane app-pane--web">
        <WebView vendor={vendor} isActive={true} />
      </section>

      <button
        type="button"
        className={`work-bar${workOpen ? ' work-bar--open' : ''}`}
        onClick={onToggleWork}
        aria-expanded={workOpen}
        aria-controls="work-panel"
      >
        <span className="work-bar__label">📋 작업 패널</span>
        <span className="work-bar__chevron">{workOpen ? '▼ 닫기' : '▲ 펼치기'}</span>
      </button>

      <section
        id="work-panel"
        className={`work-panel${workOpen ? '' : ' work-panel--closed'}`}
        style={{ flexBasis: workOpen ? panelHeight : '0px', maxHeight: workOpen ? panelHeight : '0px' }}
        aria-hidden={!workOpen}
      >
        <WorkView vendor={vendor} job={job} />
      </section>
    </>
  );
}
