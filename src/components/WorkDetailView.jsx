import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import WebView from './WebView';
import WorkView from './WorkView';
import PhaseStepper from './PhaseStepper';

/**
 * 작업 상세 view
 *
 * 구조 (형제 요소, app-main--stack 안에 나열):
 *   work-detail-header
 *   app-pane--web  (flex: 1, 웹뷰 담기)
 *   work-bar       (토글 버튼, 36px)
 *   work-panel     (flex-basis 0 ↔ availableHeight px transition)
 *
 * 닫힘: work-panel flex-basis = 0
 * 열림: work-panel flex-basis = (app-main--stack height - header - work-bar)
 *       → 웹뷰가 밀려나고 패널이 콘텐츠 섹션 전체 차지
 *
 * pixel 값 transition 이라 양방향 모두 부드럽게.
 */
export default function WorkDetailView({
  job, vendor, workOpen, onToggleWork, onCloseWork,
  onJobUpdated, onBackToCalendar,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [availableHeight, setAvailableHeight] = useState(0);
  const [animated, setAnimated] = useState(false);

  const stackRef = useRef(null);
  const headerRef = useRef(null);
  const barRef = useRef(null);

  // work-bar 는 work-panel 안이므로 header만 빼면 됨
  // 첫 프레임에 availableHeight 확정 → 다음 프레임부터 transition 활성화
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const update = () => {
      const total = stack.clientHeight;
      const header = headerRef.current?.clientHeight || 0;
      setAvailableHeight(Math.max(36, total - header));
    };
    update();

    // 다음 프레임에 mount 플래그 on → 초기 점프 없이 이후 변화만 애니메이션
    const raf = requestAnimationFrame(() => setAnimated(true));

    const ro = new ResizeObserver(update);
    ro.observe(stack);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [job]);


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
    <div className="work-stack" ref={stackRef}>
      <div className="work-detail-header" ref={headerRef}>
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
        <WebView vendor={vendor} isActive={!workOpen} />
      </section>

      <section
        className={`work-panel${workOpen ? ' work-panel--open' : ''}${animated ? ' work-panel--animated' : ''}`}
        style={{ height: workOpen ? `${availableHeight}px` : '36px' }}
      >
        <button
          type="button"
          className={`work-bar${workOpen ? ' work-bar--open' : ''}`}
          onClick={onToggleWork}
          aria-expanded={workOpen}
          ref={barRef}
        >
        <span className="work-bar__label">📋 작업 패널</span>
        <span className="work-bar__chevron">{workOpen ? '▼ 닫기' : '▲ 펼치기'}</span>
      </button>
        <div className="work-panel__inner">
          <WorkView vendor={vendor} job={job} onCloseWork={onCloseWork} onJobUpdated={onJobUpdated} />
        </div>
      </section>
    </div>
  );
}
