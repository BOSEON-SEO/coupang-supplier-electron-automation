import React, { useEffect, useState, useCallback } from 'react';
import WebView from './WebView';
import WorkView from './WorkView';
import PhaseStepper from './PhaseStepper';

/**
 * 작업 상세 view — bottom-sheet accordion 패턴
 *
 * 구조:
 *   work-detail-header
 *   work-content (position: relative — accordion 의 위치 기준)
 *     ├ work-content__web    (웹뷰, 항상 전체 차지)
 *     └ work-accordion       (하단 고정, height로 슬라이드)
 *         ├ work-accordion__bar   (토글 버튼, 36px)
 *         └ work-accordion__body  (내용)
 *
 * 닫힘: accordion height = 36px (바만 보임)
 * 열림: accordion height = 100% (content 전체 덮음)
 * height transition 으로 양방향 슬라이드 애니메이션.
 */
export default function WorkDetailView({
  job, vendor, workOpen, onToggleWork,
  onJobUpdated, onBackToCalendar,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPythonDone || !job) return;
    const unsub = api.onPythonDone(async (data) => {
      const name = data?.scriptName || '';
      if (!name.includes('po_download.py')) return;
      if (data.exitCode !== 0 || data.killed) return;
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

      <div className="work-content">
        <div className="work-content__web">
          <WebView vendor={vendor} isActive={!workOpen} />
        </div>

        <div className={`work-accordion${workOpen ? ' work-accordion--open' : ''}`}>
          <button
            type="button"
            className="work-accordion__bar"
            onClick={onToggleWork}
            aria-expanded={workOpen}
          >
            <span className="work-accordion__label">📋 작업 패널</span>
            <span className="work-accordion__chev">{workOpen ? '▼ 닫기' : '▲ 펼치기'}</span>
          </button>
          <div className="work-accordion__body">
            <WorkView vendor={vendor} job={job} />
          </div>
        </div>
      </div>
    </>
  );
}
