// Work view: tabs + grid + log panel
const { useState: useStateW, useEffect: useEffectW, useRef: useRefW } = React;

function PhaseStepper({ phase }) {
  const phases = window.MOCK.PHASES;
  return (
    <div className="phase-stepper">
      {phases.map((p, i) => {
        const idx = i + 1;
        const state = idx < phase ? 'done' : idx === phase ? 'active' : '';
        return (
          <React.Fragment key={p.key}>
            <div className={'phase ' + state}>
              <div className="num">{idx < phase ? <I.Check size={11}/> : idx}</div>
              {p.label}
            </div>
            {i < phases.length - 1 && <div className={'phase-bar' + (idx < phase ? ' done' : '')}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function WorkView({ job, onBack, onOpenWeb, onOpenCountdown, onOpenWMS, webOpen }) {
  const { VENDORS, PO_ROWS, LOG_LINES } = window.MOCK;
  const v = VENDORS.find(x => x.id === job.vendor);
  const [tab, setTab] = useStateW('confirm');
  const [logOpen, setLogOpen] = useStateW(true);
  const [selected, setSelected] = useStateW({ r: 4, c: 'confQty' });
  const [editing, setEditing] = useStateW(null);
  const [search, setSearch] = useStateW('');

  const phase = job.phase || 2;
  const dateLabel = job.date.replace(/-/g, '.').slice(2);

  return (
    <>
      {/* Sub-header for work */}
      <div style={{height:48, background:'var(--bg-elev)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 16px', gap:12, flexShrink:0}}>
        <button className="btn ghost sm" onClick={onBack}><I.ArrowLeft size={14}/> 달력</button>
        <div style={{width:1, height:18, background:'var(--border)'}}/>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <div style={{width:22, height:22, borderRadius:5, background: v.color, color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700}}>{v.initial}</div>
          <div style={{display:'flex', flexDirection:'column', lineHeight:1.2}}>
            <div style={{fontSize:13, fontWeight:600}}>{v.name} <span style={{color:'var(--text-3)', fontWeight:400, fontFamily:'JetBrains Mono'}}>· {dateLabel} · {job.sequence}차</span></div>
            <div style={{fontSize:10, color:'var(--text-3)'}}>job_2026-04-30_canon_01 · auto-saved 14:27</div>
          </div>
        </div>
        <div style={{flex:1, display:'flex', justifyContent:'center'}}>
          <PhaseStepper phase={phase}/>
        </div>
        <button className={'btn sm' + (webOpen ? ' primary' : '')} onClick={onOpenWeb}><I.PanelRight size={14}/> 웹뷰</button>
        <button className="btn primary sm"><I.CheckCircle size={14}/> 작업 완료</button>
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {[
          {k:'po', label:'PO 원본', count: 12, ic: <I.FileText size={14}/>},
          {k:'tbnws', label:'투비 재고조정', count: 8, ic: <I.Layers size={14}/>},
          {k:'confirm', label:'발주확정서', count: 12, ic: <I.CheckCircle size={14}/>},
          {k:'transport', label:'운송 분배', count: 4, ic: <I.Truck size={14}/>},
          {k:'output', label:'결과/출력', count: 6, ic: <I.Download size={14}/>},
        ].map(t => (
          <button key={t.k} className={'tab' + (tab === t.k ? ' active' : '')} onClick={() => setTab(t.k)}>
            {t.ic}{t.label}<span className="count">{t.count}</span>
          </button>
        ))}
        <div className="tabs-spacer"/>
        <button className="tab" style={{color:'var(--accent-strong)', fontWeight:600}}><I.Plug size={14}/>플러그인 <span className="count" style={{background:'var(--accent-soft)', color:'var(--accent-strong)'}}>3</span></button>
      </div>

      {/* Body */}
      {tab === 'transport' ? (
        <window.TransportView onOpenWMS={onOpenWMS}/>
      ) : tab === 'output' ? (
        <window.OutputTab/>
      ) : (
        <>
          {/* Toolbar */}
          <div className="tool-row">
            <div className="search">
              <I.Search size={13}/>
              <input placeholder="SKU, 발주번호, 상품명 검색…" value={search} onChange={e => setSearch(e.target.value)}/>
              <span className="mono" style={{color:'var(--text-3)', fontSize:10, padding:'0 5px', border:'1px solid var(--border)', borderRadius:3}}>⌘F</span>
            </div>
            <div className="filter-chips">
              <button className="chip active">전체 <span className="n">12</span></button>
              <button className="chip">쉽먼트 <span className="n">3</span></button>
              <button className="chip">밀크런 <span className="n">9</span></button>
            </div>
            <div style={{flex:1}}/>
            <button className="btn sm"><I.RefreshCw size={13}/> 새로고침</button>
            <button className="btn sm"><I.Download size={13}/> 다운로드</button>
            {tab === 'confirm' && (
              <>
                <button className="btn sm"><I.Save size={13}/> 저장</button>
                <button className="btn accent sm" onClick={onOpenCountdown}><I.Send size={13}/> 발주확정</button>
                <button className="btn primary sm"><I.Truck size={13}/> 운송분배 자동</button>
              </>
            )}
          </div>

          {/* Grid */}
          <div className="grid-wrap">
            <table className="gtable">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  <th>발주번호</th>
                  <th>물류센터</th>
                  <th>입고유형</th>
                  <th>발주상태</th>
                  <th>상품번호</th>
                  <th>상품바코드</th>
                  <th>상품이름</th>
                  <th style={{textAlign:'right'}}>발주수량</th>
                  <th style={{textAlign:'right'}}>확정수량</th>
                  <th>유통(소비)기한</th>
                  <th>제조일자</th>
                  <th>납품부족사유</th>
                  <th>회송담당자</th>
                  <th>회송담당자 연락처</th>
                  <th>매입가</th>
                </tr>
              </thead>
              <tbody>
                {PO_ROWS.filter(r => !search || `${r.po} ${r.name} ${r.barcode}`.includes(search)).map((r, idx) => {
                  const isPartial = r.confQty > 0 && r.confQty < r.reqQty;
                  const isReject = r.confQty === 0;
                  return (
                    <tr key={r.id}>
                      <td className="row-num">{idx + 2}</td>
                      <td className="mono" style={{fontSize:11}}>{r.po}</td>
                      <td>{r.wh}</td>
                      <td><span className={'pill ' + (r.method === '쉽먼트' ? 'ship' : 'milk')}>{r.method}</span></td>
                      <td><span className="badge">{r.status}</span></td>
                      <td className="mono" style={{fontSize:11, color:'var(--text-2)'}}>{r.sku}</td>
                      <td className="mono" style={{fontSize:11}}>{r.barcode}</td>
                      <td>{r.name}</td>
                      <td className="num">{r.reqQty.toLocaleString()}</td>
                      <td className={'num' + (selected.r === idx && selected.c === 'confQty' ? ' selected' : '') + (editing && editing.r === idx && editing.c === 'confQty' ? ' editing' : '')}
                          onClick={() => setSelected({ r: idx, c: 'confQty' })}
                          onDoubleClick={() => setEditing({ r: idx, c: 'confQty', val: r.confQty })}>
                        {editing && editing.r === idx && editing.c === 'confQty'
                          ? <input autoFocus defaultValue={r.confQty} onBlur={() => setEditing(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null); }}/>
                          : (isReject ? <span style={{color:'var(--danger)', fontWeight:600}}>0</span> : isPartial ? <span style={{color:'var(--warn)', fontWeight:600}}>{r.confQty.toLocaleString()}</span> : r.confQty.toLocaleString())}
                      </td>
                      <td className="mono" style={{fontSize:11}}>{r.exp}</td>
                      <td className="mono" style={{fontSize:11, color: r.mfg ? 'var(--text)' : 'var(--text-3)'}}>{r.mfg || '—'}</td>
                      <td>{r.short ? <span className="pill reject">{r.short}</span> : <span style={{color:'var(--text-3)'}}>—</span>}</td>
                      <td>{r.contact}</td>
                      <td className="mono" style={{fontSize:11}}>{r.tel}</td>
                      <td className="num">₩{r.amt.toLocaleString()}</td>
                    </tr>
                  );
                })}
                {/* empty rows for excel feel */}
                {Array.from({length: 4}).map((_, i) => (
                  <tr key={'e' + i}>
                    <td className="row-num">{PO_ROWS.length + 2 + i}</td>
                    {Array.from({length: 15}).map((_, j) => <td key={j}>&nbsp;</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Log panel */}
      <div className="log-panel" style={{maxHeight: logOpen ? 200 : 28}}>
        <div className="log-head" onClick={() => setLogOpen(!logOpen)}>
          <I.ScrollText size={13}/>
          <span style={{fontWeight:600, color:'#E4E4E7'}}>작업 로그</span>
          <span style={{color:'#52525B'}}>({LOG_LINES.length})</span>
          <div style={{flex:1}}/>
          <span style={{display:'inline-flex', alignItems:'center', gap:4, fontSize:10}}><span style={{width:6, height:6, borderRadius:'50%', background:'var(--ok)'}}/>auto-scroll</span>
          {logOpen ? <I.ChevronD size={13}/> : <I.ChevronU size={13}/>}
        </div>
        {logOpen && (
          <div className="log-body">
            {LOG_LINES.map((l, i) => (
              <div className="line" key={i}>
                <span className="ts">{l.ts}</span>
                <span className={'lvl ' + l.lvl}>[{l.lvl.toUpperCase()}]</span>
                <span className="msg">{l.msg}</span>
              </div>
            ))}
            <div className="line">
              <span className="ts">14:27:39</span>
              <span className="lvl info">[INFO]</span>
              <span className="msg">대기 중<span style={{display:'inline-block', width:6, height:11, background:'#C8C8CC', marginLeft:2, animation:'pulse 1s infinite'}}/></span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function OutputTab() {
  const files = [
    { name: 'po-canon-20260430-01.xlsx', size: '24 KB', kind: 'PO', when: '14:27:16' },
    { name: 'confirmation-canon-20260430-01.xlsx', size: '18 KB', kind: '확정서', when: '14:27:17' },
    { name: 'transport-canon-20260430-01.json', size: '6 KB', kind: '운송분배', when: '14:27:34' },
    { name: 'wms-output-canon-20260430.xlsx', size: '32 KB', kind: 'WMS', when: '14:27:25' },
    { name: 'coupang-export-canon-20260430-01.xlsx', size: '14 KB', kind: '통합 양식', when: '14:27:34', primary: true },
    { name: 'invoice-summary-canon-20260430.csv', size: '2 KB', kind: '송장', when: '14:27:35' },
  ];
  return (
    <div style={{flex:1, overflow:'auto', padding:24, background:'var(--bg-panel-2)'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:16}}>
        <h3 style={{margin:0, fontSize:14, fontWeight:600}}>이번 차수 산출물</h3>
        <span className="badge">{files.length}개 파일</span>
        <div style={{flex:1}}/>
        <button className="btn sm"><I.Copy size={14}/> 폴더 열기</button>
        <button className="btn primary sm"><I.Download size={14}/> 전체 다운로드</button>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
        {files.map(f => (
          <div key={f.name} style={{background:'var(--bg-elev)', border: f.primary ? '1.5px solid var(--accent)' : '1px solid var(--border)', borderRadius:6, padding:14, position:'relative'}}>
            {f.primary && <div style={{position:'absolute', top:-8, right:12, fontSize:10, fontWeight:600, background:'var(--accent)', color:'white', padding:'2px 8px', borderRadius:3, letterSpacing:0.4}}>주력 산출물</div>}
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:8}}>
              <div style={{width:36, height:36, borderRadius:6, background:'var(--bg-panel-2)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent)'}}>
                <I.FileText size={18}/>
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} className="mono">{f.name}</div>
                <div style={{fontSize:10, color:'var(--text-3)'}}>{f.kind} · {f.size} · {f.when}</div>
              </div>
            </div>
            <div style={{display:'flex', gap:6}}>
              <button className="btn sm" style={{flex:1}}><I.Eye size={12}/> 미리보기</button>
              <button className="btn sm" style={{flex:1}}><I.Download size={12}/> 다운</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.WorkView = WorkView;
window.OutputTab = OutputTab;
window.PhaseStepper = PhaseStepper;
