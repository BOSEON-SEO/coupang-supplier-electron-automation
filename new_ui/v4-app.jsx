// v4 main app
const { VENDORS: V4_AVENDORS, PLUGINS: V4_APLUGINS, LOG_LINES: V4_ALOGS } = window.V3;
const { DraggableWindow, PluginWindow, PluginManager, CalendarV4, PoListView, JobViewV4 } = window;

function AppV4() {
  const { useState } = React;
  const [vendor, setVendor] = useState(V4_AVENDORS[0]);
  const [plugins, setPlugins] = useState(V4_APLUGINS);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);

  // Calendar window screens: 'calendar' | 'po-list' for given date
  const [calScreen, setCalScreen] = useState({ kind: 'calendar', date: null });

  const [openJob, setOpenJob] = useState(null);
  const [pluginWinOpen, setPluginWinOpen] = useState(false);
  const [webviewOpen, setWebviewOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);

  const [focusOrder, setFocusOrder] = useState(['cal']);
  const [calPos, setCalPos] = useState({ x: 60, y: 30 });
  const [jobPos, setJobPos] = useState({ x: 110, y: 70 });
  const [pluginPos, setPluginPos] = useState({ x: 200, y: 130 });
  const [wvPos, setWvPos] = useState({ x: 1140, y: 60 });
  const [logPos, setLogPos] = useState({ x: 1140, y: 460 });

  const focus = (id) => setFocusOrder(o => [...o.filter(x => x !== id), id]);
  const z = (id) => 10 + focusOrder.indexOf(id);
  const isFocused = (id) => focusOrder[focusOrder.length - 1] === id;

  const openDate = (date) => {
    setCalScreen({ kind: 'po-list', date });
    focus('cal');
  };
  const backToCal = () => setCalScreen({ kind: 'calendar', date: null });

  const openJobWindow = (job) => {
    if (!job) return;
    setOpenJob(job);
    focus('job');
  };

  const closeJob = () => { setOpenJob(null); setPluginWinOpen(false); };

  const onRequestPluginWindow = (kind) => {
    if (kind === 'tbnws-admin') {
      setPluginWinOpen(true);
      focus('plugin');
    }
  };

  return (
    <div className="desktop">
      <DraggableWindow
        title={<>Coupang Inbound <span className="mono" style={{color:'#71717A', fontWeight:400, fontSize:11, marginLeft:4}}>v4</span></>}
        subtitle={<>{vendor.name}<span className="sep">·</span>{calScreen.kind === 'po-list' ? `${calScreen.date} PO` : '달력'}</>}
        pos={calPos} setPos={setCalPos}
        focused={isFocused('cal')} onFocus={() => focus('cal')}
        zIndex={z('cal')}
        w={1080} h={680}
      >
        {calScreen.kind === 'calendar' ? (
          <CalendarV4 vendor={vendor} setVendor={setVendor} onOpenDate={openDate} onOpenPlugins={() => setPluginManagerOpen(true)}/>
        ) : (
          <PoListView vendor={vendor} date={calScreen.date} onOpenJob={openJobWindow} onBack={backToCal} onCreateJob={() => alert('새 차수 만들기 (미구현)')}/>
        )}
      </DraggableWindow>

      {openJob && (
        <DraggableWindow
          title={<><span className="swatch" style={{background: vendor.color}}/>{vendor.name} · {openJob.label}</>}
          subtitle={<>{openJob.date}<span className="sep">·</span>{openJob.seq}차<span className="sep">·</span>partition_{vendor.id}</>}
          pos={jobPos} setPos={setJobPos}
          focused={isFocused('job')} onFocus={() => focus('job')}
          onClose={closeJob}
          zIndex={z('job')}
          w={1280} h={780}
          locked={pluginWinOpen}
          lockMessage="tbnws 어드민 동기화 중 — 플러그인 창에서 작업 완료 시 잠금 해제"
        >
          <JobViewV4 job={openJob} vendor={vendor} plugins={plugins} onRequestPluginWindow={onRequestPluginWindow}/>
        </DraggableWindow>
      )}

      {pluginWinOpen && (
        <PluginWindow
          pos={pluginPos} setPos={setPluginPos}
          focused={isFocused('plugin')} onFocus={() => focus('plugin')}
          onClose={() => setPluginWinOpen(false)}
          zIndex={z('plugin')}
        />
      )}

      {webviewOpen && (
        <DraggableWindow
          title="쿠팡 발주확정 웹뷰"
          subtitle={<>partition_{vendor.id}<span className="sep">·</span>read-only</>}
          pos={wvPos} setPos={setWvPos}
          focused={isFocused('wv')} onFocus={() => focus('wv')}
          onClose={() => setWebviewOpen(false)}
          zIndex={z('wv')}
          w={580} h={380}
        >
          <div style={{flex:1, display:'flex', flexDirection:'column', background:'white'}}>
            <div className="wv-toolbar">
              <I.ChevronL size={13} stroke="#777"/>
              <I.Chevron size={13} stroke="#777"/>
              <I.RefreshCw size={13} stroke="#777"/>
              <div className="url">supplier.coupang.com/po/confirm</div>
            </div>
            <div className="wv-mock">
              <div style={{fontSize:14, fontWeight:600, marginBottom:8}}>발주 확정 완료</div>
              <div style={{color:'#666'}}>벤더 코드: CAN · 처리: 10 / 12</div>
              <table className="wv-mock-table">
                <thead><tr><th>발주번호</th><th>SKU</th><th>수량</th><th>상태</th></tr></thead>
                <tbody>
                  <tr><td className="mono">129868291</td><td>4549292221</td><td>4</td><td style={{color:'#5EBC78'}}>OK</td></tr>
                  <tr><td className="mono">129868269</td><td>4549292255</td><td>0</td><td style={{color:'#C42B1C'}}>반려</td></tr>
                  <tr><td className="mono">129799598</td><td>4549292062</td><td>192</td><td style={{color:'#5EBC78'}}>OK</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </DraggableWindow>
      )}

      {logOpen && (
        <DraggableWindow
          title="실행 로그"
          subtitle={<>{vendor.name}<span className="sep">·</span>tail -f</>}
          pos={logPos} setPos={setLogPos}
          focused={isFocused('log')} onFocus={() => focus('log')}
          onClose={() => setLogOpen(false)}
          zIndex={z('log')}
          w={580} h={220}
        >
          <div className="log-body">
            {V4_ALOGS.map((l, i) => (
              <div key={i} className="line">
                <span className="ts">{l.ts}</span>
                <span className={'lvl ' + l.lvl}>[{l.lvl}]</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </DraggableWindow>
      )}

      {pluginManagerOpen && <PluginManager plugins={plugins} setPlugins={setPlugins} onClose={() => setPluginManagerOpen(false)}/>}

      <div className="dock">
        <div className="app-id"><span className="dot"/> Coupang Inbound</div>
        <div className={'win-tab ' + (isFocused('cal') ? 'focused' : '')} onClick={() => focus('cal')}>
          <I.Calendar size={11}/>
          <span className="text">달력 · {vendor.name}</span>
        </div>
        {openJob && (
          <div className={'win-tab ' + (isFocused('job') ? 'focused' : '')} onClick={() => focus('job')}>
            <span className="swatch" style={{background: vendor.color}}/>
            <span className="text">{vendor.name} · {openJob.label}</span>
          </div>
        )}
        {pluginWinOpen && (
          <div className={'win-tab ' + (isFocused('plugin') ? 'focused' : '')} onClick={() => focus('plugin')}>
            <span className="swatch" style={{background:'var(--plugin)'}}/>
            <span className="text">tbnws 동기화</span>
          </div>
        )}
        <div className={'win-tab ' + (isFocused('wv') ? 'focused' : '')} onClick={() => { if (webviewOpen) focus('wv'); else setWebviewOpen(true); }} style={{opacity: webviewOpen ? 1 : 0.5}}>
          <I.Globe size={11}/><span className="text">웹뷰</span>
        </div>
        <div className={'win-tab ' + (isFocused('log') ? 'focused' : '')} onClick={() => { if (logOpen) focus('log'); else setLogOpen(true); }} style={{opacity: logOpen ? 1 : 0.5}}>
          <I.Terminal size={11}/><span className="text">로그</span>
        </div>
        <div className="dock-spacer"/>
        <div className="dock-tray">
          <span><span className="pulse" style={{display:'inline-block', marginRight:5, verticalAlign:'middle'}}/>활성 {plugins.filter(p => p.enabled).length}</span>
          <span>v4.0.0</span>
          <span>2026-05-06 14:39</span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AppV4/>);
