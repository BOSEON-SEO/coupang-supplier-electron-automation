// v4 single-window shell — no desktop/dock/draggable canvas.
// 메인 윈도우 = 앱 자체. Calendar / PoList / Job 가 main area 를 점유.
// WebView 는 우측 슬라이드 패널, 로그는 하단 collapsible 패널, 플러그인은 fullscreen modal.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { I } from './icons';
import { VENDORS as V_VENDORS, PLUGINS as V_PLUGINS, LOG_LINES as V_LOGS } from './data';
import CalendarV4 from './Calendar';
import PoListView from './PoList';
import JobViewV4 from './JobView';
import { PluginManager, PluginTakeover } from './Plugins';

export default function AppV4() {
  const [vendor, setVendor] = useState(V_VENDORS[0]);
  const [plugins, setPlugins] = useState(V_PLUGINS);

  // view: { kind: 'calendar' } | { kind: 'po-list', date } | { kind: 'job', job }
  const [view, setView] = useState({ kind: 'calendar' });

  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [pluginTakeoverOpen, setPluginTakeoverOpen] = useState(false);
  const [webviewOpen, setWebviewOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // 웹뷰 패널 폭 — 드래그로 조정, localStorage 영속
  const WEB_MIN = 320, WEB_MAX = 1100, WEB_DEFAULT = 460;
  const [webWidth, setWebWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('v4WebWidth') || '', 10);
    return Number.isFinite(saved) && saved >= WEB_MIN && saved <= WEB_MAX ? saved : WEB_DEFAULT;
  });
  const [resizingWeb, setResizingWeb] = useState(false);
  useEffect(() => { if (!resizingWeb) localStorage.setItem('v4WebWidth', String(webWidth)); }, [resizingWeb, webWidth]);
  const startResizeWeb = useCallback((e) => {
    e.preventDefault();
    setResizingWeb(true);
    const startX = e.clientX;
    const startW = webWidth;
    const onMove = (ev) => {
      const dx = startX - ev.clientX; // 좌측으로 끌수록 폭 증가
      const next = Math.min(WEB_MAX, Math.max(WEB_MIN, startW + dx));
      setWebWidth(next);
    };
    const onUp = () => {
      setResizingWeb(false);
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

  // JobView 가 dispatch 하는 업로드 상태 — 헤더 인디케이터로 사용
  const [uploadStatus, setUploadStatus] = useState(null);
  useEffect(() => {
    const h = (e) => setUploadStatus(e.detail);
    window.addEventListener('app:upload:state', h);
    return () => window.removeEventListener('app:upload:state', h);
  }, []);
  const restoreUpload = () => window.dispatchEvent(new CustomEvent('app:upload:restore'));

  const goCalendar = () => setView({ kind: 'calendar' });
  const goPoList = (date) => setView({ kind: 'po-list', date });
  const goJob = (job) => { if (job) setView({ kind: 'job', job }); };

  const onRequestPluginWindow = (kind) => {
    if (kind === 'tbnws-admin') setPluginTakeoverOpen(true);
  };

  return (
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

        <div className="vendor-pill">
          <span className="swatch" style={{background: vendor.color}}>{vendor.initial}</span>
          <span>{vendor.name}</span>
          <span className="mono ver">{vendor.id}</span>
        </div>

        <button className={'hbtn' + (logOpen ? ' active' : '')} onClick={() => setLogOpen(o => !o)} title="실행 로그">
          <I.Terminal size={13}/> 로그
        </button>
        <button className={'hbtn' + (webviewOpen ? ' active' : '')} onClick={() => setWebviewOpen(o => !o)} title="웹뷰">
          <I.Globe size={13}/> 웹뷰
        </button>
        <button className="hbtn" onClick={() => setPluginManagerOpen(true)} title="플러그인">
          <I.Plug size={13}/> 플러그인
          <span className="hbtn-badge">{plugins.filter(p => p.enabled).length}</span>
        </button>
      </header>

      <div className="app-body">
        <main className={'app-main' + (pluginTakeoverOpen ? ' locked' : '')}>
          {view.kind === 'calendar' && (
            <CalendarV4
              vendor={vendor}
              setVendor={setVendor}
              onOpenDate={goPoList}
              onOpenPlugins={() => setPluginManagerOpen(true)}
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

          {pluginTakeoverOpen && (
            <div className="lock-banner">
              <span className="dot"/>
              <I.Plug size={13} stroke="var(--plugin)"/>
              tbnws 어드민 동기화 중 — 플러그인 작업 완료 시 메인 잠금 해제
            </div>
          )}
        </main>

        <aside
          className={'web-panel' + (webviewOpen ? ' open' : '') + (resizingWeb ? ' resizing' : '')}
          style={{width: webviewOpen ? webWidth : 0}}
          aria-hidden={!webviewOpen}
        >
          {webviewOpen && (
            <div
              className="web-panel-resizer"
              onPointerDown={startResizeWeb}
              role="separator"
              aria-orientation="vertical"
              title="드래그해서 너비 조정"
            />
          )}
          <div className="web-panel-head">
            <I.ChevronL size={13} stroke="#777"/>
            <I.Chevron size={13} stroke="#777"/>
            <I.RefreshCw size={13} stroke="#777"/>
            <div className="url">supplier.coupang.com/po/confirm</div>
            <button className="x" onClick={() => setWebviewOpen(false)}><I.X size={13}/></button>
          </div>
          <div className="web-panel-body">
            <div style={{padding:18, fontSize:13}}>
              <div style={{fontSize:14, fontWeight:600, marginBottom:8}}>발주 확정 완료 (mock)</div>
              <div style={{color:'var(--text-3)', marginBottom:14}}>벤더 코드: {vendor.code} · partition_{vendor.id}</div>
              <table className="gtable" style={{fontSize:11}}>
                <thead><tr><th>발주번호</th><th>SKU</th><th>수량</th><th>상태</th></tr></thead>
                <tbody>
                  <tr><td className="mono">129868291</td><td className="mono">4549292221</td><td className="num">4</td><td><span className="pill send">OK</span></td></tr>
                  <tr><td className="mono">129868269</td><td className="mono">4549292255</td><td className="num">0</td><td><span className="pill reject">반려</span></td></tr>
                  <tr><td className="mono">129799598</td><td className="mono">4549292062</td><td className="num">192</td><td><span className="pill send">OK</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </aside>
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

      {pluginManagerOpen && (
        <PluginManager plugins={plugins} setPlugins={setPlugins} onClose={() => setPluginManagerOpen(false)}/>
      )}
      {pluginTakeoverOpen && (
        <PluginTakeover onClose={() => setPluginTakeoverOpen(false)}/>
      )}
    </div>
  );
}

