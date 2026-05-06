// v4 single-window shell — no desktop/dock/draggable canvas.
// 메인 윈도우 = 앱 자체. Calendar / PoList / Job 가 main area 를 점유.
// WebView 는 우측 슬라이드 패널, 로그는 하단 collapsible 패널.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { I } from './icons';
import { VENDORS as V_VENDORS, PLUGINS as V_PLUGINS, LOG_LINES as V_LOGS } from './data';
import CalendarV4 from './Calendar';
import PoListView from './PoList';
import JobViewV4 from './JobView';
import { PluginTakeover } from './Plugins';
import SettingsPage from './SettingsPage';
import PluginsPage from './PluginsPage';
import { PluginProvider } from '../core/plugin-host';
import { bootstrapPlugins } from '../core/plugin-loader';
import { resolveEntitlementsFromLicense } from '../core/entitlements';

// 실제 vendors.json 의 {id, name, settings} 를 v4 mockup 의 vendor 모양 ({id, name, color, initial, code})
// 으로 enrich. mockup 컴포넌트는 vendor.color / vendor.initial 등을 직접 참조.
const VENDOR_COLOR_MAP = {
  canon: 'oklch(0.55 0.14 250)',
  epson: 'oklch(0.55 0.16 30)',
  hp:    'oklch(0.55 0.14 150)',
  basic: 'oklch(0.55 0.14 200)',
};
function enrichVendor(v) {
  if (!v) return null;
  return {
    ...v,
    initial: (v.initial || v.name?.slice(0, 1) || v.id?.slice(0, 1) || '?').toUpperCase(),
    color: v.color || VENDOR_COLOR_MAP[v.id] || 'oklch(0.55 0.14 250)',
    code: v.code || (v.id || '').toUpperCase().slice(0, 3),
  };
}

export default function AppV4() {
  // 실 vendors.json 로드. 없을 때만 mockup 데이터로 fallback.
  const [vendors, setVendors] = useState(() => V_VENDORS.map(enrichVendor));
  const [vendor, setVendor] = useState(() => enrichVendor(V_VENDORS[0]));
  const reloadVendors = useCallback(async () => {
    const res = await window.electronAPI?.loadVendors?.();
    const list = Array.isArray(res?.vendors) ? res.vendors.map(enrichVendor).filter(Boolean) : [];
    if (list.length > 0) {
      setVendors(list);
      setVendor((cur) => list.find((v) => v.id === cur?.id) || list[0]);
    }
  }, []);
  useEffect(() => { reloadVendors(); }, [reloadVendors]);

  // 라이선스 + 글로벌 설정 — entitlements 계산 + 플러그인 부트스트랩.
  const [license, setLicense] = useState(null);
  const [globalSettings, setGlobalSettings] = useState({});
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      const [lRes, sRes] = await Promise.all([
        window.electronAPI?.license?.get?.(),
        window.electronAPI?.loadSettings?.(),
      ]);
      if (cancelled) return;
      setLicense(lRes?.license || null);
      setGlobalSettings(sRes?.settings || {});
    };
    loadAll();
    const off = window.electronAPI?.license?.onChanged?.((dto) => setLicense(dto || null));
    const onSettings = () => loadAll();
    window.addEventListener('settings-changed', onSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('settings-changed', onSettings);
      if (typeof off === 'function') off();
    };
  }, []);

  const entitlements = useMemo(() => resolveEntitlementsFromLicense(license), [license]);
  const pluginsEnabled = globalSettings?.pluginsEnabled !== false;
  const effectiveEntitlements = pluginsEnabled ? entitlements : [];
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
      entitlements: effectiveEntitlements,
      currentVendor: vendor?.id || null,
      electronAPI: window.electronAPI,
      perPluginEnabled,
    });
  }, [effectiveEntitlements, vendor?.id, perPluginEnabled]);

  // 옵션: JobView 의 plugin gating UI 용 mock — 실제 hook 동작은 PluginProvider 가 담당.
  const [plugins, setPlugins] = useState(V_PLUGINS);

  // view: { kind: 'calendar' } | { kind: 'po-list', date } | { kind: 'job', job }
  const [view, setView] = useState({ kind: 'calendar' });

  const [pluginTakeoverOpen, setPluginTakeoverOpen] = useState(false);
  const [webviewOpen, setWebviewOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const goCalendar = () => setView({ kind: 'calendar' });
  const goSettings = () => setView({ kind: 'settings' });
  const goPlugins = () => setView({ kind: 'plugins' });

  // webview 는 별도 BrowserWindow — vendor 변경 시 partition 재생성, 가시 상태 동기화.
  useEffect(() => {
    if (!vendor?.id) return;
    window.electronAPI?.webview?.setVendor?.(vendor.id);
  }, [vendor?.id]);

  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api?.onVisibilityChanged) return;
    api.isVisible?.().then((r) => setWebviewOpen(!!r?.visible));
    const off = api.onVisibilityChanged(({ visible }) => setWebviewOpen(!!visible));
    return () => { if (typeof off === 'function') off(); };
  }, []);

  const toggleWebview = useCallback(() => {
    const next = !webviewOpen;
    setWebviewOpen(next);
    window.electronAPI?.webview?.setVisible?.(next);
  }, [webviewOpen]);

  const goCoupangHome = useCallback(() => {
    if (!vendor?.id) { alert('먼저 벤더를 선택하세요.'); return; }
    const api = window.electronAPI?.webview;
    if (!api) return;
    api.setVendor?.(vendor.id);
    api.navigate?.('https://supplier.coupang.com/dashboard/KR');
  }, [vendor?.id]);

  const handleAutoLogin = useCallback(async () => {
    if (!vendor?.id) { alert('먼저 벤더를 선택하세요.'); return; }
    const api = window.electronAPI;
    const cred = await api?.checkCredentials?.(vendor.id);
    if (!cred?.hasId || !cred?.hasPassword) {
      alert('자격증명이 없습니다.\n[설정] 에서 ID/PW 를 먼저 저장하세요.');
      return;
    }
    api?.webview?.setVisible?.(true);
    await api?.runPython?.('scripts/login.py', ['--vendor', vendor.id]);
  }, [vendor?.id]);

  // JobView 가 dispatch 하는 업로드 상태 — 헤더 인디케이터로 사용
  const [uploadStatus, setUploadStatus] = useState(null);
  useEffect(() => {
    const h = (e) => setUploadStatus(e.detail);
    window.addEventListener('app:upload:state', h);
    return () => window.removeEventListener('app:upload:state', h);
  }, []);
  const restoreUpload = () => window.dispatchEvent(new CustomEvent('app:upload:restore'));

  const goPoList = (date) => setView({ kind: 'po-list', date });
  const goJob = (job) => { if (job) setView({ kind: 'job', job }); };

  const onRequestPluginWindow = (kind) => {
    if (kind === 'tbnws-admin') setPluginTakeoverOpen(true);
  };

  return (
    <PluginProvider entitlements={effectiveEntitlements} currentVendor={vendor?.id || null}>
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <span className="dot"/>
          Coupang Inbound
          <span className="mono ver">v4</span>
        </div>

        <div className="app-crumb">
          {view.kind === 'calendar' && <span className="active">달력</span>}
          {view.kind === 'po-list' && (
            <>
              <button className="link" onClick={goCalendar}>달력</button>
              <span className="sep">/</span>
              <span className="active">{view.date} PO</span>
            </>
          )}
          {view.kind === 'job' && (
            <>
              <span style={{color:'var(--text-3)'}}>달력</span>
              <span className="sep">/</span>
              <span style={{color:'var(--text-3)'}}>{view.job.date} PO</span>
              <span className="sep">/</span>
              <span className="active">
                <span className="swatch" style={{background: vendor.color}}/>
                {vendor.name} · {view.job.label}
              </span>
            </>
          )}
        </div>

        <div style={{flex:1}}/>

        {uploadStatus?.active && uploadStatus?.background && (
          <button
            className={'upload-indicator' + (uploadStatus.stage === 'done' ? ' done' : '')}
            onClick={restoreUpload}
            title="진행 모달 다시 열기"
          >
            {uploadStatus.stage === 'done'
              ? <I.CheckCircle size={12} stroke="var(--ok)"/>
              : <span className="upload-spin"/>}
            <span className="upload-indicator-text">
              {uploadStatus.stage === 'done'
                ? '업로드 완료'
                : `${uploadStatus.kind === 'ship' ? '쉽먼트' : uploadStatus.kind === 'milk' ? '밀크런' : '발주확정'} 업로드 진행 중`}
            </span>
            {uploadStatus.batchCount > 0 && uploadStatus.stage !== 'done' && (
              <span className="mono" style={{fontSize:10, color:'var(--text-3)'}}>· lot {uploadStatus.batchCount}개</span>
            )}
          </button>
        )}

        <VendorPicker vendor={vendor} vendors={vendors} onSelect={setVendor} />

        <button className={'hbtn' + (logOpen ? ' active' : '')} onClick={() => setLogOpen(o => !o)} title="실행 로그">
          <I.Terminal size={13}/> 로그
        </button>
        <button className="hbtn" onClick={goCoupangHome} title="쿠팡 서플라이어 홈으로 이동">
          <I.Home size={13}/>
        </button>
        <button className="hbtn" onClick={handleAutoLogin} title={vendor ? `${vendor.id} 자동 로그인` : '자동 로그인'}>
          <I.Key size={13}/>
        </button>
        <button className={'hbtn' + (webviewOpen ? ' active' : '')} onClick={toggleWebview} title="웹뷰 창 토글">
          <I.Globe size={13}/> 웹뷰
        </button>
        <button
          className={'hbtn' + (view.kind === 'plugins' ? ' active' : '')}
          onClick={goPlugins}
          title="플러그인"
        >
          <I.Plug size={13}/> 플러그인
        </button>
      </header>

      <div className="app-body">
        <main className={'app-main' + (pluginTakeoverOpen ? ' locked' : '')}>
          {view.kind === 'calendar' && (
            <CalendarV4
              vendor={vendor}
              vendors={vendors}
              setVendor={(v) => setVendor(typeof v === 'string' ? vendors.find(x => x.id === v) || vendor : v)}
              onOpenDate={goPoList}
              onOpenPlugins={goPlugins}
              onOpenSettings={goSettings}
            />
          )}
          {view.kind === 'po-list' && (
            <PoListView
              vendor={vendor}
              date={view.date}
              onOpenJob={goJob}
              onBack={goCalendar}
              onCreateJob={(ids) => alert(`새 차수 생성 (POC 미구현)\n선택한 미배정 PO ${ids?.length || 0}건: ${(ids || []).join(', ')}`)}
            />
          )}
          {view.kind === 'job' && (
            <JobViewV4
              job={view.job}
              vendor={vendor}
              plugins={plugins}
              onBack={() => goPoList(view.job.date)}
              onRequestPluginWindow={onRequestPluginWindow}
            />
          )}
          {view.kind === 'settings' && (
            <SettingsPage vendor={vendor} onBack={goCalendar} />
          )}
          {view.kind === 'plugins' && (
            <PluginsPage vendor={vendor} onBack={goCalendar} />
          )}

          {pluginTakeoverOpen && (
            <div className="lock-banner">
              <span className="dot"/>
              <I.Plug size={13} stroke="var(--plugin)"/>
              tbnws 어드민 동기화 중 — 플러그인 작업 완료 시 메인 잠금 해제
            </div>
          )}
        </main>

        {/* webview 는 별도 BrowserWindow — 메인 윈도우의 슬라이드 패널 폐기 */}
      </div>

      <footer className={'log-panel' + (logOpen ? ' open' : '')}>
        <div className="log-panel-head">
          <I.Terminal size={12}/>
          실행 로그
          <span className="mono ver">{vendor.name} · tail -f</span>
          <div style={{flex:1}}/>
          <button className="x" onClick={() => setLogOpen(false)}><I.X size={12}/></button>
        </div>
        <div className="log-panel-body">
          {V_LOGS.map((l, i) => (
            <div key={i} className="line">
              <span className="ts">{l.ts}</span>
              <span className={'lvl ' + l.lvl}>[{l.lvl}]</span>
              <span>{l.msg}</span>
            </div>
          ))}
        </div>
      </footer>

      {pluginTakeoverOpen && (
        <PluginTakeover onClose={() => setPluginTakeoverOpen(false)}/>
      )}
    </div>
    </PluginProvider>
  );
}

/**
 * 글로벌 헤더의 벤더 pill — 클릭 시 dropdown 으로 다른 벤더 선택.
 */
function VendorPicker({ vendor, vendors, onSelect }) {
  const [open, setOpen] = useState(false);
  if (!vendor) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="vendor-pill"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'transparent', cursor: 'pointer',
          borderColor: open ? 'var(--accent)' : undefined,
        }}
        title="벤더 변경"
      >
        <span className="swatch" style={{ background: vendor.color }}>{vendor.initial}</span>
        <span>{vendor.name}</span>
        <span className="mono ver">{vendor.id}</span>
        <I.ChevronD size={11} stroke="var(--text-3)" style={{ marginLeft: 2 }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            minWidth: 240, background: 'var(--bg-elev)',
            border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)', zIndex: 31, padding: 4,
          }}>
            {vendors.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => { onSelect(v); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 4,
                  background: v.id === vendor.id ? 'var(--accent-soft)' : 'transparent',
                  color: 'var(--text)', border: 'none', cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => { if (v.id !== vendor.id) e.currentTarget.style.background = 'var(--bg-panel-2)'; }}
                onMouseLeave={(e) => { if (v.id !== vendor.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 4, background: v.color, color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>{v.initial}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{v.name}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{v.id}</div>
                </div>
                {v.id === vendor.id && <I.Check size={13} stroke="var(--accent)" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

