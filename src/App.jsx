import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Sidebar from './components/Sidebar';
import CalendarView from './components/CalendarView';
import WorkDetailView from './components/WorkDetailView';
import VendorSelector from './components/VendorSelector';
import ToastContainer from './components/Toast';
import SettingsView from './components/SettingsView';
import PluginsView from './components/PluginsView';
import FindBar from './components/FindBar';
import { PluginProvider, ViewOutlet } from './core/plugin-host';
import { bootstrapPlugins } from './core/plugin-loader';
import { resolveEntitlements } from './core/entitlements';
import { KNOWN_VIEW_ROLES } from './core/plugin-api';
import { runHook } from './core/plugin-registry';
import { KNOWN_HOOKS } from './core/plugin-api';

export default function App() {
  // 헤더 벤더 (로그인·웹뷰 partition 용 — 작업 컨텍스트와 별개)
  const [vendor, setVendor] = useState('');

  // 메인 view: 'calendar' | 'work' | 'settings'
  const [view, setView] = useState('calendar');

  // 활성 작업 (vendor + date + sequence + manifest)
  const [activeJob, setActiveJob] = useState(null);
  const activeJobRef = useRef(null);
  useEffect(() => { activeJobRef.current = activeJob; }, [activeJob]);

  // 외부에서 manifest 가 갱신됐을 때 (예: 플러그인이 history 추가) 재로드 요청
  useEffect(() => {
    const onReload = async () => {
      const j = activeJobRef.current;
      if (!j) return;
      const api = window.electronAPI;
      const res = await api?.jobs?.loadManifest?.(j.date, j.vendor, j.sequence);
      if (res?.success && res.manifest) setActiveJob(res.manifest);
    };
    window.addEventListener('job:reload', onReload);
    return () => window.removeEventListener('job:reload', onReload);
  }, []);

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

  // ── 전역 설정 (사이드바 메뉴 토글 등) ────────────────────
  const [globalSettings, setGlobalSettings] = useState({});
  const reloadGlobalSettings = useCallback(async () => {
    const res = await window.electronAPI?.loadSettings();
    setGlobalSettings(res?.settings || {});
  }, []);
  useEffect(() => {
    reloadGlobalSettings();
    const onChanged = () => reloadGlobalSettings();
    window.addEventListener('settings-changed', onChanged);
    return () => window.removeEventListener('settings-changed', onChanged);
  }, [reloadGlobalSettings]);
  const pluginsMenuEnabled = !!globalSettings.pluginsMenuEnabled;

  // ── 플러그인 로드 ─────────────────────────────────────────
  // entitlements 는 글로벌 설정(pluginsMenuEnabled) 으로 on/off.
  // perPluginEnabled 는 개별 플러그인 on/off (settings.plugins.<id>.enabled).
  // 설정 변경 → globalSettings 갱신 → 재계산 → useEffect 재실행 → unload + load.
  const entitlements = useMemo(() => resolveEntitlements(globalSettings), [globalSettings]);
  const perPluginEnabled = useMemo(() => {
    const out = {};
    const ps = globalSettings?.plugins || {};
    for (const [id, conf] of Object.entries(ps)) {
      if (conf && conf.enabled === false) out[id] = false;
    }
    return out;
  }, [globalSettings]);
  useEffect(() => {
    bootstrapPlugins({
      entitlements,
      currentVendor: vendor || null,
      electronAPI: window.electronAPI,
      perPluginEnabled,
    });
  }, [entitlements, vendor, perPluginEnabled]);

  // ── Toast 알림 ─────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── 다운로드 완료 감지: PO 는 작업 패널 자동 열기 + 토스트, 서류는 토스트만 ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPythonDone) return;
    const downloadScripts = [
      { suffix: 'po_download.py',            label: 'PO',         openWork: true  },
      { suffix: 'milkrun_docs_download.py',  label: '밀크런 서류', openWork: false },
      { suffix: 'shipment_docs_download.py', label: '쉽먼트 서류', openWork: false },
    ];
    const unsub = api.onPythonDone((data) => {
      const name = data?.scriptName || '';
      const hit = downloadScripts.find((s) => name.includes(s.suffix));
      if (!hit) return;

      if (data.killed) {
        showToast({ type: 'warn', text: `${hit.label} 다운로드가 취소되었습니다.` });
      } else if (data.exitCode === 0) {
        if (hit.openWork) setWorkOpen(true);
        showToast({ type: 'success', text: `${hit.label} 다운로드가 완료되었습니다.` });
        // PO 다운 완료 → 플러그인 po.postprocess 훅 호출 (파일 읽어 Buffer 로).
        if (hit.suffix === 'po_download.py') {
          const job = activeJobRef.current;
          if (job) {
            (async () => {
              try {
                const resolved = await api.resolveJobPath(
                  job.date, job.vendor, job.sequence, 'po.xlsx',
                );
                if (!resolved?.success) return;
                const read = await api.readFile(resolved.path);
                if (!read?.success || !read.data) return;
                await runHook(
                  KNOWN_HOOKS.PO_POSTPROCESS,
                  { buffer: read.data, fileName: 'po.xlsx', job },
                  {
                    currentVendor: job.vendor,
                    entitlements,
                    electronAPI: window.electronAPI,
                  },
                );
              } catch (err) {
                console.warn('[po.postprocess / python] 실패', err);
              }
            })();
          }
        }
      } else {
        showToast({
          type: 'error',
          text: `${hit.label} 다운로드 실패 (exitCode=${data.exitCode ?? '?'})`,
          duration: 6000,
        });
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [showToast, entitlements]);

  const handleOpenJob = (job, opts) => {
    setActiveJob(job);
    // 작업의 벤더로 헤더 벤더 동기화 (WCV partition + 자동 로그인)
    if (job?.vendor && job.vendor !== vendor) setVendor(job.vendor);
    // 새로 만든 작업이면 작업 패널은 접은 채로 시작 (PO 다운로드 지켜보게)
    if (opts?.isNew) setWorkOpen(false);
    setView('work');
  };

  return (
    <PluginProvider entitlements={entitlements} currentVendor={vendor || null}>
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
          pluginsMenuEnabled={pluginsMenuEnabled}
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

          {/* 플러그인 view — 사이드바 토글이 켜져 있을 때만 */}
          {view === 'plugins' && pluginsMenuEnabled && <PluginsView />}
        </main>
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <FindBar />
      {/* 플러그인이 기여하는 전역 모달/오버레이 호스트 */}
      <ViewOutlet role={KNOWN_VIEW_ROLES.APP_OVERLAY} />
    </div>
    </PluginProvider>
  );
}
