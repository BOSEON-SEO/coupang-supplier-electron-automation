import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import WebView from './WebView';
import WorkView from './WorkView';
import PhaseStepper from './PhaseStepper';

/**
 * 작업 상세 view — 작업뷰가 메인(풀스크린), 웹뷰는 우측 슬라이드 패널.
 *
 * 구조:
 *   work-stack                 (column flex)
 *     work-detail-header
 *     work-stack__body         (row flex)
 *       work-main              (작업뷰, 항상 풀사이즈로 차지)
 *       web-panel              (width transition: 0 ↔ WEB_WIDTH px)
 *         web-panel__edge      (좌측 세로 토글 바, 사용자 클릭 토글)
 *         web-panel__inner     (WebView 마운트)
 *
 * 자동 펼침:
 *   - CountdownModal mount  → onShowWeb()       (WorkView 내 pendingAction 변경 감지로 호출)
 *   - Python 실행 시작      → onShowWeb()       (WorkView 의 pythonRunning 변경 시)
 *   - 자동 트리거 종료 시   → 사용자 직전 상태로 복귀.
 *
 * 사용자가 명시적으로 토글 버튼을 누르면 그 상태가 새 "사용자 의도" 가 된다.
 */
const WEB_PANEL_DEFAULT = 520;
const WEB_PANEL_MIN = 320;
const WEB_PANEL_MAX = 1200;
const WEB_PANEL_STORAGE = 'webPanelWidth';

export default function WorkDetailView({
  job, vendor, vendors,
  webOpen, onToggleWeb, onShowWeb, onHideWeb,
  onJobUpdated, onBackToCalendar,
}) {
  const vendorMeta = (vendors || []).find((v) => v.id === job?.vendor);
  const vendorName = vendorMeta?.name || job?.vendor || '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [animated, setAnimated] = useState(false);

  // 폭 — 사용자 드래그로 조정. localStorage 영속.
  const [webWidth, setWebWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(WEB_PANEL_STORAGE) || '', 10);
    return Number.isFinite(saved) && saved >= WEB_PANEL_MIN && saved <= WEB_PANEL_MAX ? saved : WEB_PANEL_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);

  const stackRef = useRef(null);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(raf);
  }, [job]);

  // 드래그 리사이즈 — pointer move 로 폭 갱신, up 시 종료 + 저장.
  const startResize = useCallback((e) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = webWidth;
    const onMove = (ev) => {
      const dx = startX - ev.clientX; // 좌측으로 끌수록 폭 증가
      const next = Math.min(WEB_PANEL_MAX, Math.max(WEB_PANEL_MIN, startW + dx));
      setWebWidth(next);
      window.dispatchEvent(new Event('webview-bounds-update'));
    };
    const onUp = () => {
      setResizing(false);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [webWidth]);

  // 드래그 종료 시 저장
  useEffect(() => {
    if (!resizing) localStorage.setItem(WEB_PANEL_STORAGE, String(webWidth));
  }, [resizing, webWidth]);

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
    if (!window.confirm(`${vendorName} ${job.sequence}차 작업을 완료 처리하시겠습니까?`)) return;
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
  }, [job, onJobUpdated, vendorName]);

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
          <span className="work-detail-header__vendor" title={`vendor id: ${job.vendor}`}>{vendorName}</span>
          <span className="work-detail-header__sep">·</span>
          <span>{job.date}</span>
          <span className="work-detail-header__sep">·</span>
          <span className="work-detail-header__seq">{job.sequence}차</span>
          {job.completed && <span className="work-detail-header__completed">✓ 완료</span>}
        </div>
        <div className="work-detail-header__stepper">
          <PhaseStepper job={job} />
        </div>
        <button
          type="button"
          className="btn btn--secondary work-detail-header__webtoggle"
          onClick={onToggleWeb}
          title={webOpen ? '웹뷰 닫기' : '웹뷰 펼치기'}
          aria-expanded={webOpen}
        >
          {webOpen ? '🌐 웹뷰 ▶' : '🌐 웹뷰 ◀'}
        </button>
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

      <div className="work-stack__body">
        <section className="work-main">
          <WorkView
            vendor={vendor}
            job={job}
            onCloseWork={onShowWeb}
            onJobUpdated={onJobUpdated}
          />
        </section>

        <aside
          className={`web-panel${webOpen ? ' web-panel--open' : ''}${animated && !resizing ? ' web-panel--animated' : ''}`}
          style={{ width: webOpen ? `${webWidth}px` : '0px' }}
          aria-hidden={!webOpen}
        >
          {webOpen && (
            <div
              className="web-panel__resizer"
              onPointerDown={startResize}
              role="separator"
              aria-orientation="vertical"
              title="드래그해서 너비 조정"
            />
          )}
          <div className="web-panel__inner">
            <WebView vendor={vendor} isActive={webOpen} />
          </div>
        </aside>
      </div>
    </div>
  );
}
