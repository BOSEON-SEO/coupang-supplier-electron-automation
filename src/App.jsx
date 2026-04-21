import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import CalendarView from './components/CalendarView';
import WorkDetailView from './components/WorkDetailView';
import VendorSelector from './components/VendorSelector';
import ToastContainer from './components/Toast';
import SettingsView from './components/SettingsView';
import FindBar from './components/FindBar';

export default function App() {
  // 헤더 벤더 (로그인·웹뷰 partition 용 — 작업 컨텍스트와 별개)
  const [vendor, setVendor] = useState('');

  // 메인 view: 'calendar' | 'work' | 'settings'
  const [view, setView] = useState('calendar');

  // 활성 작업 (vendor + date + sequence + manifest)
  const [activeJob, setActiveJob] = useState(null);

  // 작업 패널 토글 — 항상 닫힌 채로 시작
  const [workOpen, setWorkOpen] = useState(false);

  // 패널/뷰 전환 시 매 프레임 WCV bounds 갱신
  useEffect(() => {
    const start = performance.now();
    let rafId = 0;
    const tick = (now) => {
      if (now - start > 400) return;
      window.dispatchEvent(new Event('webview-bounds-update'));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [workOpen, view]);

  // Ctrl+F 는 FindBar 가 직접 window keydown 으로 처리. App 에서는 별도 작업 없음.

  // 벤더 목록 (자식 컴포넌트가 사용)
  const [vendors, setVendors] = useState([]);
  const reloadVendors = useCallback(async () => {
    const data = await window.electronAPI?.loadVendors();
    setVendors(data?.vendors ?? []);
  }, []);
  useEffect(() => { reloadVendors(); }, [reloadVendors]);

  // ── Toast 알림 ─────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── PO 다운로드 완료 감지: 작업 패널 자동 열기 + 토스트 ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPythonDone) return;
    const unsub = api.onPythonDone((data) => {
      const name = data?.scriptName || '';
      if (!name.includes('po_download.py')) return;

      if (data.killed) {
        showToast({ type: 'warn', text: 'PO 다운로드가 취소되었습니다.' });
      } else if (data.exitCode === 0) {
        setWorkOpen(true);
        showToast({ type: 'success', text: 'PO 다운로드가 완료되었습니다.' });
      } else {
        showToast({
          type: 'error',
          text: `PO 다운로드 실패 (exitCode=${data.exitCode ?? '?'})`,
          duration: 6000,
        });
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [showToast]);

  const handleOpenJob = (job, opts) => {
    setActiveJob(job);
    // 작업의 벤더로 헤더 벤더 동기화 (WCV partition + 자동 로그인)
    if (job?.vendor && job.vendor !== vendor) setVendor(job.vendor);
    // 새로 만든 작업이면 작업 패널은 접은 채로 시작 (PO 다운로드 지켜보게)
    if (opts?.isNew) setWorkOpen(false);
    setView('work');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">쿠팡 서플라이어 자동화</h1>
        <VendorSelector value={vendor} onChange={setVendor} />
      </header>

      <div className="app-body">
        <Sidebar
          activeView={view}
          onChange={setView}
          workActive={!!activeJob}
        />

        <main className="app-main">
          {/* 달력 view */}
          <div style={{ display: view === 'calendar' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
            <CalendarView
              vendors={vendors}
              activeVendor={vendor}
              onOpenJob={handleOpenJob}
            />
          </div>

          {/* 작업 view (WCV 항상 마운트 유지) */}
          <div
            style={{
              display: view === 'work' ? 'flex' : 'none',
              flex: 1, minHeight: 0,
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            className="app-main--stack"
          >
            <WorkDetailView
              job={activeJob}
              vendor={vendor}
              workOpen={workOpen}
              onToggleWork={() => setWorkOpen((o) => !o)}
              onCloseWork={() => setWorkOpen(false)}
              onJobUpdated={(updated) => setActiveJob(updated)}
              onBackToCalendar={() => setView('calendar')}
            />
          </div>

          {/* 설정 view */}
          {view === 'settings' && <SettingsView activeVendor={vendor} />}
        </main>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <FindBar />
    </div>
  );
}
