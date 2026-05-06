// v2 main app — split workflow with windowed UX
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { VENDOR, ACTIVE_JOB, ROWS: INITIAL_ROWS, SHIP_INBOX: INIT_SHIP, MILK_INBOX: INIT_MILK, HISTORY, JOBS, LOG_LINES } = window.V2;

// ===== ROLE STEPPER =====
const STEPS = [
  { key: 'review',  role: '경영지원', name: '검토',         desc: '행 단위 OK/반려' },
  { key: 'confirm', role: '물류',     name: '확정 + 방법',   desc: '운송방법 결정' },
  { key: 'upload',  role: '물류',     name: '확정 업로드',   desc: '쿠팡 사이트' },
  { key: 'ship',    role: '운송',     name: '쉽먼트 인박스', desc: '박스 lot' },
  { key: 'milk',    role: '운송',     name: '밀크런 인박스', desc: '팔레트 lot' },
  { key: 'history', role: '전체',     name: '결과',         desc: '히스토리/다운' },
];

function RoleStepper({ current, onJump, counts }) {
  const idx = STEPS.findIndex(s => s.key === current);
  return (
    <div className="role-stepper">
      {STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'active' : '';
        const c = counts[s.key];
        return (
          <div key={s.key} className={'role-step ' + state} onClick={() => onJump(s.key)}>
            <div className="num">{i < idx ? <I.Check size={14}/> : i + 1}</div>
            <div className="info">
              <div className="role-label">{s.role}</div>
              <div className="step-name">
                {s.name}
                {c != null && <span className="badge" style={{marginLeft:6, fontSize:10}}>{c}</span>}
              </div>
            </div>
            <div className="connector"/>
          </div>
        );
      })}
    </div>
  );
}

// ===== SIDEBAR =====
function Sidebar({ current, onJump, counts, vendor, onOpenWeb, onOpenLog, webOpen, logOpen }) {
  return (
    <div className="sidebar">
      <div className="sb-vendor">
        <div className="swatch" style={{background: vendor.color}}>{vendor.initial}</div>
        <div style={{flex:1, minWidth:0}}>
          <div className="name">{vendor.name}</div>
          <div className="id">partition_{vendor.id}</div>
        </div>
        <I.ChevronD size={12} stroke="#71717A"/>
      </div>

      <div className="sb-section-label">현재 차수 · 2026-05-06 1차</div>
      {STEPS.map((s, i) => {
        const c = counts[s.key];
        const isInbox = s.key === 'ship' || s.key === 'milk';
        const klass = isInbox && c > 0 ? (c >= 6 ? 'urgent' : 'warn') : '';
        return (
          <button key={s.key} className={'sb-item ' + klass + (current === s.key ? ' active' : '')} onClick={() => onJump(s.key)}>
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span className="label">{s.name}</span>
            {c != null && <span className="badge">{c}</span>}
          </button>
        );
      })}

      <div className="sb-divider"/>
      <div className="sb-section-label">최근 차수</div>
      {JOBS.map(j => (
        <button key={j.date + j.seq} className="sb-item">
          <span className="num">·</span>
          <span className="label" style={{fontSize:11}}>{j.label}</span>
          {j.state === 'active' && <span style={{width:6, height:6, borderRadius:'50%', background:'var(--accent)'}}/>}
          {j.state === 'shipped' && <I.Check size={11} stroke="var(--ok)"/>}
        </button>
      ))}

      <div className="sb-divider"/>
      <div className="sb-section-label">창</div>
      <button className={'sb-item' + (webOpen ? ' active' : '')} onClick={onOpenWeb}>
        <span className="num"><I.Globe size={13}/></span>
        <span className="label">웹뷰</span>
        <span style={{width:6, height:6, borderRadius:'50%', background: webOpen ? 'var(--ok)' : '#52525B'}}/>
      </button>
      <button className={'sb-item' + (logOpen ? ' active' : '')} onClick={onOpenLog}>
        <span className="num"><I.ScrollText size={13}/></span>
        <span className="label">작업 로그</span>
        <span style={{width:6, height:6, borderRadius:'50%', background: logOpen ? 'var(--ok)' : '#52525B'}}/>
      </button>

      <div style={{flex:1}}/>
      <div className="sb-divider"/>
      <button className="sb-item">
        <span className="num"><I.Settings size={13}/></span>
        <span className="label">설정</span>
      </button>
      <button className="sb-item">
        <span className="num"><I.Plug size={13}/></span>
        <span className="label">플러그인</span>
        <span className="badge">3</span>
      </button>
    </div>
  );
}

// ===== S1: REVIEW (경영지원) =====
function ReviewView({ rows, setRows, onNext }) {
  const [search, setSearch] = useState('');
  const filt = rows.filter(r => !search || `${r.po} ${r.name} ${r.barcode}`.includes(search));
  const reviewedCount = rows.filter(r => r.reviewed).length;
  const rejectedCount = rows.filter(r => r.confQty === 0 || r.short).length;
  const okCount = rows.filter(r => r.confQty > 0).length;

  const setQty = (id, q) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: q, reviewed: true, short: q === 0 ? (r.short || '협력사 재고') : '' } : r));
  const reject = (id) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: 0, short: '협력사 재고', reviewed: true } : r));
  const accept = (id) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: r.reqQty, short: '', reviewed: true } : r));

  return (
    <div className="view-wrap">
      <div className="summary-row">
        <div className="stat"><div className="lbl">전체 행</div><div className="val">{rows.length}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">납품 가능</div><div className="val" style={{color:'var(--ok)'}}>{okCount}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">반려</div><div className="val" style={{color:'var(--danger)'}}>{rejectedCount}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">검토 완료</div><div className="val">{reviewedCount}<span className="u">/ {rows.length}</span></div></div>
      </div>

      <div className="tool-row">
        <div className="search">
          <I.Search size={13} stroke="var(--text-3)"/>
          <input placeholder="발주번호, 상품명, 바코드 검색…" value={search} onChange={e => setSearch(e.target.value)}/>
          <kbd>⌘F</kbd>
        </div>
        <div style={{display:'flex', gap:4}}>
          <button className="chip active">전체 <span className="n">{rows.length}</span></button>
          <button className="chip">미검토 <span className="n">{rows.length - reviewedCount}</span></button>
          <button className="chip">반려 <span className="n">{rejectedCount}</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm"><I.Download size={13}/> PO 다시 받기</button>
        <button className="btn primary" disabled={reviewedCount < rows.length} onClick={onNext}>
          검토 완료 <I.ArrowRight size={13}/>
        </button>
      </div>

      <div className="grid-wrap">
        <table className="gtable">
          <thead>
            <tr>
              <th className="row-num">#</th>
              <th>발주번호</th>
              <th>물류센터</th>
              <th>바코드</th>
              <th>상품명</th>
              <th style={{textAlign:'right'}}>발주</th>
              <th style={{textAlign:'right'}}>확정</th>
              <th>반려사유</th>
              <th style={{textAlign:'right'}}>매입가</th>
              <th style={{width:140, textAlign:'center'}}>판단</th>
            </tr>
          </thead>
          <tbody>
            {filt.map((r, i) => {
              const isReject = r.confQty === 0;
              return (
                <tr key={r.id} className={isReject ? 'rejected' : ''}>
                  <td className="row-num">{i + 1}</td>
                  <td className="mono" style={{fontSize:11}}>{r.po}</td>
                  <td>{r.wh}</td>
                  <td className="mono" style={{fontSize:11}}>{r.barcode}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.reqQty}</td>
                  <td className="num">
                    <input type="number" value={r.confQty} onChange={e => setQty(r.id, Math.max(0, Math.min(r.reqQty, +e.target.value)))}
                      style={{width:60, padding:'2px 6px', border:'1px solid var(--border)', borderRadius:3, fontFamily:'JetBrains Mono', fontSize:11, textAlign:'right', background: r.confQty < r.reqQty && r.confQty > 0 ? 'var(--warn-soft)' : 'white'}}/>
                  </td>
                  <td>{r.short ? <span className="pill reject">{r.short}</span> : <span style={{color:'var(--text-3)'}}>—</span>}</td>
                  <td className="num">₩{r.amt.toLocaleString()}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'inline-flex', gap:4}}>
                      <button className={'btn sm' + (r.confQty > 0 ? ' accent' : '')} onClick={() => accept(r.id)} style={{height:22, padding:'0 8px', fontSize:10}}>OK</button>
                      <button className={'btn sm' + (isReject ? ' danger' : '')} onClick={() => reject(r.id)} style={{height:22, padding:'0 8px', fontSize:10}}>반려</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== S2: CONFIRM + METHOD (물류) =====
function ConfirmView({ rows, setRows, onUpload }) {
  const acceptedRows = rows.filter(r => r.confQty > 0);
  const [selected, setSelected] = useState(new Set());
  const allSel = selected.size === acceptedRows.length && acceptedRows.length > 0;
  const someSel = selected.size > 0 && !allSel;

  const setMethod = (ids, method) => setRows(rs => rs.map(r => ids.includes(r.id) ? { ...r, method } : r));
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(acceptedRows.map(r => r.id)));

  const shipCount = acceptedRows.filter(r => r.method === 'ship').length;
  const milkCount = acceptedRows.filter(r => r.method === 'milk').length;
  const unsetCount = acceptedRows.filter(r => !r.method).length;
  const shipQty = acceptedRows.filter(r => r.method === 'ship').reduce((s, r) => s + r.confQty, 0);
  const milkQty = acceptedRows.filter(r => r.method === 'milk').reduce((s, r) => s + r.confQty, 0);

  return (
    <div className="view-wrap">
      <div className="summary-row">
        <div className="stat"><div className="lbl">확정 대상</div><div className="val">{acceptedRows.length}<span className="u">행 / {acceptedRows.reduce((s,r)=>s+r.confQty,0).toLocaleString()}개</span></div></div>
        <div className="stat"><div className="lbl">쉽먼트</div><div className="val" style={{color:'var(--ship)'}}>{shipCount}<span className="u">행 · {shipQty.toLocaleString()}개</span></div></div>
        <div className="stat"><div className="lbl">밀크런</div><div className="val" style={{color:'var(--milk)'}}>{milkCount}<span className="u">행 · {milkQty.toLocaleString()}개</span></div></div>
        <div className="stat"><div className="lbl">미지정</div><div className="val" style={{color: unsetCount > 0 ? 'var(--warn)' : 'var(--ok)'}}>{unsetCount}<span className="u">행</span></div></div>
      </div>

      <div className="tool-row">
        <span style={{fontSize:11, color:'var(--text-3)'}}>선택: <strong className="mono" style={{color:'var(--text)'}}>{selected.size}</strong></span>
        <div style={{display:'flex', gap:4}}>
          <button className="btn sm" disabled={!selected.size} onClick={() => setMethod([...selected], 'ship')} style={{borderColor:'var(--ship)', color:'var(--ship)'}}>
            <I.Box size={13}/> 일괄 → 쉽먼트
          </button>
          <button className="btn sm" disabled={!selected.size} onClick={() => setMethod([...selected], 'milk')} style={{borderColor:'var(--milk)', color:'var(--milk)'}}>
            <I.Pallet size={13}/> 일괄 → 밀크런
          </button>
        </div>
        <div style={{width:1, height:18, background:'var(--border)'}}/>
        <button className="btn sm" onClick={() => {
          // 자동 추천: 수량 ≥ 24 → 밀크런, 그 외 쉽먼트
          setRows(rs => rs.map(r => r.confQty > 0 ? { ...r, method: r.confQty >= 24 ? 'milk' : 'ship' } : r));
        }}><I.Zap size={13}/> 자동 추천</button>
        <div style={{flex:1}}/>
        <button className="btn primary" disabled={unsetCount > 0} onClick={onUpload}>
          <I.Send size={13}/> 발주확정 업로드 ({acceptedRows.length})
        </button>
      </div>

      <div className="grid-wrap">
        <table className="gtable">
          <thead>
            <tr>
              <th className="check-col">
                <div className={'cb ' + (allSel ? 'on' : someSel ? 'partial' : '')} onClick={toggleAll}>
                  {allSel ? <I.Check size={11}/> : someSel ? <I.Min size={11}/> : null}
                </div>
              </th>
              <th className="row-num">#</th>
              <th>발주번호</th>
              <th>물류센터</th>
              <th>바코드</th>
              <th>상품명</th>
              <th style={{textAlign:'right'}}>확정</th>
              <th style={{textAlign:'center', width:140}}>운송방법</th>
              <th>복합키</th>
            </tr>
          </thead>
          <tbody>
            {acceptedRows.map((r, i) => {
              const sel = selected.has(r.id);
              return (
                <tr key={r.id} className={sel ? 'selected' : ''}>
                  <td className="check-col">
                    <div className={'cb ' + (sel ? 'on' : '')} onClick={() => toggle(r.id)}>
                      {sel && <I.Check size={11}/>}
                    </div>
                  </td>
                  <td className="row-num">{i + 1}</td>
                  <td className="mono" style={{fontSize:11}}>{r.po}</td>
                  <td>{r.wh}</td>
                  <td className="mono" style={{fontSize:11}}>{r.barcode}</td>
                  <td>{r.name}</td>
                  <td className="num">{r.confQty}</td>
                  <td style={{textAlign:'center'}}>
                    <div className="method-toggle">
                      <button className={r.method === 'ship' ? 'active ship' : ''} onClick={() => setMethod([r.id], 'ship')}>쉽먼트</button>
                      <button className={r.method === 'milk' ? 'active milk' : ''} onClick={() => setMethod([r.id], 'milk')}>밀크런</button>
                    </div>
                    {!r.method && <div style={{fontSize:10, color:'var(--warn)', marginTop:2}}>지정 필요</div>}
                  </td>
                  <td className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{r.wh}/{r.po}/{r.barcode}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== S3: UPLOAD AUTOMATION =====
function UploadModal({ stage, onClose, vendor }) {
  const steps = [
    { k: 'login', label: '쿠팡 사이트 로그인', detail: `partition: ${vendor.id}` },
    { k: 'navigate', label: '발주확정 화면 진입', detail: '/po/confirm' },
    { k: 'upload', label: '확정서 업로드', detail: '10 rows · 2 rejected' },
    { k: 'verify', label: '결과 확인', detail: 'POST 200 OK' },
    { k: 'route', label: '인박스 라우팅', detail: 'ship +4 · milk +6' },
  ];
  const idx = stage === 'countdown' ? -1 : stage === 'login' ? 0 : stage === 'navigate' ? 1 : stage === 'upload' ? 2 : stage === 'verify' ? 3 : stage === 'route' ? 4 : 5;

  return (
    <div className="auto-overlay">
      <div className="auto-modal">
        {stage === 'countdown' ? (
          <CountdownInner onClose={onClose}/>
        ) : (
          <>
            <div className="auto-head">
              <h3><I.Loader size={14} stroke="var(--accent)"/>쿠팡 사이트 자동화 진행 중</h3>
              <div className="sub">웹뷰 창에서 실시간 진행 상황을 확인할 수 있습니다.</div>
            </div>
            <div className="auto-body">
              <div className="auto-progress">
                {steps.map((s, i) => (
                  <div key={s.k} className={'auto-step ' + (i < idx ? 'done' : i === idx ? 'active' : '')}>
                    <div className="icon">
                      {i < idx ? <I.Check size={12}/> : i === idx ? <span style={{width:6, height:6, borderRadius:'50%', background:'currentColor', animation:'blink 0.8s infinite'}}/> : i + 1}
                    </div>
                    <div>
                      <div>{s.label}</div>
                      <div style={{fontSize:10, color:'var(--text-3)', marginTop:2, fontFamily:'JetBrains Mono'}}>{s.detail}</div>
                    </div>
                    <div className="meta">{i < idx ? 'OK' : i === idx ? '...' : ''}</div>
                  </div>
                ))}
              </div>
              {idx >= steps.length && (
                <div style={{marginTop:14, padding:'10px 14px', background:'var(--ok-soft)', borderRadius:5, fontSize:12, color:'var(--ok)', fontWeight:600, display:'flex', alignItems:'center', gap:8}}>
                  <I.CheckCircle size={14}/>
                  업로드 완료. 4건 → 쉽먼트 인박스, 6건 → 밀크런 인박스로 라우팅됨.
                </div>
              )}
              <div style={{display:'flex', gap:8, marginTop:14, justifyContent:'flex-end'}}>
                {idx >= steps.length
                  ? <button className="btn primary" onClick={onClose}>인박스로 이동</button>
                  : <button className="btn ghost" onClick={onClose}>백그라운드로 보내기</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CountdownInner({ onClose, onComplete }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n <= 0) return;
    const t = setTimeout(() => setN(n - 1), 900);
    return () => clearTimeout(t);
  }, [n]);
  const r = 36, c = 2 * Math.PI * r, p = (3 - n) / 3;

  return (
    <>
      <div className="auto-head" style={{textAlign:'center', borderBottom:'none'}}>
        <h3 style={{justifyContent:'center'}}><I.AlertTriangle size={14} stroke="var(--warn)"/>발주확정 업로드 직전</h3>
        <div className="sub">취소하려면 ESC</div>
      </div>
      <div className="auto-body" style={{paddingTop:0}}>
        <div className="countdown-ring">
          <svg width="80" height="80">
            <circle cx="40" cy="40" r={r} stroke="var(--bg-panel-3)" strokeWidth="5" fill="none"/>
            <circle cx="40" cy="40" r={r} stroke="var(--accent)" strokeWidth="5" fill="none"
              strokeDasharray={c} strokeDashoffset={c * (1 - p)}
              style={{transition:'stroke-dashoffset 0.9s linear'}} strokeLinecap="round"/>
          </svg>
          <div className="num">{n > 0 ? n : '✓'}</div>
        </div>
        <div style={{textAlign:'center', fontSize:12, color:'var(--text-2)', marginBottom:14}}>
          <strong style={{color:'var(--text)'}}>10 SKU</strong> · 4 쉽먼트 + 6 밀크런 · 반려 2건<br/>
          확정 후 자동으로 인박스로 라우팅됩니다.
        </div>
      </div>
    </>
  );
}

// ===== S4: INBOX (ship | milk) =====
function InboxView({ kind, items, setItems, onBuild }) {
  const isShip = kind === 'ship';
  const groups = useMemo(() => {
    const g = {};
    items.forEach(it => {
      if (!g[it.wh]) g[it.wh] = [];
      g[it.wh].push(it);
    });
    return Object.entries(g);
  }, [items]);

  const [selected, setSelected] = useState(new Set());
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const stagedCount = items.filter(i => i.staged).length;
  const todayCount = items.filter(i => i.jobDate === '2026-05-06').length;
  const carryCount = items.length - todayCount;

  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="view-wrap">
      <div className="summary-row" style={{borderTop: `2px solid ${isShip ? 'var(--ship)' : 'var(--milk)'}`}}>
        <div className="stat">
          <div className="lbl">대기 복합키</div>
          <div className="val">{items.length}<span className="u">건</span></div>
        </div>
        <div className="stat">
          <div className="lbl">총 수량</div>
          <div className="val" style={{color: isShip ? 'var(--ship)' : 'var(--milk)'}}>{totalQty.toLocaleString()}<span className="u">개</span></div>
        </div>
        <div className="stat">
          <div className="lbl">오늘 차수</div>
          <div className="val">{todayCount}<span className="u">건</span></div>
        </div>
        <div className="stat">
          <div className="lbl">이월</div>
          <div className="val" style={{color: carryCount > 0 ? 'var(--warn)' : 'var(--text-3)'}}>{carryCount}<span className="u">건</span></div>
        </div>
      </div>

      <div className="tool-row">
        <span style={{fontSize:11, color:'var(--text-3)'}}>선택 <strong className="mono" style={{color:'var(--text)'}}>{selected.size}</strong> / {items.length}</span>
        <div style={{display:'flex', gap:4}}>
          <button className="chip active">전체 <span className="n">{items.length}</span></button>
          <button className="chip">오늘 <span className="n">{todayCount}</span></button>
          <button className="chip">이월 <span className="n">{carryCount}</span></button>
          <button className="chip">스테이징됨 <span className="n">{stagedCount}</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm" disabled={!selected.size}><I.X size={12}/> 인박스에서 빼기</button>
        <button className={'btn ' + (isShip ? 'ship' : 'milk') + ' sm'} disabled={!selected.size} onClick={() => onBuild([...selected])}>
          {isShip ? <I.Box size={13}/> : <I.Pallet size={13}/>}
          {selected.size}건으로 lot 만들기
        </button>
        <div style={{width:1, height:18, background:'var(--border)'}}/>
        <button className="btn primary sm" disabled={!stagedCount}>
          <I.Send size={13}/> 사이트에 업로드 ({stagedCount})
        </button>
      </div>

      <div className="inbox-wrap">
        <div className="inbox-list">
          <div className="inbox-list-head">
            <I.Search size={13} stroke="var(--text-3)"/>
            <input placeholder="센터·발주·SKU 검색" style={{flex:1, border:'none', outline:'none', fontSize:12, background:'transparent'}}/>
          </div>
          {groups.map(([wh, list]) => (
            <div key={wh}>
              <div className="inbox-group-head">
                <I.Building size={11}/>
                <span>{wh}</span>
                <span style={{flex:1}}/>
                <span className="mono" style={{fontWeight:400, fontSize:10}}>{list.length}건 · {list.reduce((s,i)=>s+i.qty,0)}개</span>
              </div>
              {list.map(it => {
                const sel = selected.has(it.id);
                return (
                  <div key={it.id} className={'inbox-item' + (sel ? ' selected' : '') + (it.staged ? ' staged' : '')}
                       onClick={() => toggle(it.id)}>
                    <div className="top-row">
                      <div className={'cb ' + (sel ? 'on' : '')}>{sel && <I.Check size={11}/>}</div>
                      <span className="wh mono" style={{fontSize:11, color:'var(--text-2)'}}>{it.po}</span>
                      <span className="age">{it.age}</span>
                    </div>
                    <div className="skus">
                      <div className="sku-line">
                        <span className="barcode">{it.sku}</span>
                        <span className="name">{it.name}</span>
                        <span className="qty">{it.qty}</span>
                      </div>
                    </div>
                    <div className="meta-row">
                      <span className="seq">{it.jobDate.slice(5).replace('-','/')} · {it.seq}차</span>
                      {it.staged && <span className="pill" style={{background:'var(--warn-soft)', color:'var(--warn)'}}>스테이징됨</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="inbox-detail">
          {selected.size === 0 ? (
            <div className="empty">
              <div className="ic">{isShip ? <I.Box size={20} stroke="var(--text-3)"/> : <I.Pallet size={20} stroke="var(--text-3)"/>}</div>
              <div className="ttl">복합키를 선택하세요</div>
              <div className="sub">
                좌측 인박스에서 같은 센터의 복합키를 골라 {isShip ? '쉽먼트 박스' : '밀크런 팔레트'} lot을 구성합니다.
                {isShip ? ' 박스마다 송장이 1:1로 매칭됩니다.' : ' 한 팔레트에 여러 SKU를 분배할 수 있습니다.'}
                <br/><br/>
                <kbd>Shift</kbd> + 클릭으로 범위 선택, <kbd>Cmd</kbd> + A로 전체 선택.
              </div>
            </div>
          ) : (
            <BuilderInline kind={kind} items={items.filter(i => selected.has(i.id))} onClose={() => setSelected(new Set())}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== S5: BUILDER (in-line in inbox detail panel) =====
function BuilderInline({ kind, items, onClose }) {
  const isShip = kind === 'ship';
  const [containers, setContainers] = useState(() => {
    if (isShip) return [{ id: 'b1', label: '박스 1', invoice: '', items: {} }];
    return [{ id: 'p1', label: '팔레트 1', preset: 'T11', cap: 192, items: {} }];
  });
  const [allocations, setAllocations] = useState(() => {
    const a = {};
    items.forEach(it => { a[it.id] = {}; });
    return a;
  });

  const remaining = (it) => it.qty - Object.values(allocations[it.id] || {}).reduce((s, v) => s + (+v || 0), 0);

  const setAlloc = (itemId, contId, val) => {
    setAllocations(prev => ({ ...prev, [itemId]: { ...prev[itemId], [contId]: Math.max(0, +val || 0) } }));
  };

  const addContainer = () => {
    const idx = containers.length + 1;
    if (isShip) setContainers([...containers, { id: 'b' + idx, label: '박스 ' + idx, invoice: '', items: {} }]);
    else setContainers([...containers, { id: 'p' + idx, label: '팔레트 ' + idx, preset: 'T11', cap: 192, items: {} }]);
  };

  const wh = items[0]?.wh;
  const allFromSameWh = items.every(i => i.wh === wh);

  return (
    <div>
      <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:14}}>
        <div style={{width:32, height:32, borderRadius:6, background: isShip ? 'var(--ship-soft)' : 'var(--milk-soft)', color: isShip ? 'var(--ship)' : 'var(--milk)', display:'flex', alignItems:'center', justifyContent:'center'}}>
          {isShip ? <I.Box size={16}/> : <I.Pallet size={16}/>}
        </div>
        <div>
          <div style={{fontSize:14, fontWeight:600}}>{isShip ? '쉽먼트 lot 빌더' : '밀크런 lot 빌더'}</div>
          <div style={{fontSize:11, color:'var(--text-3)'}}>{items.length}개 복합키 · 총 {items.reduce((s,i)=>s+i.qty,0)}개</div>
        </div>
        <div style={{flex:1}}/>
        {!allFromSameWh && (
          <span className="badge warn"><I.AlertTriangle size={11}/> 센터 혼합 — 분리 필요</span>
        )}
        <button className="btn ghost sm" onClick={onClose}><I.X size={13}/> 취소</button>
      </div>

      {/* Source items list */}
      <div className="source-list">
        <div className="source-list-head">
          <span>선택된 복합키</span>
          <span style={{flex:1}}/>
          <span className="mono" style={{color:'var(--text-3)', fontWeight:400}}>잔여 = 미배치 수량</span>
        </div>
        {items.map(it => {
          const rem = remaining(it);
          return (
            <div key={it.id} className="source-row">
              <I.GripV size={14} className="grip"/>
              <span className="badge" style={{minWidth:48, justifyContent:'center'}}>{it.wh}</span>
              <span className="barcode">{it.sku}</span>
              <span className="name">{it.name}</span>
              <span className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{it.po}</span>
              <span className="qty">
                {it.qty}
                {rem !== it.qty && <span className={rem === 0 ? '' : 'remaining'} style={{marginLeft:4, color: rem === 0 ? 'var(--ok)' : 'var(--warn)'}}>
                  {rem === 0 ? '· 배치완료' : `· ${rem} 남음`}
                </span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Container builder */}
      <div className="builder-canvas">
        <h3>
          {isShip ? <I.Box size={14}/> : <I.Pallet size={14}/>}
          {isShip ? '박스 구성' : '팔레트 구성'} <span style={{fontWeight:400, color:'var(--text-3)', fontSize:11}}>· {containers.length}개</span>
          <div style={{flex:1}}/>
          <button className="btn sm" onClick={addContainer}><I.Plus size={12}/> {isShip ? '박스' : '팔레트'} 추가</button>
        </h3>

        <div className="pallet-grid">
          {containers.map(c => {
            const total = items.reduce((s, it) => s + (+(allocations[it.id]?.[c.id]) || 0), 0);
            return (
              <div key={c.id} className={'pallet-card' + (total === 0 ? ' empty' : '')}>
                <div className="label">
                  {isShip ? <I.Box size={11}/> : <I.Pallet size={11}/>}
                  {c.label}
                </div>
                {isShip ? (
                  <input placeholder="송장번호" defaultValue={c.invoice}
                    style={{height:24, padding:'0 6px', border:'1px solid var(--border)', borderRadius:3, fontFamily:'JetBrains Mono', fontSize:11, background:'white'}}/>
                ) : (
                  <div className="preset">{c.preset} · 최대 {c.cap}개</div>
                )}
                <div className="stack">
                  {Array.from({length: 6}).map((_, j) => <span key={j} style={{height: total === 0 ? '20%' : `${30 + (j*8) % 60}%`}}/>)}
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:3, marginTop:4}}>
                  {items.map(it => (
                    <div key={it.id} style={{display:'flex', alignItems:'center', gap:4, fontSize:10}}>
                      <span style={{flex:1, color:'var(--text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.name}</span>
                      <input type="number" placeholder="0"
                        value={allocations[it.id]?.[c.id] || ''}
                        onChange={e => setAlloc(it.id, c.id, e.target.value)}
                        style={{width:50, height:20, padding:'0 4px', border:'1px solid var(--border)', borderRadius:3, fontFamily:'JetBrains Mono', fontSize:10, textAlign:'right'}}/>
                    </div>
                  ))}
                </div>
                <div className="total" style={{borderTop:'1px solid var(--border-soft)', paddingTop:4, marginTop:2, textAlign:'right'}}>
                  합계 {total}{!isShip && <span style={{color:'var(--text-3)', fontWeight:400}}>/ {c.cap}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:14}}>
          <button className="btn sm">초안 저장</button>
          <button className={'btn ' + (isShip ? 'ship' : 'milk')}>
            <I.Check size={13}/> 스테이징 확정 ({items.length}건)
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== S6: HISTORY =====
function HistoryView() {
  return (
    <div className="view-wrap">
      <div className="summary-row">
        <div className="stat"><div className="lbl">5월 누적 차수</div><div className="val">14<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">총 출고 수량</div><div className="val">2,184<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">파일 보관</div><div className="val">42<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">평균 처리 시간</div><div className="val">11<span className="u">분</span></div></div>
      </div>

      <div className="tool-row">
        <div className="search">
          <I.Search size={13} stroke="var(--text-3)"/>
          <input placeholder="날짜·센터·파일명 검색"/>
        </div>
        <div style={{display:'flex', gap:4}}>
          <button className="chip active">전체 <span className="n">{HISTORY.length}</span></button>
          <button className="chip">발주확정 <span className="n">1</span></button>
          <button className="chip">쉽먼트 <span className="n">2</span></button>
          <button className="chip">밀크런 <span className="n">2</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm"><I.Download size={13}/> 전체 내보내기</button>
      </div>

      <div className="view-body" style={{padding:16}}>
        {HISTORY.map(h => (
          <div key={h.id} className="history-row">
            <div style={{width:40, height:40, borderRadius:6, background: h.kind.includes('쉽먼트') ? 'var(--ship-soft)' : h.kind.includes('밀크런') ? 'var(--milk-soft)' : 'var(--accent-soft)', color: h.kind.includes('쉽먼트') ? 'var(--ship)' : h.kind.includes('밀크런') ? 'var(--milk)' : 'var(--accent-strong)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              {h.kind.includes('쉽먼트') ? <I.Box size={18}/> : h.kind.includes('밀크런') ? <I.Pallet size={18}/> : <I.CheckCircle size={18}/>}
            </div>
            <div className="what">
              <div className="ttl">{h.kind} <span style={{fontSize:11, color:'var(--text-3)', fontWeight:400, marginLeft:6}}>{h.wh}</span></div>
              <div className="desc">
                <span className="mono">{h.count}</span>개 · {h.lots > 0 && <><span className="mono">{h.lots}</span> lot · </>}
                {h.files.length}개 파일
              </div>
            </div>
            <div className="when">{h.when}</div>
            <button className="btn sm"><I.Eye size={12}/> 상세</button>
            <button className="btn sm primary"><I.Download size={12}/> 다운</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== WEBVIEW WINDOW (separate) =====
function WebviewWindow({ stage, vendor }) {
  return (
    <div style={{display:'flex', flexDirection:'column', flex:1, minHeight:0}}>
      <div className="wv-toolbar">
        <span style={{display:'inline-flex', gap:3, color:'#999'}}>
          <I.ChevronL size={14}/><I.Chevron size={14}/><I.RefreshCw size={13}/>
        </span>
        <div className="url">https://supplier.coupang.com/po/confirm</div>
        <span className="badge mono" style={{fontSize:10}}>partition: {vendor.id}</span>
      </div>
      <div className="wv-mock" style={{flex:1, overflow:'auto'}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'8px 12px', background:'oklch(0.95 0.04 250)', borderRadius:4, fontSize:11, color:'oklch(0.42 0.14 250)'}}>
          <I.Loader size={12} stroke="oklch(0.42 0.14 250)"/>
          <span>Playwright 자동화 동작 중 — 사용자 입력은 비활성화됩니다.</span>
        </div>
        <div style={{display:'flex', gap:8, marginBottom:8, alignItems:'center'}}>
          <strong style={{fontSize:13}}>발주 목록</strong>
          <span style={{padding:'1px 6px', background:'#EAEAEA', borderRadius:3, fontSize:10}}>2026-05-06</span>
          <div style={{flex:1}}/>
          <button style={{padding:'4px 10px', background:'#0066CC', color:'white', border:'none', borderRadius:3, fontSize:11, fontWeight:600, boxShadow:'0 0 0 2px rgba(0,102,204,0.3)'}}>발주확정 ⌒</button>
        </div>
        <table className="wv-mock-table">
          <thead><tr><th>발주번호</th><th>센터</th><th>SKU</th><th>요청</th><th>확정</th><th>상태</th></tr></thead>
          <tbody>
            {[
              ['129868291','곤지','4549292221',4,4,'대기'],
              ['129868269','안성4','4549292255',13,0,'반려'],
              ['129799598','안성4','4549292062',192,192,'확정중'],
              ['129799598','안성4','4549292068',4,4,'확정완료'],
              ['129755019','인천26','4549292062',48,48,'대기'],
              ['129751864','안성5','4549292221',4,4,'대기'],
              ['129701155','화성2','4549292068',8,8,'대기'],
              ['129701155','화성2','4549292255',12,12,'대기'],
              ['129722410','덕평2','4549292062',96,96,'대기'],
              ['129722410','덕평2','4549292221',24,24,'대기'],
            ].map((r, i) => (
              <tr key={i} className={'wv-mock-row' + (r[5] === '확정중' ? ' highlight' : '')}>
                <td className="mono">{r[0]}</td><td>{r[1]}</td><td className="mono">{r[2]}</td>
                <td style={{textAlign:'right'}} className="mono">{r[3]}</td>
                <td style={{textAlign:'right', fontWeight:600}} className="mono">{r[4]}</td>
                <td><span style={{padding:'1px 6px', borderRadius:2, fontSize:10,
                  background: r[5] === '확정완료' ? '#E0F4E5' : r[5] === '확정중' ? '#FFF4D9' : r[5] === '반려' ? '#FCE4E4' : '#EFEFEF',
                  color: r[5] === '확정완료' ? '#1F7A3D' : r[5] === '확정중' ? '#8A6213' : r[5] === '반려' ? '#A23030' : '#666'
                }}>{r[5]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{marginTop:14, padding:10, background:'#FAFAFA', border:'1px dashed #DDD', borderRadius:4, fontSize:10, color:'#666', fontFamily:'JetBrains Mono', lineHeight:1.6}}>
          <div>▸ POST /api/po/confirm — 200 OK (10 rows)</div>
          <div>▸ 라우팅 결과: ship_inbox += 4, milk_inbox += 6</div>
          <div style={{color:'#0066CC'}}>▸ 다음 동작: 메인 윈도우에서 인박스 처리</div>
        </div>
      </div>
    </div>
  );
}

// ===== LOG WINDOW =====
function LogWindow() {
  const [filter, setFilter] = useState('all');
  const filtered = LOG_LINES.filter(l => filter === 'all' || l.lvl === filter);
  return (
    <div style={{display:'flex', flexDirection:'column', flex:1, minHeight:0}}>
      <div className="log-toolbar">
        {['all','info','ok','warn','err'].map(k => (
          <button key={k} className={'filter' + (filter === k ? ' active' : '')} onClick={() => setFilter(k)}>
            {k.toUpperCase()}
          </button>
        ))}
        <div style={{flex:1}}/>
        <span style={{fontSize:10, color:'#71717A', display:'inline-flex', alignItems:'center', gap:4}}>
          <span style={{width:6, height:6, borderRadius:'50%', background:'var(--ok)', animation:'pulse 2s infinite'}}/>auto-scroll
        </span>
      </div>
      <div className="log-body">
        {filtered.map((l, i) => (
          <div className="line" key={i}>
            <span className="ts">{l.ts}</span>
            <span className={'lvl ' + l.lvl}>[{l.lvl.toUpperCase()}]</span>
            <span className="msg">{l.msg}</span>
          </div>
        ))}
        <div className="line">
          <span className="ts">14:39:14</span>
          <span className="lvl info">[INFO]</span>
          <span className="msg">대기 중<span style={{display:'inline-block', width:6, height:11, background:'#C8C8CC', marginLeft:2, animation:'blink 1s infinite'}}/></span>
        </div>
      </div>
    </div>
  );
}

// ===== DRAGGABLE WINDOW WRAPPER =====
function DraggableWindow({ id, title, subtitle, children, pos, setPos, onFocus, onClose, focused, zIndex, w, h, minimized }) {
  const dragRef = useRef(null);
  const onMouseDown = (e) => {
    if (e.target.closest('button')) return;
    onFocus();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.origX + dx, y: Math.max(0, dragRef.current.origY + dy) });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [setPos]);

  return (
    <div className={'window' + (focused ? ' focused' : '') + (minimized ? ' minimized' : '')}
         style={{left: pos.x, top: pos.y, width: w, height: h, zIndex}}
         onMouseDown={onFocus}>
      <div className={'titlebar' + (dragRef.current ? ' dragging' : '')} onMouseDown={onMouseDown}>
        <div className="ttl"><span className="dot"/>{title}</div>
        {subtitle && <div className="meta">{subtitle}</div>}
        <div className="titlebar-spacer"/>
        <div className="ctrls">
          <button title="최소화"><I.Min size={11}/></button>
          <button title="크게"><I.Maximize size={11}/></button>
          <button className="close" onClick={onClose} title="닫기"><I.Close size={12}/></button>
        </div>
      </div>
      {children}
    </div>
  );
}

// ===== TOP-LEVEL APP =====
function App() {
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [shipInbox, setShipInbox] = useState(INIT_SHIP);
  const [milkInbox, setMilkInbox] = useState(INIT_MILK);
  const [view, setView] = useState('confirm'); // start at confirm to show the meaty screen first
  const [uploadStage, setUploadStage] = useState(null); // null | countdown | login | navigate | upload | verify | route | done

  // Window manager
  const [winFocus, setWinFocus] = useState('main');
  const [zStack, setZStack] = useState(['log','web','main']);
  const [mainPos, setMainPos] = useState({ x: 16, y: 16 });
  const [webPos, setWebPos] = useState({ x: 1080, y: 60 });
  const [logPos, setLogPos] = useState({ x: 760, y: 460 });
  const [webOpen, setWebOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);

  const focus = (id) => {
    setWinFocus(id);
    setZStack(prev => [...prev.filter(x => x !== id), id]);
  };
  const z = (id) => 10 + zStack.indexOf(id);

  // Counts for stepper
  const reviewedCount = rows.filter(r => r.reviewed || r.confQty === 0).length;
  const acceptedRows = rows.filter(r => r.confQty > 0);
  const unsetMethodCount = acceptedRows.filter(r => !r.method).length;
  const counts = {
    review: rows.length,
    confirm: acceptedRows.length,
    upload: null,
    ship: shipInbox.length,
    milk: milkInbox.length,
    history: HISTORY.length,
  };

  // Auto-advance upload stages
  useEffect(() => {
    if (!uploadStage || uploadStage === 'done' || uploadStage === 'countdown') return;
    const order = ['login','navigate','upload','verify','route','done'];
    const idx = order.indexOf(uploadStage);
    if (idx < 0 || idx === order.length - 1) return;
    const t = setTimeout(() => setUploadStage(order[idx + 1]), 1100);
    return () => clearTimeout(t);
  }, [uploadStage]);

  // Countdown auto-progresses
  useEffect(() => {
    if (uploadStage !== 'countdown') return;
    const t = setTimeout(() => setUploadStage('login'), 3000);
    return () => clearTimeout(t);
  }, [uploadStage]);

  const handleUpload = () => {
    setUploadStage('countdown');
    focus('web');
  };
  const handleUploadDone = () => {
    setUploadStage(null);
    setView('ship');
  };

  return (
    <div className="desktop">
      {/* MAIN WINDOW */}
      <DraggableWindow
        id="main"
        title="Coupang Inbound"
        subtitle="canon · 2026-05-06 · 1차"
        pos={mainPos} setPos={setMainPos}
        onFocus={() => focus('main')}
        focused={winFocus === 'main'}
        zIndex={z('main')}
        w={1040} h={760}
        onClose={() => {}}>
        <div className="win-body">
          <Sidebar
            current={view}
            onJump={setView}
            counts={counts}
            vendor={VENDOR}
            onOpenWeb={() => { setWebOpen(!webOpen); if (!webOpen) focus('web'); }}
            onOpenLog={() => { setLogOpen(!logOpen); if (!logOpen) focus('log'); }}
            webOpen={webOpen}
            logOpen={logOpen}
          />

          <div className="view-wrap">
            <div className="header">
              <h1>
                {view === 'review' && <>검토 <span className="sub">경영지원 · 행 단위 OK/반려</span></>}
                {view === 'confirm' && <>확정 + 운송방법 <span className="sub">물류 · 복합키별 ship / milk</span></>}
                {view === 'ship' && <>쉽먼트 인박스 <span className="sub">차수 무관 · 박스 lot 빌더</span></>}
                {view === 'milk' && <>밀크런 인박스 <span className="sub">차수 무관 · 팔레트 lot 빌더</span></>}
                {view === 'history' && <>결과 히스토리 <span className="sub">영구 보관 · 파일 다운</span></>}
              </h1>
              <div className="header-spacer"/>
              <span className="badge ok"><span style={{width:6,height:6,borderRadius:'50%',background:'currentColor', display:'inline-block'}}/> 동기화 OK</span>
              <span className="badge"><I.RefreshCw size={11}/> 자동 저장 14:39</span>
              <button className="icon-btn"><I.Bell size={15}/></button>
              <button className="icon-btn"><I.User size={15}/></button>
            </div>

            <RoleStepper current={view === 'history' ? 'history' : view === 'ship' ? 'ship' : view === 'milk' ? 'milk' : view === 'review' ? 'review' : view === 'confirm' ? 'confirm' : 'upload'}
                         onJump={setView}
                         counts={counts}/>

            {view === 'review' && <ReviewView rows={rows} setRows={setRows} onNext={() => setView('confirm')}/>}
            {view === 'confirm' && <ConfirmView rows={rows} setRows={setRows} onUpload={handleUpload}/>}
            {view === 'ship' && <InboxView kind="ship" items={shipInbox} setItems={setShipInbox} onBuild={() => {}}/>}
            {view === 'milk' && <InboxView kind="milk" items={milkInbox} setItems={setMilkInbox} onBuild={() => {}}/>}
            {view === 'history' && <HistoryView/>}
          </div>
        </div>
      </DraggableWindow>

      {/* WEBVIEW WINDOW */}
      {webOpen && (
        <DraggableWindow
          id="web"
          title="웹뷰 — 공급사 포털"
          subtitle="partition: canon · Playwright"
          pos={webPos} setPos={setWebPos}
          onFocus={() => focus('web')}
          focused={winFocus === 'web'}
          zIndex={z('web')}
          w={420} h={580}
          onClose={() => setWebOpen(false)}>
          <WebviewWindow stage={uploadStage} vendor={VENDOR}/>
        </DraggableWindow>
      )}

      {/* LOG WINDOW */}
      {logOpen && (
        <DraggableWindow
          id="log"
          title="작업 로그"
          subtitle={`${LOG_LINES.length} lines · 실시간`}
          pos={logPos} setPos={setLogPos}
          onFocus={() => focus('log')}
          focused={winFocus === 'log'}
          zIndex={z('log')}
          w={600} h={280}
          onClose={() => setLogOpen(false)}>
          <LogWindow/>
        </DraggableWindow>
      )}

      {/* HUD */}
      <div className="hud">
        <div className="ttl">분리 윈도우 시뮬레이션</div>
        <div className="body">
          창 제목바를 드래그해서 옮기거나 사이드바에서 웹뷰·로그를 토글할 수 있습니다. 일렉트론에서는 실제 별개 BrowserWindow로 구현됩니다.
        </div>
      </div>

      {/* DOCK */}
      <div className="dock">
        <div className="app-id"><span className="dot"/>Coupang Inbound</div>
        <div className={'win-tab' + (winFocus === 'main' ? ' focused' : '')} onClick={() => focus('main')}>
          <span className="indicator"/>메인 — 작업
        </div>
        {webOpen && (
          <div className={'win-tab' + (winFocus === 'web' ? ' focused' : '')} onClick={() => focus('web')}>
            <span className="indicator"/>웹뷰
            {uploadStage && <span className="badge accent" style={{fontSize:9, padding:'1px 5px'}}>자동화 중</span>}
          </div>
        )}
        {logOpen && (
          <div className={'win-tab' + (winFocus === 'log' ? ' focused' : '')} onClick={() => focus('log')}>
            <span className="indicator"/>로그
          </div>
        )}
        <div className="dock-spacer"/>
        <div className="dock-tray">
          <span><span className="pulse" style={{display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>Python 런타임</span>
          <span className="mono">v2.0.0-alpha</span>
          <span className="mono">14:39</span>
        </div>
      </div>

      {/* UPLOAD MODAL */}
      {uploadStage && uploadStage !== 'done' && (
        <UploadModal stage={uploadStage} onClose={() => setUploadStage(null)} vendor={VENDOR}/>
      )}
      {uploadStage === 'done' && (
        <div className="auto-overlay">
          <div className="auto-modal">
            <div className="auto-head"><h3><I.CheckCircle size={14} stroke="var(--ok)"/>업로드 완료</h3></div>
            <div className="auto-body" style={{textAlign:'center'}}>
              <div style={{fontSize:13, marginBottom:14}}>10건이 인박스로 라우팅되었습니다.</div>
              <div style={{display:'flex', gap:8, justifyContent:'center'}}>
                <button className="btn ship" onClick={() => { setView('ship'); handleUploadDone(); }}>쉽먼트 인박스 (4)</button>
                <button className="btn milk" onClick={() => { setView('milk'); handleUploadDone(); }}>밀크런 인박스 (6)</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
