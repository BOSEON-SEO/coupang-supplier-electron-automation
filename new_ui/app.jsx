// Top-level App
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentHue": 250,
  "density": "comfortable",
  "showLogPanel": true,
  "vendorColored": true,
  "appName": "Inbound Ops"
}/*EDITMODE-END*/;

function VendorMenu({ vendors, selected, onSelect }) {
  const [open, setOpen] = useStateA(false);
  const v = vendors.find(x => x.id === selected) || vendors[0];
  return (
    <div style={{position:'relative'}}>
      <button className="vendor-pill" onClick={() => setOpen(!open)}>
        <span className="swatch" style={{background: v.color}}>{v.initial}</span>
        <span>{v.name}</span>
        <span className="mono" style={{color:'var(--text-3)', fontSize:10}}>({v.id})</span>
        <I.ChevronD size={12} stroke="var(--text-3)"/>
      </button>
      {open && (
        <>
          <div style={{position:'fixed', inset:0, zIndex:30}} onClick={() => setOpen(false)}/>
          <div style={{position:'absolute', top:'calc(100% + 4px)', right:0, minWidth:220, background:'var(--bg-elev)', border:'1px solid var(--border-strong)', borderRadius:6, boxShadow:'var(--shadow-md)', zIndex:31, padding:4}}>
            {vendors.map(x => (
              <button key={x.id} onClick={() => { onSelect(x.id); setOpen(false); }}
                style={{width:'100%', display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:4, background: x.id === selected ? 'var(--accent-soft)' : 'transparent', color:'var(--text)'}}>
                <span style={{width:22, height:22, borderRadius:4, background: x.color, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700}}>{x.initial}</span>
                <div style={{flex:1, textAlign:'left'}}>
                  <div style={{fontSize:12, fontWeight:600}}>{x.name}</div>
                  <div className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{x.id}</div>
                </div>
                {x.id === selected && <I.Check size={13} stroke="var(--accent)"/>}
              </button>
            ))}
            <div style={{borderTop:'1px solid var(--border-soft)', marginTop:4, padding:4}}>
              <button style={{width:'100%', textAlign:'left', padding:'6px 10px', borderRadius:4, fontSize:11, color:'var(--text-2)', display:'flex', alignItems:'center', gap:8}}><I.Plus size={12}/> 새 벤더 추가</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const { VENDORS } = window.MOCK;
  const [tweaks, setTweak] = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];

  const [view, setView] = useStateA('work'); // calendar | work | settings | plugins
  const [vendor, setVendor] = useStateA('canon');
  const [job, setJob] = useStateA({ vendor: 'canon', date: '2026-04-30', sequence: 1, phase: 3 });
  const [monthOffset, setMonthOffset] = useStateA(0);
  const [webOpen, setWebOpen] = useStateA(true);
  const [webWidth, setWebWidth] = useStateA(420);
  const [showCountdown, setShowCountdown] = useStateA(false);
  const [showWMS, setShowWMS] = useStateA(false);
  const [toasts, setToasts] = useStateA([
    { id: 1, kind: 'ok', title: '운송분배 자동 채움 완료', msg: '4 센터 / 6 lots 적용됨. 안성4 팔레트 2 일부 미할당이 있습니다.' },
  ]);

  // apply tweaks
  useEffectA(() => {
    document.documentElement.style.setProperty('--accent', `oklch(0.55 0.14 ${tweaks.accentHue})`);
    document.documentElement.style.setProperty('--accent-soft', `oklch(0.95 0.03 ${tweaks.accentHue})`);
    document.documentElement.style.setProperty('--accent-strong', `oklch(0.45 0.16 ${tweaks.accentHue})`);
  }, [tweaks.accentHue]);

  // resize webview
  const dragRef = useRefA(null);
  useEffectA(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const w = window.innerWidth - e.clientX;
      setWebWidth(Math.min(1100, Math.max(320, w)));
    };
    const onUp = () => { dragRef.current = false; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const closeToast = (id) => setToasts(t => t.filter(x => x.id !== id));

  const handleConfirm = () => {
    setShowCountdown(true);
  };
  const handleCountdownComplete = () => {
    setShowCountdown(false);
    setToasts(t => [...t, { id: Date.now(), kind: 'ok', title: '발주확정 업로드 완료', msg: '쿠팡 사이트에 12 SKU 반영. 다음 단계: 운송 분배.' }]);
  };

  return (
    <div className="win">
      {/* Window titlebar */}
      <div className="win-titlebar">
        <div className="win-app-name"><span className="dot"/>{tweaks.appName}</div>
        <div className="win-menu">
          <button>파일</button>
          <button>편집</button>
          <button>보기</button>
          <button>창</button>
          <button>도움말</button>
        </div>
        <div className="win-spacer"/>
        <span className="mono" style={{fontSize:10, color:'#71717A'}}>v1.4.0 · 최신</span>
        <div className="win-controls">
          <button><I.Min size={12}/></button>
          <button><I.Maximize size={11}/></button>
          <button className="close"><I.Close size={12}/></button>
        </div>
      </div>

      <div className="win-body">
        {/* Sidebar */}
        <div className="sidebar">
          <button className={'nav-item' + (view === 'calendar' ? ' active' : '')} onClick={() => setView('calendar')}>
            <I.Calendar size={18}/><span className="label">달력</span>
          </button>
          <button className={'nav-item' + (view === 'work' ? ' active' : '')} onClick={() => setView('work')}>
            <I.Briefcase size={18}/><span className="label">작업</span>
          </button>
          <div className="sidebar-divider"/>
          <button className={'nav-item' + (view === 'settings' ? ' active' : '')} onClick={() => setView('settings')}>
            <I.Settings size={18}/><span className="label">설정</span>
          </button>
          <button className={'nav-item' + (view === 'plugins' ? ' active' : '')} onClick={() => setView('plugins')}>
            <I.Plug size={18}/><span className="label">플러그인</span>
          </button>
          <div className="sidebar-spacer"/>
          <button className="nav-item" style={{position:'relative'}}>
            <I.Bell size={16}/>
            <span style={{position:'absolute', top:8, right:8, width:6, height:6, borderRadius:'50%', background:'var(--danger)'}}/>
          </button>
          <div className="sidebar-status">
            <div style={{color:'#5EBC78', fontWeight:600, marginBottom:2}}>● 연결됨</div>
            <div className="mono">14:27</div>
          </div>
        </div>

        {/* Main area */}
        <div className="work-area">
          <div className="main-col">
            {/* Header */}
            <div className="header">
              <h1>
                {view === 'calendar' && '작업 달력'}
                {view === 'work' && '작업 처리'}
                {view === 'settings' && '설정'}
                {view === 'plugins' && '플러그인'}
              </h1>
              {view === 'work' && (
                <div className="crumb">
                  <span className="sep">/</span>
                  <span>{VENDORS.find(v => v.id === job.vendor)?.name}</span>
                  <span className="sep">/</span>
                  <span className="mono">{job.date.replace(/-/g,'.')}</span>
                  <span className="sep">/</span>
                  <span>{job.sequence}차</span>
                </div>
              )}
              <div className="header-spacer"/>
              <span className="badge ok"><span style={{width:6,height:6,borderRadius:'50%',background:'currentColor', display:'inline-block'}}/> Python 런타임</span>
              <span className="badge"><I.RefreshCw size={11}/> 동기화 OK</span>
              <div style={{width:1, height:18, background:'var(--border)'}}/>
              <VendorMenu vendors={VENDORS} selected={vendor} onSelect={setVendor}/>
              <button className="icon-btn"><I.User size={15}/></button>
            </div>

            {view === 'calendar' && (
              <window.Calendar
                onOpenJob={(j) => { setJob(j); setView('work'); }}
                monthOffset={monthOffset}
                setMonthOffset={setMonthOffset}
              />
            )}
            {view === 'work' && (
              <window.WorkView
                job={job}
                onBack={() => setView('calendar')}
                onOpenWeb={() => setWebOpen(!webOpen)}
                onOpenCountdown={handleConfirm}
                onOpenWMS={() => setShowWMS(true)}
                webOpen={webOpen}
              />
            )}
            {view === 'settings' && <window.SettingsView/>}
            {view === 'plugins' && <window.PluginsView/>}
          </div>

          {/* Webview slide panel */}
          <div className={'web-panel' + (webOpen ? '' : ' collapsed')} style={{width: webOpen ? webWidth : 0}}>
            <div className="web-panel-resize" onMouseDown={() => { dragRef.current = true; document.body.style.cursor = 'ew-resize'; }}/>
            <div className="web-panel-head">
              <span style={{display:'inline-flex', gap:3}}>
                <I.ChevronL size={14} stroke="#71717A"/>
                <I.Chevron size={14} stroke="#71717A"/>
                <I.RefreshCw size={13} stroke="#71717A"/>
              </span>
              <div className="url">https://supplier.example-portal.kr/po/confirm</div>
              <button className="icon-btn" style={{color:'#A1A1AA'}} onClick={() => setWebOpen(false)}><I.X size={13}/></button>
            </div>
            <div className="web-panel-body">
              <window.WebviewMock/>
            </div>
          </div>
        </div>
      </div>

      {showCountdown && <window.CountdownModal onCancel={() => setShowCountdown(false)} onComplete={handleCountdownComplete}/>}
      {showWMS && <window.WMSUploadModal onClose={() => setShowWMS(false)}/>}
      <window.ToastStack toasts={toasts} onClose={closeToast}/>

      {/* Tweaks panel */}
      {window.TweaksPanel && (
        <window.TweaksPanel>
          <window.TweakSection title="외관">
            <window.TweakSlider label="액센트 색상 (oklch hue)" value={tweaks.accentHue} min={0} max={360} step={1} onChange={(v) => setTweak('accentHue', v)}/>
            <window.TweakRadio label="밀도" value={tweaks.density} options={[{value:'compact', label:'촘촘'},{value:'comfortable', label:'기본'},{value:'spacious', label:'여유'}]} onChange={(v) => setTweak('density', v)}/>
            <window.TweakToggle label="벤더 색상 적용" value={tweaks.vendorColored} onChange={(v) => setTweak('vendorColored', v)}/>
          </window.TweakSection>
          <window.TweakSection title="레이아웃">
            <window.TweakToggle label="작업 로그 패널" value={tweaks.showLogPanel} onChange={(v) => setTweak('showLogPanel', v)}/>
            <window.TweakText label="앱 이름" value={tweaks.appName} onChange={(v) => setTweak('appName', v)}/>
          </window.TweakSection>
          <window.TweakSection title="시뮬레이션">
            <window.TweakButton label="발주확정 카운트다운 열기" onClick={() => setShowCountdown(true)}/>
            <window.TweakButton label="WMS 업로드 모달 열기" onClick={() => setShowWMS(true)}/>
            <window.TweakButton label="에러 토스트 띄우기" onClick={() => setToasts(t => [...t, { id: Date.now(), kind: 'err', title: '쿠팡 로그인 실패', msg: '세션이 만료되었습니다. 다시 로그인하세요.' }])}/>
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
