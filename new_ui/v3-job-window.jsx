// Job window — single 차수 work surface
const { ACTIVE_ROWS, SHIP_INBOX, MILK_INBOX, HISTORY } = window.V3;

const STEPS = [
  { key: 'review',  name: '검토',         desc: '행 단위 OK/반려' },
  { key: 'confirm', name: '확정 + 방법',  desc: '운송방법 + 업로드' },
  { key: 'ship',    name: '쉽먼트 인박스', desc: '박스 lot' },
  { key: 'milk',    name: '밀크런 인박스', desc: '팔레트 lot' },
  { key: 'history', name: '결과',         desc: '파일 다운' },
];

function JobView({ job, vendor, plugins, onRequestPluginWindow }) {
  const [view, setView] = useState('review');
  const [rows, setRows] = useState(ACTIVE_ROWS);
  const [shipInbox, setShipInbox] = useState(SHIP_INBOX);
  const [milkInbox, setMilkInbox] = useState(MILK_INBOX);
  const [poModal, setPoModal] = useState(false);
  const [uploadStage, setUploadStage] = useState(null);

  const tbnws = plugins.find(p => p.id === 'tbnws' && p.enabled);
  const invoicePrinter = plugins.find(p => p.id === 'invoice-printer' && p.enabled);
  const palletOptim = plugins.find(p => p.id === 'pallet-optim' && p.enabled);

  // Plugin-injected steps
  const allSteps = useMemo(() => {
    const s = [...STEPS];
    if (tbnws) {
      const idx = s.findIndex(x => x.key === 'confirm');
      s.splice(idx + 1, 0, { key: 'admin-sync', name: '어드민 동기화', desc: 'tbnws 플러그인', plugin: 'tbnws' });
    }
    return s;
  }, [tbnws]);

  const reviewedCount = rows.filter(r => r.reviewed).length;
  const unreviewedCount = rows.length - reviewedCount;
  const acceptedRows = rows.filter(r => r.confQty > 0);
  const unsetMethodCount = acceptedRows.filter(r => !r.method).length;

  const counts = {
    review: rows.length,
    confirm: acceptedRows.length,
    'admin-sync': tbnws ? 4 : null,
    ship: shipInbox.length,
    milk: milkInbox.length,
    history: HISTORY.filter(h => h.jobId === job.id).length,
  };

  // Auto-advance upload
  useEffect(() => {
    if (!uploadStage || uploadStage === 'done' || uploadStage === 'countdown') return;
    const order = ['login','navigate','upload','verify','route','done'];
    const idx = order.indexOf(uploadStage);
    if (idx < 0 || idx === order.length - 1) return;
    const t = setTimeout(() => setUploadStage(order[idx + 1]), 900);
    return () => clearTimeout(t);
  }, [uploadStage]);
  useEffect(() => {
    if (uploadStage !== 'countdown') return;
    const t = setTimeout(() => setUploadStage('login'), 3000);
    return () => clearTimeout(t);
  }, [uploadStage]);

  return (
    <div className="job-shell">
      <div className="job-side">
        <div className="job-side-label">단계</div>
        {allSteps.map((s, i) => {
          const c = counts[s.key];
          const isInbox = s.key === 'ship' || s.key === 'milk';
          const klass = (isInbox && c >= 6) ? 'urgent' : (s.key === 'review' && unreviewedCount > 0) ? 'warn' : '';
          return (
            <button key={s.key} className={'step ' + klass + (view === s.key ? ' active' : '')} onClick={() => setView(s.key)}>
              <span className="num">{String(i + 1).padStart(2,'0')}</span>
              <span className="label">{s.name}</span>
              {s.plugin && <span className="plugin-mark"/>}
              {c != null && <span className="badge">{c}</span>}
            </button>
          );
        })}
        <div className="job-divider"/>
        <div className="job-side-label">정보</div>
        <div style={{padding:'6px 10px', fontSize:11, color:'#A1A1AA'}}>
          <div>발주일시 ≥</div>
          <div className="mono" style={{color:'#E4E4E7'}}>2026-05-04 09:00</div>
        </div>
        <div style={{padding:'6px 10px', fontSize:11, color:'#A1A1AA'}}>
          <div>중복 제외</div>
          <div className="mono" style={{color:'#5EBC78'}}>4건 (5/5 1차)</div>
        </div>
      </div>

      <div className="job-view">
        <div className="job-head">
          <h2>
            {allSteps.find(s => s.key === view)?.name}
            <span className="sub">{allSteps.find(s => s.key === view)?.desc}</span>
          </h2>
          {tbnws && view === 'review' && <span className="badge plugin"><I.Plug size={10}/>tbnws · 그룹핑 적용</span>}
          <div style={{flex:1}}/>
          <span className="badge ok"><span style={{width:6,height:6,borderRadius:'50%',background:'currentColor'}}/>저장 14:39</span>
        </div>

        <div className="stepper">
          {allSteps.map((s, i) => {
            const idx = allSteps.findIndex(x => x.key === view);
            const state = i < idx ? 'done' : i === idx ? 'active' : '';
            return (
              <div key={s.key} className={'step-pill ' + state + (s.plugin ? ' plugin-step' : '')} onClick={() => setView(s.key)}>
                <div className="num">{i < idx ? <I.Check size={13}/> : i + 1}</div>
                <div>
                  <div className="name">{s.name}{s.plugin && <span style={{marginLeft:4}}><I.Plug size={9} stroke="var(--plugin)"/></span>}</div>
                  <span className="meta">{s.desc}</span>
                </div>
                <div className="conn"/>
              </div>
            );
          })}
        </div>

        {view === 'review' && <ReviewView rows={rows} setRows={setRows} onPoUpdate={() => setPoModal(true)} tbnws={tbnws}/>}
        {view === 'confirm' && <ConfirmView rows={rows} setRows={setRows} onUpload={() => setUploadStage('countdown')}/>}
        {view === 'admin-sync' && <AdminSyncView onOpenPluginWindow={() => onRequestPluginWindow('tbnws-admin')}/>}
        {view === 'ship' && <InboxView kind="ship" items={shipInbox} setItems={setShipInbox} invoicePrinter={invoicePrinter}/>}
        {view === 'milk' && <InboxView kind="milk" items={milkInbox} setItems={setMilkInbox} palletOptim={palletOptim}/>}
        {view === 'history' && <HistoryView job={job}/>}

        {poModal && <PoUpdateModal onClose={() => setPoModal(false)}/>}
        {uploadStage && <UploadModal stage={uploadStage} onClose={() => { setUploadStage(null); if (uploadStage === 'done') setView('ship'); }} vendor={vendor}/>}
      </div>
    </div>
  );
}

// ===== REVIEW =====
function ReviewView({ rows, setRows, onPoUpdate, tbnws }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const reviewedCount = rows.filter(r => r.reviewed).length;
  const unreviewedCount = rows.length - reviewedCount;
  const rejectedCount = rows.filter(r => r.confQty === 0 || r.short).length;
  const okCount = rows.filter(r => r.confQty > 0 && r.reviewed).length;

  let filt = rows.filter(r => !search || `${r.po} ${r.name} ${r.barcode}`.includes(search));
  if (filter === 'unreviewed') filt = filt.filter(r => !r.reviewed);
  if (filter === 'rejected') filt = filt.filter(r => r.confQty === 0);

  const setQty = (id, q) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: q, reviewed: true, short: q === 0 ? (r.short || '협력사 재고') : '' } : r));
  const reject = (id) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: 0, short: '협력사 재고', reviewed: true } : r));
  const accept = (id) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: r.reqQty, short: '', reviewed: true } : r));
  const nextSeq = (id) => setRows(rs => rs.filter(r => r.id !== id));  // simulate moving

  // tbnws grouping by sku
  const grouped = useMemo(() => {
    if (!tbnws) return null;
    const g = {};
    filt.forEach(r => { (g[r.sku] = g[r.sku] || []).push(r); });
    return Object.entries(g);
  }, [filt, tbnws]);

  return (
    <div className="job-view">
      <div className="summary-row">
        <div className="stat"><div className="lbl">전체 행</div><div className="val">{rows.length}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">검토 완료</div><div className="val" style={{color:'var(--ok)'}}>{reviewedCount}<span className="u">/ {rows.length}</span></div></div>
        <div className="stat"><div className="lbl">미검토</div><div className="val" style={{color: unreviewedCount > 0 ? 'var(--warn)' : 'var(--text-3)'}}>{unreviewedCount}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">반려</div><div className="val" style={{color:'var(--danger)'}}>{rejectedCount}<span className="u">건</span></div></div>
      </div>

      <div className="tool-row">
        <div className="search">
          <I.Search size={13} stroke="var(--text-3)"/>
          <input placeholder="발주·SKU·이름 검색" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <div style={{display:'flex', gap:4}}>
          <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>전체 <span className="n">{rows.length}</span></button>
          <button className={'chip' + (filter === 'unreviewed' ? ' active' : '')} onClick={() => setFilter('unreviewed')}>
            <span className="unreviewed-marker"/>미검토 <span className="n">{unreviewedCount}</span>
          </button>
          <button className={'chip' + (filter === 'rejected' ? ' active' : '')} onClick={() => setFilter('rejected')}>반려 <span className="n">{rejectedCount}</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm" onClick={onPoUpdate}><I.RefreshCw size={13}/> PO 갱신</button>
        <button className="btn primary" disabled={unreviewedCount > 0}>
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
              <th>상태</th>
              {tbnws && <th className="plugin-col">총가능 <I.Plug size={9} stroke="currentColor" style={{marginLeft:3}}/></th>}
              {tbnws && <th className="plugin-col">유통기한</th>}
              <th>발주일시</th>
              <th style={{textAlign:'center', width:160}}>판단</th>
            </tr>
          </thead>
          <tbody>
            {tbnws && grouped ? grouped.map(([sku, list]) => (
              <React.Fragment key={sku}>
                <tr className="group-header">
                  <td colSpan={12}>
                    <I.Plug size={11} style={{marginRight:6}}/>
                    SKU {sku} · {list[0].name} — {list.length}센터 · 요청 {list.reduce((s,r)=>s+r.reqQty,0)} / 가능 {list.reduce((s,r)=>s+r.confQty,0)}
                  </td>
                </tr>
                {list.map((r, i) => <ReviewRow key={r.id} r={r} i={i} tbnws={tbnws} setQty={setQty} accept={accept} reject={reject} nextSeq={nextSeq}/>)}
              </React.Fragment>
            )) : filt.map((r, i) => <ReviewRow key={r.id} r={r} i={i} tbnws={tbnws} setQty={setQty} accept={accept} reject={reject} nextSeq={nextSeq}/>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewRow({ r, i, tbnws, setQty, accept, reject, nextSeq }) {
  const isReject = r.confQty === 0;
  const isUnreviewed = !r.reviewed;
  return (
    <tr className={isReject ? 'rejected' : isUnreviewed ? 'unreviewed' : ''}>
      <td className="row-num">{i + 1}</td>
      <td className="mono" style={{fontSize:11}}>
        {isUnreviewed && <span className="unreviewed-marker" title="미검토"/>}
        {r.po}
      </td>
      <td>{r.wh}</td>
      <td className="mono" style={{fontSize:11}}>{r.barcode}</td>
      <td>{r.name}</td>
      <td className="num">{r.reqQty}</td>
      <td className="num">
        <input type="number" value={r.confQty} onChange={e => setQty(r.id, Math.max(0, Math.min(r.reqQty, +e.target.value)))}
          style={{width:60, padding:'2px 6px', border:'1px solid var(--border)', borderRadius:3, fontFamily:'JetBrains Mono', fontSize:11, textAlign:'right'}}/>
      </td>
      <td>
        {isUnreviewed ? <span className="pill unreviewed">미검토</span> :
         r.short ? <span className="pill reject">{r.short}</span> :
         <span className="pill send">정상</span>}
      </td>
      {tbnws && <td className="num" style={{color:'var(--plugin)'}}>{r.confQty}</td>}
      {tbnws && <td className="mono" style={{fontSize:10, color:'var(--plugin)'}}>2027-12</td>}
      <td className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{r.orderTime}</td>
      <td style={{textAlign:'center'}}>
        <div style={{display:'inline-flex', gap:3}}>
          <button className={'btn sm' + (r.confQty > 0 && r.reviewed ? ' accent' : '')} onClick={() => accept(r.id)} style={{height:22, padding:'0 7px', fontSize:10}}>OK</button>
          <button className={'btn sm' + (isReject ? ' danger' : '')} onClick={() => reject(r.id)} style={{height:22, padding:'0 7px', fontSize:10}}>반려</button>
          <button className="btn sm ghost" title="다음 차수로" onClick={() => nextSeq(r.id)} style={{height:22, padding:'0 5px', fontSize:10}}><I.ChevronR size={11}/></button>
        </div>
      </td>
    </tr>
  );
}

// ===== CONFIRM + METHOD (combines old confirm + upload) =====
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
    <div className="job-view">
      <div className="summary-row">
        <div className="stat"><div className="lbl">확정 대상</div><div className="val">{acceptedRows.length}<span className="u">행</span></div></div>
        <div className="stat"><div className="lbl">쉽먼트</div><div className="val" style={{color:'var(--ship)'}}>{shipCount}<span className="u">· {shipQty.toLocaleString()}개</span></div></div>
        <div className="stat"><div className="lbl">밀크런</div><div className="val" style={{color:'var(--milk)'}}>{milkCount}<span className="u">· {milkQty.toLocaleString()}개</span></div></div>
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
            </tr>
          </thead>
          <tbody>
            {acceptedRows.map((r, i) => {
              const sel = selected.has(r.id);
              return (
                <tr key={r.id} className={sel ? 'selected' : ''}>
                  <td className="check-col"><div className={'cb ' + (sel ? 'on' : '')} onClick={() => toggle(r.id)}>{sel && <I.Check size={11}/>}</div></td>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===== ADMIN SYNC (plugin-injected) =====
function AdminSyncView({ onOpenPluginWindow }) {
  return (
    <div className="empty">
      <div className="ic" style={{background:'var(--plugin-soft)'}}><I.Plug size={20} stroke="var(--plugin)"/></div>
      <div className="ttl" style={{color:'var(--plugin)'}}>tbnws · 어드민 동기화</div>
      <div className="sub">
        이 단계는 tbnws 플러그인이 추가한 단계입니다. 활성화 시 별도 플러그인 창이 열리고
        메인 창은 작업이 끝날 때까지 잠깁니다.
        <br/><br/>
        <strong>플러그인 매니페스트:</strong>
        <div style={{textAlign:'left', display:'inline-block', marginTop:8, padding:10, background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:5, fontFamily:'JetBrains Mono', fontSize:11, color:'var(--text-2)'}}>
          {`hooks: review.columns, review.grouping`}<br/>
          {`step: { after: 'confirm', mode: 'window+lock' }`}
        </div>
      </div>
      <button className="btn plugin" onClick={onOpenPluginWindow}>
        <I.Plug size={13}/> 플러그인 창 열기 (메인 잠금)
      </button>
    </div>
  );
}

// ===== INBOX =====
function InboxView({ kind, items, setItems, invoicePrinter, palletOptim }) {
  const isShip = kind === 'ship';
  const groups = useMemo(() => {
    const g = {};
    items.forEach(it => { (g[it.wh] = g[it.wh] || []).push(it); });
    return Object.entries(g);
  }, [items]);

  const [selected, setSelected] = useState(new Set());
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const stagedCount = items.filter(i => i.staged).length;
  const todayCount = items.filter(i => i.jobDate === '2026-05-06').length;
  const carryCount = items.length - todayCount;
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const moveNext = () => {
    setItems(its => its.filter(i => !selected.has(i.id)));
    setSelected(new Set());
  };

  return (
    <div className="job-view">
      <div className="summary-row" style={{borderTop: `2px solid ${isShip ? 'var(--ship)' : 'var(--milk)'}`}}>
        <div className="stat"><div className="lbl">대기 복합키</div><div className="val">{items.length}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">총 수량</div><div className="val" style={{color: isShip ? 'var(--ship)' : 'var(--milk)'}}>{totalQty.toLocaleString()}<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">오늘</div><div className="val">{todayCount}<span className="u">건</span></div></div>
        <div className="stat"><div className="lbl">이월</div><div className="val" style={{color: carryCount > 0 ? 'var(--warn)' : 'var(--text-3)'}}>{carryCount}<span className="u">건</span></div></div>
      </div>

      <div className="tool-row">
        <span style={{fontSize:11, color:'var(--text-3)'}}>선택 <strong className="mono" style={{color:'var(--text)'}}>{selected.size}</strong></span>
        <div style={{display:'flex', gap:4}}>
          <button className="chip active">전체 <span className="n">{items.length}</span></button>
          <button className="chip">오늘 <span className="n">{todayCount}</span></button>
          <button className="chip">이월 <span className="n">{carryCount}</span></button>
          <button className="chip">스테이징됨 <span className="n">{stagedCount}</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm" disabled={!selected.size} onClick={moveNext} title="이 복합키 전량을 다음 차수로 넘김 (분할 불가)">
          <I.ChevronR size={12}/> 다음 차수로 ({selected.size})
        </button>
        <button className={'btn ' + (isShip ? 'ship' : 'milk') + ' sm'} disabled={!selected.size}>
          {isShip ? <I.Box size={13}/> : <I.Pallet size={13}/>}
          lot 만들기 ({selected.size})
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
                  <div key={it.id} className={'inbox-item' + (sel ? ' selected' : '') + (it.staged ? ' staged' : '')} onClick={() => toggle(it.id)}>
                    <div className="top-row">
                      <div className={'cb ' + (sel ? 'on' : '')}>{sel && <I.Check size={11}/>}</div>
                      <span className="mono" style={{fontSize:11, color:'var(--text-2)'}}>{it.po}</span>
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
                      {it.staged && <span className="pill" style={{background:'var(--warn-soft)', color:'var(--warn)'}}>스테이징</span>}
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
              <div className="ttl">복합키 선택</div>
              <div className="sub">
                좌측에서 같은 센터의 복합키를 골라 {isShip ? '박스 + 송장' : '팔레트 + 다중 SKU'} lot을 구성합니다.<br/>
                한 발주번호는 분할되지 않으니 전량을 lot에 넣거나, "다음 차수로" 버튼으로 통째로 이월하세요.
              </div>
            </div>
          ) : (
            <BuilderInline kind={kind} items={items.filter(i => selected.has(i.id))} onClose={() => setSelected(new Set())} invoicePrinter={invoicePrinter} palletOptim={palletOptim}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Lot builder =====
function BuilderInline({ kind, items, onClose, invoicePrinter, palletOptim }) {
  const isShip = kind === 'ship';
  const [containers, setContainers] = useState(() => isShip
    ? [{ id: 'b1', label: '박스 1' }]
    : [{ id: 'p1', label: '팔레트 1', preset: 'T11', cap: 192 }]);
  const [allocations, setAllocations] = useState({});
  const setAlloc = (itemId, contId, val) => setAllocations(p => ({ ...p, [itemId]: { ...p[itemId], [contId]: Math.max(0, +val || 0) } }));
  const remaining = (it) => it.qty - Object.values(allocations[it.id] || {}).reduce((s, v) => s + (+v || 0), 0);
  const addContainer = () => {
    const idx = containers.length + 1;
    setContainers([...containers, isShip ? { id: 'b'+idx, label: '박스 '+idx } : { id: 'p'+idx, label: '팔레트 '+idx, preset: 'T11', cap: 192 }]);
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
          <div style={{fontSize:14, fontWeight:600}}>{isShip ? '쉽먼트' : '밀크런'} lot 빌더</div>
          <div style={{fontSize:11, color:'var(--text-3)'}}>{items.length}개 복합키 · 총 {items.reduce((s,i)=>s+i.qty,0)}개 · {wh}</div>
        </div>
        <div style={{flex:1}}/>
        {!allFromSameWh && <span className="badge warn"><I.AlertTriangle size={11}/> 센터 혼합</span>}
        <button className="btn ghost sm" onClick={onClose}><I.X size={13}/> 취소</button>
      </div>

      <div className="source-list">
        <div className="source-list-head">
          <span>선택된 복합키 (전량 배치 필수 — 분할 불가)</span>
          <span style={{flex:1}}/>
        </div>
        {items.map(it => {
          const rem = remaining(it);
          return (
            <div key={it.id} className="source-row">
              <span className="badge" style={{minWidth:48, justifyContent:'center'}}>{it.wh}</span>
              <span className="barcode">{it.sku}</span>
              <span className="name">{it.name}</span>
              <span className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{it.po}</span>
              <span className="qty">
                {it.qty}
                {rem !== it.qty && <span style={{marginLeft:4, color: rem === 0 ? 'var(--ok)' : 'var(--warn)'}}>{rem === 0 ? '· 완료' : `· ${rem} 남음`}</span>}
              </span>
            </div>
          );
        })}
      </div>

      <div className="builder-canvas">
        <h3>
          {isShip ? <I.Box size={14}/> : <I.Pallet size={14}/>}
          {isShip ? '박스' : '팔레트'} 구성
          <span style={{fontWeight:400, color:'var(--text-3)', fontSize:11}}>· {containers.length}개</span>
          <div style={{flex:1}}/>
          {!isShip && palletOptim && <button className="btn plugin sm"><I.Plug size={11}/> 자동 최적화</button>}
          <button className="btn sm" onClick={addContainer}><I.Plus size={12}/> 추가</button>
        </h3>

        <div className="pallet-grid">
          {containers.map(c => {
            const total = items.reduce((s, it) => s + (+(allocations[it.id]?.[c.id]) || 0), 0);
            return (
              <div key={c.id} className={'pallet-card ' + (isShip ? 'ship' : '') + (total === 0 ? ' empty' : '')}>
                <div className="label">{isShip ? <I.Box size={11}/> : <I.Pallet size={11}/>}{c.label}</div>
                {isShip ? (
                  <input placeholder="송장번호" style={{height:24, padding:'0 6px', border:'1px solid var(--border)', borderRadius:3, fontFamily:'JetBrains Mono', fontSize:11, background:'white'}}/>
                ) : (
                  <div className="preset">{c.preset} · 최대 {c.cap}개</div>
                )}
                <div className="stack">{Array.from({length:6}).map((_,j) => <span key={j} style={{height: total === 0 ? '20%' : `${30 + (j*8) % 60}%`}}/>)}</div>
                <div style={{display:'flex', flexDirection:'column', gap:3, marginTop:4}}>
                  {items.map(it => (
                    <div key={it.id} style={{display:'flex', alignItems:'center', gap:4, fontSize:10}}>
                      <span style={{flex:1, color:'var(--text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.name}</span>
                      <input type="number" placeholder="0" value={allocations[it.id]?.[c.id] || ''} onChange={e => setAlloc(it.id, c.id, e.target.value)}
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

        <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:14, paddingTop:14, borderTop:'1px solid var(--border-soft)'}}>
          <button className="btn sm">초안 저장</button>
          {isShip && invoicePrinter && <button className="btn plugin sm"><I.Plug size={11}/><I.Printer size={12}/> 라벨 일괄 출력</button>}
          {isShip && <button className="btn sm"><I.Printer size={12}/> 라벨 출력</button>}
          <button className={'btn ' + (isShip ? 'ship' : 'milk')}><I.Check size={13}/> 스테이징 확정</button>
          <button className="btn primary"><I.Send size={13}/> 사이트 업로드</button>
        </div>
      </div>
    </div>
  );
}

// ===== HISTORY =====
function HistoryView({ job }) {
  const [filter, setFilter] = useState('current'); // current | all
  const items = filter === 'current' ? HISTORY.filter(h => h.jobId === job.id) : HISTORY;
  return (
    <div className="job-view">
      <div className="summary-row">
        <div className="stat"><div className="lbl">이 차수 파일</div><div className="val">{HISTORY.filter(h => h.jobId === job.id).length}<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">전체 누적</div><div className="val">{HISTORY.length}<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">오늘 출고</div><div className="val">432<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">평균 처리</div><div className="val">11<span className="u">분</span></div></div>
      </div>
      <div className="tool-row">
        <div className="search"><I.Search size={13} stroke="var(--text-3)"/><input placeholder="발주번호·파일명"/></div>
        <div style={{display:'flex', gap:4}}>
          <button className={'chip' + (filter === 'current' ? ' active' : '')} onClick={() => setFilter('current')}>이 차수만 <span className="n">{HISTORY.filter(h => h.jobId === job.id).length}</span></button>
          <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>전체 <span className="n">{HISTORY.length}</span></button>
        </div>
        <div style={{flex:1}}/>
        <button className="btn sm"><I.Download size={13}/> 전체 내보내기</button>
      </div>
      <div style={{flex:1, overflow:'auto', padding:16}}>
        {items.length === 0 && <div className="empty"><div className="ic"><I.FolderOpen size={20} stroke="var(--text-3)"/></div><div className="ttl">아직 파일 없음</div><div className="sub">발주확정/쉽먼트/밀크런이 업로드되면 여기에 누적됩니다.</div></div>}
        {items.map(h => (
          <div key={h.id} className="history-row">
            <div style={{width:36, height:36, borderRadius:6, background: h.kind.includes('쉽먼트') ? 'var(--ship-soft)' : h.kind.includes('밀크런') ? 'var(--milk-soft)' : 'var(--accent-soft)', color: h.kind.includes('쉽먼트') ? 'var(--ship)' : h.kind.includes('밀크런') ? 'var(--milk)' : 'var(--accent-strong)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              {h.kind.includes('쉽먼트') ? <I.Box size={16}/> : h.kind.includes('밀크런') ? <I.Pallet size={16}/> : <I.CheckCircle size={16}/>}
            </div>
            <div>
              <div style={{fontSize:13, fontWeight:600}}>{h.kind} <span style={{fontSize:11, color:'var(--text-3)', fontWeight:400, marginLeft:6}}>{h.wh}</span></div>
              <div style={{fontSize:11, color:'var(--text-3)'}}>
                <span className="mono">{h.count}</span>개
                {h.lots > 0 && <> · <span className="mono">{h.lots}</span> lot</>}
                · {h.files.length}개 파일
                {h.poList && <> · 발주 <span className="mono">{h.poList.slice(0,2).join(', ')}{h.poList.length > 2 ? ` 외 ${h.poList.length - 2}` : ''}</span></>}
              </div>
            </div>
            <div className="when">{h.when}</div>
            <button className="btn sm"><I.FolderOpen size={12}/> 폴더</button>
            <button className="btn sm primary"><I.Download size={12}/> 다운</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== PO UPDATE MODAL =====
function PoUpdateModal({ onClose }) {
  const [source, setSource] = useState('coupang');
  const [filterKind, setFilterKind] = useState('time');
  const [from, setFrom] = useState('2026-05-04T09:00');
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h3><I.RefreshCw size={14}/>PO 갱신</h3>
          <div className="sub">쿠팡에서 새 발주서를 가져오거나 Excel을 업로드합니다.</div>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>소스</label>
            <div className="radio-group">
              <div className={'radio' + (source === 'coupang' ? ' on' : '')} onClick={() => setSource('coupang')}>
                <div className="dot"/>
                <div className="label">쿠팡 사이트에서 받기 <div className="desc">웹뷰 자동화로 발주 목록 조회</div></div>
              </div>
              <div className={'radio' + (source === 'excel' ? ' on' : '')} onClick={() => setSource('excel')}>
                <div className="dot"/>
                <div className="label">Excel 업로드 <div className="desc">쿠팡에서 직접 다운로드한 발주 엑셀 파일</div></div>
              </div>
            </div>
          </div>
          {source === 'coupang' && (
            <div className="field">
              <label>발주일시 필터</label>
              <div className="radio-group">
                <div className={'radio' + (filterKind === 'time' ? ' on' : '')} onClick={() => setFilterKind('time')}>
                  <div className="dot"/>
                  <div className="label" style={{display:'flex', alignItems:'center', gap:8}}>
                    <span>발주일시 ≥</span>
                    <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} style={{flex:1, padding:'4px 8px', border:'1px solid var(--border-strong)', borderRadius:4, fontFamily:'JetBrains Mono', fontSize:11}}/>
                  </div>
                </div>
                <div className={'radio' + (filterKind === 'all' ? ' on' : '')} onClick={() => setFilterKind('all')}>
                  <div className="dot"/>
                  <div className="label">전체 가져오기 <div className="desc">중복 제외만 적용</div></div>
                </div>
              </div>
            </div>
          )}
          <div className="field">
            <label>중복 처리</label>
            <div style={{padding:10, background:'var(--bg-panel-2)', borderRadius:5, fontSize:12, lineHeight:1.7}}>
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                <I.Check size={12} stroke="var(--ok)"/>
                <span>다른 차수에서 처리 중인 발주번호 자동 제외</span>
              </div>
              <div style={{fontSize:11, color:'var(--text-3)', marginTop:4}}>
                현재 5/5 1차에서 4건 처리 중 — 갱신 시 스킵됨
              </div>
            </div>
          </div>
          <div style={{padding:10, background:'var(--accent-soft)', borderRadius:5, fontSize:12, color:'var(--accent-strong)', display:'flex', alignItems:'flex-start', gap:8}}>
            <I.Info size={13} style={{flexShrink:0, marginTop:1}}/>
            <span>예상 결과 — 신규 <strong>14건</strong>, 중복 제외 <strong>4건</strong>, 발주일시 필터 <strong>2건</strong> 제외</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary"><I.RefreshCw size={13}/> 받기</button>
        </div>
      </div>
    </div>
  );
}

// ===== UPLOAD MODAL =====
function UploadModal({ stage, onClose, vendor }) {
  const steps = [
    { k: 'login', label: '로그인', detail: `partition: ${vendor.id}` },
    { k: 'navigate', label: '발주확정 화면 진입', detail: '/po/confirm' },
    { k: 'upload', label: '확정서 업로드', detail: '10 rows' },
    { k: 'verify', label: '결과 확인', detail: 'POST 200' },
    { k: 'route', label: '인박스 라우팅', detail: 'ship +4 · milk +6' },
  ];
  const idx = stage === 'countdown' ? -1 : ['login','navigate','upload','verify','route','done'].indexOf(stage);

  return (
    <div className="overlay">
      <div className="modal" style={{width:460}}>
        {stage === 'countdown' ? <CountdownInner/> : (
          <>
            <div className="modal-head">
              <h3><I.Loader size={14} stroke="var(--accent)"/>{stage === 'done' ? '업로드 완료' : '쿠팡 자동화 진행 중'}</h3>
              <div className="sub">웹뷰 창에서 진행 상황 확인</div>
            </div>
            <div className="modal-body">
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {steps.map((s, i) => (
                  <div key={s.k} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:5,
                    background: i < idx ? 'var(--ok-soft)' : i === idx ? 'var(--accent-soft)' : 'var(--bg-panel-2)',
                    color: i < idx ? 'var(--ok)' : i === idx ? 'var(--accent-strong)' : 'var(--text-2)',
                    fontWeight: i === idx ? 600 : 400, fontSize: 12}}>
                    <div style={{width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                      background: i <= idx ? 'currentColor' : 'var(--bg-panel-3)', color: i <= idx ? 'white' : 'var(--text-3)'}}>
                      {i < idx ? <I.Check size={12}/> : i === idx ? <span style={{width:6, height:6, borderRadius:'50%', background:'currentColor', animation:'blink 0.8s infinite'}}/> : i + 1}
                    </div>
                    <div>{s.label}</div>
                    <span className="mono" style={{fontSize:10, color:'inherit', opacity:0.7, marginLeft:'auto'}}>{s.detail}</span>
                  </div>
                ))}
              </div>
              {stage === 'done' && (
                <div style={{marginTop:12, padding:'10px 14px', background:'var(--ok-soft)', borderRadius:5, fontSize:12, color:'var(--ok)', fontWeight:600, display:'flex', alignItems:'center', gap:8}}>
                  <I.CheckCircle size={14}/>
                  4건 → 쉽먼트, 6건 → 밀크런 인박스로 라우팅됨
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className={'btn ' + (stage === 'done' ? 'primary' : 'ghost')} onClick={onClose}>
                {stage === 'done' ? '인박스로 이동' : '백그라운드'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function CountdownInner() {
  const [n, setN] = useState(3);
  useEffect(() => { if (n <= 0) return; const t = setTimeout(() => setN(n - 1), 900); return () => clearTimeout(t); }, [n]);
  const r = 36, c = 2 * Math.PI * r, p = (3 - n) / 3;
  return (
    <>
      <div className="modal-head" style={{textAlign:'center', borderBottom:'none'}}>
        <h3 style={{justifyContent:'center'}}><I.AlertTriangle size={14} stroke="var(--warn)"/>발주확정 업로드 직전</h3>
        <div className="sub">취소하려면 ESC</div>
      </div>
      <div className="modal-body" style={{paddingTop:0}}>
        <div style={{width:80, height:80, margin:'0 auto 12px', position:'relative'}}>
          <svg width="80" height="80" style={{transform:'rotate(-90deg)'}}>
            <circle cx="40" cy="40" r={r} stroke="var(--bg-panel-3)" strokeWidth="5" fill="none"/>
            <circle cx="40" cy="40" r={r} stroke="var(--accent)" strokeWidth="5" fill="none"
              strokeDasharray={c} strokeDashoffset={c * (1 - p)}
              style={{transition:'stroke-dashoffset 0.9s linear'}} strokeLinecap="round"/>
          </svg>
          <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'JetBrains Mono', fontSize:30, fontWeight:600}}>{n > 0 ? n : '✓'}</div>
        </div>
        <div style={{textAlign:'center', fontSize:12, color:'var(--text-2)'}}>
          <strong style={{color:'var(--text)'}}>10 SKU</strong> · 4 ship + 6 milk · 반려 1건<br/>확정 후 자동 라우팅
        </div>
      </div>
    </>
  );
}

window.JobView = JobView;
window.STEPS = STEPS;
