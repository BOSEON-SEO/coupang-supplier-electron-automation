// Job window v4 — sidebar only (no top stepper, no info panel)
const { ACTIVE_ROWS: V4_ACTIVE, SHIP_INBOX: V4_SHIP, MILK_INBOX: V4_MILK, HISTORY: V4_HIST } = window.V3;

const STEPS_V4 = [
  { key: 'review',  name: '검토',         desc: '행 단위 OK/반려' },
  { key: 'confirm', name: '확정 + 방법',  desc: '운송방법 + 업로드' },
  { key: 'ship',    name: '쉽먼트 배정',  desc: '박스 lot 구성' },
  { key: 'milk',    name: '밀크런 배정',  desc: '팔레트 lot 구성' },
  { key: 'history', name: '결과',         desc: '파일 다운' },
];

function JobViewV4({ job, vendor, plugins, onBack, onRequestPluginWindow }) {
  const { useState, useMemo, useEffect } = React;
  const [view, setView] = useState('review');
  const [rows, setRows] = useState(V4_ACTIVE);
  // 미배정 풀 (lot 안 묶인 복합키) — kind 별. 항목별 원본 수량 보존하기 위해 total 필드 추가
  const [shipInbox, setShipInbox] = useState(() => V4_SHIP.map(i => ({ ...i, total: i.qty })));
  const [milkInbox, setMilkInbox] = useState(() => V4_MILK.map(i => ({ ...i, total: i.qty })));
  // 만든 lot 목록 — kind 별
  const [lots, setLots] = useState({ ship: [], milk: [] });
  // 사이트 업로드 history — kind 별 (대시보드/결과 표시용)
  const [uploadHistory, setUploadHistory] = useState({ ship: [], milk: [] });
  // 업로드 모달 stage — 'countdown' | 'login' | ... | 'done'
  const [uploadStage, setUploadStage] = useState(null);
  // 업로드 중인 lot (lot 업로드면 set, 발주확정 업로드면 null)
  const [uploadingLot, setUploadingLot] = useState(null); // { kind, lotIds }
  // 업로드 모달이 백그라운드로 숨겨졌는지 — true 면 모달 미렌더, 헤더 인디케이터로 표시
  const [uploadBackground, setUploadBackground] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const tbnws = plugins.find(p => p.id === 'tbnws' && p.enabled);
  const invoicePrinter = plugins.find(p => p.id === 'invoice-printer' && p.enabled);
  const palletOptim = plugins.find(p => p.id === 'pallet-optim' && p.enabled);

  const allSteps = useMemo(() => {
    const s = [...STEPS_V4];
    if (tbnws) {
      const idx = s.findIndex(x => x.key === 'confirm');
      s.splice(idx + 1, 0, { key: 'admin-sync', name: '어드민 동기화', desc: 'tbnws 플러그인', plugin: 'tbnws' });
    }
    return s;
  }, [tbnws]);

  const reviewedCount = rows.filter(r => r.reviewed).length;
  const unreviewedCount = rows.length - reviewedCount;
  const acceptedRows = rows.filter(r => r.confQty > 0);

  const counts = {
    review: rows.length,
    confirm: acceptedRows.length,
    'admin-sync': tbnws ? 4 : null,
    ship: shipInbox.length, // 미배정 + lot 갯수가 직관적이지 않아서 미배정만 카운트
    milk: milkInbox.length,
    history: V4_HIST.filter(h => h.jobId === job.id).length + uploadHistory.ship.length + uploadHistory.milk.length,
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

  // 업로드 stage 가 사라지면 백그라운드 플래그 리셋
  useEffect(() => { if (!uploadStage) setUploadBackground(false); }, [uploadStage]);

  // 업로드 상태를 외부(헤더 인디케이터)에 broadcast
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('app:upload:state', { detail: {
      active: !!uploadStage,
      background: uploadBackground,
      stage: uploadStage,
      kind: uploadingLot?.kind,
      batchCount: uploadingLot?.count,
    }}));
  }, [uploadStage, uploadBackground, uploadingLot]);

  // 외부에서 모달 복귀 요청 시 백그라운드 해제
  useEffect(() => {
    const h = () => setUploadBackground(false);
    window.addEventListener('app:upload:restore', h);
    return () => window.removeEventListener('app:upload:restore', h);
  }, []);

  // 업로드 완료 시 lot 업로드면 lot 표시 + history 추가
  useEffect(() => {
    if (uploadStage !== 'done' || !uploadingLot) return;
    const { kind, lotIds } = uploadingLot;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const at = `${hh}:${mm}`;
    setLots(s => ({
      ...s,
      [kind]: s[kind].map(l => lotIds.includes(l.id) ? { ...l, uploaded: true, uploadedAt: at } : l),
    }));
    const uploadedLots = lots[kind].filter(l => lotIds.includes(l.id));
    const totalQty = uploadedLots.reduce((sum, l) => sum + l.totalQty, 0);
    setUploadHistory(s => ({
      ...s,
      [kind]: [...s[kind], { id: 'u-' + Date.now(), at, lotIds, totalQty }],
    }));
  }, [uploadStage, uploadingLot]);

  // lot 만들기 — 실제 배정된 수량만 기록. 남은 수량은 미배정 풀에 그대로 유지.
  const createLot = (kind, selectedItems, containers, allocations) => {
    const allocatedFor = (itId) => containers.reduce((s, ct) => s + (+(allocations[itId]?.[ct.id]) || 0), 0);

    // 컨테이너별 항목 분포
    const lotContainers = containers
      .map(c => {
        const cItems = selectedItems
          .map(it => ({ id: it.id, sku: it.sku, name: it.name, po: it.po, qty: +(allocations[it.id]?.[c.id]) || 0 }))
          .filter(x => x.qty > 0);
        return {
          id: c.id, label: c.label, preset: c.preset, cap: c.cap,
          total: cItems.reduce((s, x) => s + x.qty, 0),
          items: cItems,
        };
      })
      .filter(c => c.total > 0);

    if (lotContainers.length === 0) return; // 아무것도 안 배정됨

    // lot 항목 (실제 배정 수량으로 압축)
    const lotItems = selectedItems
      .map(i => ({ id: i.id, name: i.name, sku: i.sku, po: i.po, qty: allocatedFor(i.id) }))
      .filter(i => i.qty > 0);

    const totalQty = lotItems.reduce((s, i) => s + i.qty, 0);
    const lotId = 'L-' + kind + '-' + (lots[kind].length + 1).toString().padStart(2, '0');
    const lot = {
      id: lotId,
      kind,
      label: kind === 'ship' ? `쉽먼트 lot #${lots[kind].length + 1}` : `밀크런 lot #${lots[kind].length + 1}`,
      wh: selectedItems[0]?.wh,
      items: lotItems,
      containers: lotContainers,
      totalContainers: lotContainers.length,
      totalQty,
      uploaded: false,
      uploadedAt: null,
      createdAt: new Date(),
    };
    setLots(s => ({ ...s, [kind]: [...s[kind], lot] }));

    // 미배정 풀: 사용한 만큼 차감. qty=0 이어도 항목은 유지 (UI 에서 흐림 + 체크 표시)
    const setInbox = kind === 'ship' ? setShipInbox : setMilkInbox;
    setInbox(its => its.map(i => {
      const used = allocatedFor(i.id);
      if (!used) return i;
      return { ...i, qty: i.qty - used };
    }));
  };

  // lot 취소 — 안에 있던 item 들 다시 미배정 풀로 릴리즈
  const cancelLot = (kind, lotId) => {
    const lot = lots[kind].find(l => l.id === lotId);
    if (!lot || lot.uploaded) return;
    const setInbox = kind === 'ship' ? setShipInbox : setMilkInbox;
    setInbox(prev => {
      const next = [...prev];
      for (const it of lot.items) {
        const idx = next.findIndex(x => x.id === it.id);
        if (idx >= 0) {
          next[idx] = { ...next[idx], qty: next[idx].qty + it.qty };
        } else {
          next.push({
            id: it.id, po: it.po, sku: it.sku, name: it.name, qty: it.qty,
            wh: lot.wh, jobDate: '2026-05-06', seq: 1, age: '복원',
          });
        }
      }
      return next;
    });
    setLots(s => ({ ...s, [kind]: s[kind].filter(l => l.id !== lotId) }));
  };

  const uploadLots = (kind, lotsArr) => {
    if (!lotsArr || lotsArr.length === 0) return;
    setUploadingLot({ kind, lotIds: lotsArr.map(l => l.id), count: lotsArr.length });
    setUploadStage('countdown');
  };

  const askExclude = (rowId, label) => {
    setConfirmDialog({
      title: '이번 차수에서 제외',
      message: <>이 행을 <strong>{job.label}</strong>에서 제외합니다.<br/><span style={{fontSize:11, color:'var(--text-3)'}}>제외된 행은 미배정 상태로 돌아가 다른 차수에 배정될 수 있습니다.</span></>,
      onConfirm: () => {
        setRows(rs => rs.filter(r => r.id !== rowId));
        setConfirmDialog(null);
      }
    });
  };
  const askExcludeInbox = (kind, ids) => {
    setConfirmDialog({
      title: '이번 차수에서 제외',
      message: <>{ids.length}건을 <strong>{job.label}</strong>의 {kind === 'ship' ? '쉽먼트' : '밀크런'} 인박스에서 제외합니다.<br/><span style={{fontSize:11, color:'var(--text-3)'}}>각 복합키는 분할되지 않고 전량 함께 제외됩니다.</span></>,
      onConfirm: () => {
        if (kind === 'ship') setShipInbox(its => its.filter(i => !ids.includes(i.id)));
        else setMilkInbox(its => its.filter(i => !ids.includes(i.id)));
        setConfirmDialog(null);
      }
    });
  };

  return (
    <div className="job-shell">
      <div className="job-side">
        {onBack && (
          <button className="sb-back" onClick={onBack} title="해당 날짜 PO 리스트로">
            <I.ChevronL size={13}/>
            <span>{job.date.slice(5).replace('-','/')} 작업목록으로</span>
          </button>
        )}
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

        {view === 'review' && <ReviewViewV4 rows={rows} setRows={setRows} tbnws={tbnws} onExclude={askExclude}/>}
        {view === 'confirm' && <ConfirmViewV4 rows={rows} setRows={setRows} onUpload={() => { setUploadingLot(null); setUploadStage('countdown'); }}/>}
        {view === 'admin-sync' && <AdminSyncViewV4 onOpenPluginWindow={() => onRequestPluginWindow('tbnws-admin')}/>}
        {view === 'ship' && <LotAssignViewV4 kind="ship" items={shipInbox} setItems={setShipInbox} lots={lots.ship} uploadHistory={uploadHistory.ship} createLot={createLot} uploadLot={uploadLots} cancelLot={cancelLot} invoicePrinter={invoicePrinter} onExclude={askExcludeInbox}/>}
        {view === 'milk' && <LotAssignViewV4 kind="milk" items={milkInbox} setItems={setMilkInbox} lots={lots.milk} uploadHistory={uploadHistory.milk} createLot={createLot} uploadLot={uploadLots} cancelLot={cancelLot} palletOptim={palletOptim} onExclude={askExcludeInbox}/>}
        {view === 'history' && <HistoryViewV4 job={job} lots={lots} uploadHistory={uploadHistory}/>}

        {uploadStage && !uploadBackground && (
          <UploadModalV4
            stage={uploadStage}
            kind={uploadingLot?.kind}
            batchCount={uploadingLot?.count}
            onClose={() => {
              setUploadStage(null);
              if (uploadStage === 'done' && !uploadingLot) setView('ship');
              if (uploadStage === 'done') setUploadingLot(null);
            }}
            onBackground={() => setUploadBackground(true)}
            vendor={vendor}
          />
        )}
        {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)}/>}
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  return (
    <div className="overlay">
      <div className="modal" style={{width:380}}>
        <div className="modal-head">
          <h3><I.AlertTriangle size={14} stroke="var(--warn)"/>{title}</h3>
        </div>
        <div className="modal-body" style={{fontSize:13, lineHeight:1.7}}>{message}</div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>취소</button>
          <button className="btn danger" onClick={onConfirm}>제외</button>
        </div>
      </div>
    </div>
  );
}

function ReviewViewV4({ rows, setRows, tbnws, onExclude }) {
  const { useState, useMemo } = React;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const reviewedCount = rows.filter(r => r.reviewed).length;
  const unreviewedCount = rows.length - reviewedCount;
  const rejectedCount = rows.filter(r => r.confQty === 0 || r.short).length;

  let filt = rows.filter(r => !search || `${r.po} ${r.name} ${r.barcode}`.includes(search));
  if (filter === 'unreviewed') filt = filt.filter(r => !r.reviewed);
  if (filter === 'rejected') filt = filt.filter(r => r.confQty === 0);

  const setQty = (id, q) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: q, reviewed: true, short: q === 0 ? (r.short || '협력사 재고') : '' } : r));
  const reject = (id) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: 0, short: '협력사 재고', reviewed: true } : r));
  const accept = (id) => setRows(rs => rs.map(r => r.id === id ? { ...r, confQty: r.reqQty, short: '', reviewed: true } : r));

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
                {list.map((r, i) => <ReviewRowV4 key={r.id} r={r} i={i} tbnws={tbnws} setQty={setQty} accept={accept} reject={reject} onExclude={onExclude}/>)}
              </React.Fragment>
            )) : filt.map((r, i) => <ReviewRowV4 key={r.id} r={r} i={i} tbnws={tbnws} setQty={setQty} accept={accept} reject={reject} onExclude={onExclude}/>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewRowV4({ r, i, tbnws, setQty, accept, reject, onExclude }) {
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
          <button className="btn sm ghost" title="이번 차수에서 제외" onClick={() => onExclude(r.id, r.po)} style={{height:22, padding:'0 5px', fontSize:10}}><I.X size={11}/></button>
        </div>
      </td>
    </tr>
  );
}

function ConfirmViewV4({ rows, setRows, onUpload }) {
  const { useState } = React;
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

function AdminSyncViewV4({ onOpenPluginWindow }) {
  return (
    <div className="empty">
      <div className="ic" style={{background:'var(--plugin-soft)'}}><I.Plug size={20} stroke="var(--plugin)"/></div>
      <div className="ttl" style={{color:'var(--plugin)'}}>tbnws · 어드민 동기화</div>
      <div className="sub">tbnws 플러그인이 추가한 단계입니다. 플러그인 창이 열리고 메인 창은 잠깁니다.</div>
      <button className="btn plugin" onClick={onOpenPluginWindow}>
        <I.Plug size={13}/> 플러그인 창 열기 (메인 잠금)
      </button>
    </div>
  );
}

function LotAssignViewV4({ kind, items, setItems, lots, uploadHistory, createLot, uploadLot, cancelLot, invoicePrinter, palletOptim, onExclude }) {
  const { useState, useMemo } = React;
  const isShip = kind === 'ship';
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  // 완료된 항목 클릭 시 해당 lot 으로 포커스
  const [focusLotId, setFocusLotId] = useState(null);

  const filtered = useMemo(() =>
    items.filter(it => !search || `${it.po} ${it.sku} ${it.name} ${it.wh}`.includes(search))
  , [items, search]);

  const groups = useMemo(() => {
    const g = {};
    filtered.forEach(it => { (g[it.wh] = g[it.wh] || []).push(it); });
    const entries = Object.entries(g);
    // 그룹 내 정렬: 미배정(qty>0) 먼저, 완료(qty=0) 뒤
    entries.forEach(([_, list]) => list.sort((a, b) => (b.qty > 0 ? 1 : 0) - (a.qty > 0 ? 1 : 0)));
    // 그룹 정렬: 활성 그룹 먼저, 완료(전부 qty=0) 그룹 맨 아래
    entries.sort(([_, a], [__, b]) => {
      const aActive = a.some(i => i.qty > 0);
      const bActive = b.some(i => i.qty > 0);
      return (bActive ? 1 : 0) - (aActive ? 1 : 0);
    });
    return entries;
  }, [filtered]);

  // 완료된 항목 클릭 → 그 항목을 포함한 가장 최근 lot 찾아서 포커스
  const focusLotForItem = (itemId) => {
    const found = [...lots].reverse().find(l => l.items.some(it => it.id === itemId));
    if (found) {
      setFocusLotId(found.id);
      setTimeout(() => setFocusLotId(null), 1800); // 잠깐 하이라이트 후 해제
    }
  };

  const activeItems = items.filter(i => i.qty > 0);
  const unassignedQty = activeItems.reduce((s, i) => s + i.qty, 0);
  const totalContainers = lots.reduce((s, l) => s + l.totalContainers, 0);
  const totalLotQty = lots.reduce((s, l) => s + l.totalQty, 0);
  const uploadedCount = lots.filter(l => l.uploaded).length;
  const lastUploadAt = uploadHistory.length > 0 ? uploadHistory[uploadHistory.length - 1].at : null;
  const todayCount = activeItems.filter(i => i.jobDate === '2026-05-06').length;
  const carryCount = activeItems.length - todayCount;

  // lot 의 목적지(센터) 잠금 — 첫 항목 선택 후엔 같은 wh 만 추가 가능
  const lockedWh = useMemo(() => {
    if (selected.size === 0) return null;
    const first = items.find(i => selected.has(i.id));
    return first?.wh || null;
  }, [selected, items]);

  const toggle = (id) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (lockedWh && item.wh !== lockedWh && !selected.has(id)) return; // 다른 센터 추가 차단
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const clearSelected = () => setSelected(new Set());

  const handleCreateLot = (containers, allocations) => {
    const sel = items.filter(i => selected.has(i.id));
    if (sel.length === 0) return;
    createLot(kind, sel, containers, allocations);
    clearSelected();
  };

  return (
    <div className="job-view">
      <div className="summary-row" style={{borderTop: `2px solid ${isShip ? 'var(--ship)' : 'var(--milk)'}`}}>
        <div className="stat"><div className="lbl">미배정</div><div className="val">{activeItems.length}<span className="u">건 · {unassignedQty.toLocaleString()}개</span></div></div>
        <div className="stat"><div className="lbl">내 lot</div><div className="val" style={{color: isShip ? 'var(--ship)' : 'var(--milk)'}}>{lots.length}<span className="u">개 · {totalContainers}{isShip ? '박스' : '팔레트'} · {totalLotQty.toLocaleString()}개</span></div></div>
        <div className="stat"><div className="lbl">사이트 업로드</div><div className="val" style={{color: uploadedCount > 0 ? 'var(--ok)' : 'var(--text-3)'}}>{uploadHistory.length}<span className="u">회{lastUploadAt ? ` · ${lastUploadAt}` : ''}</span></div></div>
        <div className="stat"><div className="lbl">이월</div><div className="val" style={{color: carryCount > 0 ? 'var(--warn)' : 'var(--text-3)'}}>{carryCount}<span className="u">건</span></div></div>
      </div>

      <div className="lot-assign-wrap">
        <div className="lot-unassigned">
          <div className="lot-unassigned-head">
            <I.Search size={13} stroke="var(--text-3)"/>
            <input placeholder="센터·발주·SKU 검색" value={search} onChange={e => setSearch(e.target.value)} style={{flex:1, border:'none', outline:'none', fontSize:12, background:'transparent'}}/>
            {selected.size > 0 && (
              <button className="btn sm danger" style={{height:22, fontSize:10, padding:'0 6px'}} onClick={() => onExclude(kind, [...selected])} title="이번 차수에서 제외">
                <I.X size={11}/> 제외 {selected.size}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="empty" style={{padding:30}}>
              <div className="ic">{isShip ? <I.Box size={18} stroke="var(--text-3)"/> : <I.Pallet size={18} stroke="var(--text-3)"/>}</div>
              <div className="ttl">항목 없음</div>
              <div className="sub">확정 후 lot 배정으로 라우팅된 항목이 없습니다.</div>
            </div>
          ) : groups.map(([wh, list]) => {
            const groupDisabled = !!lockedWh && wh !== lockedWh;
            const groupComplete = list.every(i => i.qty === 0);
            return (
              <div key={wh} className={groupDisabled ? 'inbox-group-disabled' : ''}>
                <div className="inbox-group-head">
                  <I.Building size={11}/>
                  <span>{wh}</span>
                  {wh === lockedWh && <span className="badge accent" style={{fontSize:9, padding:'1px 5px'}}>현재 lot 목적지</span>}
                  {groupComplete && <span className="badge ok" style={{fontSize:9, padding:'1px 5px'}}><I.Check size={9}/> 완료</span>}
                  <span style={{flex:1}}/>
                  <span className="mono" style={{fontWeight:400, fontSize:10}}>
                    {list.filter(i => i.qty > 0).length}/{list.length}건 · {list.reduce((s,i)=>s+i.qty,0)}/{list.reduce((s,i)=>s+(i.total||i.qty),0)}개
                  </span>
                </div>
                {list.map(it => {
                  const consumed = it.qty === 0;
                  const sel = selected.has(it.id);
                  const disabled = !consumed && groupDisabled && !sel;
                  return (
                    <div
                      key={it.id}
                      className={'inbox-item' + (sel ? ' selected' : '') + (disabled ? ' disabled' : '') + (consumed ? ' consumed' : '')}
                      onClick={() => {
                        if (consumed) { focusLotForItem(it.id); return; }
                        if (!disabled) toggle(it.id);
                      }}
                      title={consumed ? '클릭 — 이 항목이 들어간 lot 보기' : disabled ? '다른 센터의 항목 — 같은 lot 에 못 섞음' : ''}
                    >
                      <div className="top-row">
                        <div className={'cb ' + (consumed || sel ? 'on' : '')}>{(consumed || sel) && <I.Check size={11}/>}</div>
                        <span className="mono" style={{fontSize:11, color:'var(--text-2)'}}>{it.po}</span>
                        <span className="age">{consumed ? 'lot 배정됨' : it.age}</span>
                      </div>
                      <div className="skus">
                        <div className="sku-line">
                          <span className="barcode">{it.sku}</span>
                          <span className="name">{it.name}</span>
                          <span className="qty">{consumed ? `${it.total || 0}` : it.qty}{consumed && it.total != null && <span style={{color:'var(--ok)', fontSize:10, marginLeft:3}}>(완료)</span>}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="lot-right">
          {selected.size > 0 && (
            <div className="lot-builder-section">
              <BuilderInlineV4
                kind={kind}
                items={items.filter(i => selected.has(i.id))}
                onClose={clearSelected}
                onCreateLot={handleCreateLot}
                invoicePrinter={invoicePrinter}
                palletOptim={palletOptim}
              />
            </div>
          )}
          <div className="lot-list-section">
            <LotListV4 kind={kind} lots={lots} onUpload={uploadLot} onCancel={cancelLot} invoicePrinter={invoicePrinter} focusLotId={focusLotId}/>
          </div>
        </div>
      </div>
    </div>
  );
}

function LotListV4({ kind, lots, onUpload, onCancel, invoicePrinter, focusLotId }) {
  const { useState, useEffect, useRef } = React;
  const [expanded, setExpanded] = useState(new Set());
  const toggleExpand = (id) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 포커스 요청 시 자동 펼침 + 스크롤
  const cardRefs = useRef({});
  useEffect(() => {
    if (!focusLotId) return;
    setExpanded(s => { const n = new Set(s); n.add(focusLotId); return n; });
    const el = cardRefs.current[focusLotId];
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focusLotId]);
  const isShip = kind === 'ship';
  const pendingLots = lots.filter(l => !l.uploaded);
  const uploadedLots = lots.filter(l => l.uploaded);
  const pendingTotalQty = pendingLots.reduce((s, l) => s + l.totalQty, 0);
  return (
    <div className="lot-list">
      <div className="lot-list-head">
        <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
          {isShip ? <I.Box size={13}/> : <I.Pallet size={13}/>}
          <span style={{fontSize:12, fontWeight:600}}>내 lot 목록</span>
          <span className="mono" style={{fontSize:10, color:'var(--text-3)', fontWeight:400}}>{lots.length}개</span>
        </span>
        <div style={{flex:1}}/>
        {lots.length > 0 && (
          <>
            <span style={{fontSize:11, color:'var(--text-3)'}}>
              대기 <strong className="mono" style={{color: pendingLots.length > 0 ? 'var(--text)' : 'var(--text-3)'}}>{pendingLots.length}</strong>
              <span style={{margin:'0 6px', color:'var(--border-strong)'}}>·</span>
              완료 <strong className="mono" style={{color:'var(--ok)'}}>{uploadedLots.length}</strong>
            </span>
            <button
              className="btn primary sm"
              disabled={pendingLots.length === 0}
              onClick={() => onUpload(kind, pendingLots)}
              title={pendingLots.length === 0 ? '대기 중인 lot 없음' : `대기 lot ${pendingLots.length}개 일괄 업로드`}
            >
              <I.Send size={12}/> 일괄 업로드 ({pendingLots.length})
            </button>
          </>
        )}
      </div>
      {lots.length === 0 ? (
        <div className="empty" style={{padding:24}}>
          <div className="ic">{isShip ? <I.Box size={18} stroke="var(--text-3)"/> : <I.Pallet size={18} stroke="var(--text-3)"/>}</div>
          <div className="ttl">아직 lot 없음</div>
          <div className="sub">왼쪽 미배정 항목을 골라 lot 을 만드세요.</div>
        </div>
      ) : (
        <div className="lot-card-list">
          {lots.map(lot => {
            const isOpen = expanded.has(lot.id);
            const isFocused = focusLotId === lot.id;
            return (
              <div
                key={lot.id}
                ref={el => { if (el) cardRefs.current[lot.id] = el; }}
                className={'lot-card ' + (isShip ? 'ship' : 'milk') + (lot.uploaded ? ' uploaded' : '') + (isOpen ? ' expanded' : '') + (isFocused ? ' focused' : '')}
              >
                <div className="lot-card-head">
                  <button className="lot-expand" onClick={() => toggleExpand(lot.id)} title={isOpen ? '접기' : '펼쳐서 박스/팔레트 상세 보기'}>
                    {isOpen ? <I.Chevron size={12} style={{transform:'rotate(90deg)'}}/> : <I.Chevron size={12}/>}
                  </button>
                  <span className="lot-id mono">{lot.id}</span>
                  <span className="lot-label">{lot.label}</span>
                  <span className="lot-wh"><I.Building size={10}/> {lot.wh}</span>
                  {lot.uploaded ? (
                    <span className="badge ok"><I.CheckCircle size={11}/> 업로드 완료 {lot.uploadedAt}</span>
                  ) : (
                    <span className="badge" style={{color:'var(--text-3)'}}>대기</span>
                  )}
                </div>
                <div className="lot-card-stats">
                  <span><strong>{lot.totalContainers}</strong>{isShip ? '박스' : '팔레트'}</span>
                  <span>·</span>
                  <span><strong>{lot.items.length}</strong>SKU</span>
                  <span>·</span>
                  <span><strong>{lot.totalQty.toLocaleString()}</strong>개</span>
                </div>

                {isOpen ? (
                  <div className="lot-card-detail">
                    {lot.containers.map(c => (
                      <div key={c.id} className="lot-container-row">
                        <div className="lot-container-head">
                          {isShip ? <I.Box size={11}/> : <I.Pallet size={11}/>}
                          <strong>{c.label}</strong>
                          {!isShip && c.preset && <span className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{c.preset} 규격</span>}
                          <span style={{flex:1}}/>
                          <span className="mono" style={{fontSize:11, fontWeight:600}}>{c.total}개</span>
                        </div>
                        <div className="lot-container-items">
                          {c.items.map(it => (
                            <div key={it.id} className="lot-container-item">
                              <span className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{it.sku}</span>
                              <span style={{flex:1}}>{it.name}</span>
                              <span className="mono" style={{fontWeight:600}}>{it.qty}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="lot-card-items">
                    {lot.items.slice(0, 3).map(it => (
                      <span key={it.id} className="lot-item-chip">
                        <span className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{it.sku}</span>
                        <span>{it.name}</span>
                        <span className="mono" style={{fontWeight:600}}>{it.qty}</span>
                      </span>
                    ))}
                    {lot.items.length > 3 && <span className="lot-item-chip more">+{lot.items.length - 3}</span>}
                  </div>
                )}

                <div className="lot-card-actions">
                  {!lot.uploaded && (
                    <button className="btn ghost sm" style={{color:'var(--danger)'}} onClick={() => onCancel && onCancel(kind, lot.id)} title="이 lot 취소 — 항목 미배정으로 복원">
                      <I.X size={11}/> lot 취소
                    </button>
                  )}
                  <div style={{flex:1}}/>
                  {isShip && invoicePrinter && (
                    <button className="btn plugin sm"><I.Plug size={11}/><I.Printer size={12}/> 라벨 일괄</button>
                  )}
                  <button className="btn sm"><I.Printer size={12}/> 라벨 출력</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BuilderInlineV4({ kind, items, onClose, onCreateLot, invoicePrinter, palletOptim }) {
  const { useState } = React;
  const isShip = kind === 'ship';
  const [containers, setContainers] = useState(() => isShip
    ? [{ id: 'b1', label: '박스 1' }]
    : [{ id: 'p1', label: '팔레트 1', preset: 'T11', cap: 192 }]);
  const [allocations, setAllocations] = useState({});
  const setAlloc = (itemId, contId, val) => setAllocations(p => ({ ...p, [itemId]: { ...p[itemId], [contId]: Math.max(0, +val || 0) } }));
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
              <div key={c.id} className={'pallet-card ' + (isShip ? 'ship' : '')}>
                <div className="label">{isShip ? <I.Box size={11}/> : <I.Pallet size={11}/>}{c.label}</div>
                {isShip ? (
                  <input placeholder="송장번호" style={{height:24, padding:'0 6px', border:'1px solid var(--border)', borderRadius:3, fontFamily:'JetBrains Mono', fontSize:11, background:'white'}}/>
                ) : (
                  <div className="preset">{c.preset} 규격</div>
                )}
                <div style={{display:'flex', flexDirection:'column', gap:3, marginTop:8}}>
                  {items.map(it => {
                    const allocSum = containers.reduce((ss, ct) => ss + (+(allocations[it.id]?.[ct.id]) || 0), 0);
                    const over = allocSum > it.qty;
                    const cellVal = +(allocations[it.id]?.[c.id]) || 0;
                    const cellOver = cellVal > it.qty;
                    return (
                      <div key={it.id} style={{display:'flex', alignItems:'center', gap:4, fontSize:10}}>
                        <span style={{flex:1, color:'var(--text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.name}</span>
                        <input type="number" placeholder="0" value={allocations[it.id]?.[c.id] || ''} onChange={e => setAlloc(it.id, c.id, e.target.value)}
                          style={{width:48, height:20, padding:'0 4px', border:'1px solid ' + ((over || cellOver) ? 'var(--danger)' : 'var(--border)'), borderRadius:3, fontFamily:'JetBrains Mono', fontSize:10, textAlign:'right', color: (over || cellOver) ? 'var(--danger)' : undefined, fontWeight: (over || cellOver) ? 600 : 400}}/>
                        <span className="mono" style={{fontSize:10, color: over ? 'var(--danger)' : 'var(--text-3)', minWidth:24, fontWeight: over ? 600 : 400}}>/ {it.qty}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="total" style={{borderTop:'1px solid var(--border-soft)', paddingTop:4, marginTop:2, textAlign:'right'}}>
                  합계 {total}
                </div>
              </div>
            );
          })}
        </div>

        {(() => {
          const requiredTotal = items.reduce((s, it) => s + it.qty, 0);
          const allocatedTotal = Object.values(allocations).reduce((s, a) => s + Object.values(a).reduce((ss, v) => ss + (+v||0), 0), 0);
          const overItems = items.filter(it => containers.reduce((ss, ct) => ss + (+(allocations[it.id]?.[ct.id]) || 0), 0) > it.qty);
          const hasOver = overItems.length > 0;
          return (
            <div style={{display:'flex', gap:8, justifyContent:'flex-end', alignItems:'center', marginTop:14, paddingTop:14, borderTop:'1px solid var(--border-soft)'}}>
              <span style={{fontSize:11, color: hasOver ? 'var(--danger)' : 'var(--text-3)', marginRight:'auto'}}>
                컨테이너 {containers.length}개 · 배정 <strong className="mono" style={{color: hasOver ? 'var(--danger)' : allocatedTotal === requiredTotal ? 'var(--ok)' : 'var(--text)'}}>{allocatedTotal}</strong> / {requiredTotal}개
                {hasOver && <span style={{marginLeft:8}}>· <I.AlertTriangle size={11} style={{verticalAlign:'middle', marginRight:3}}/>초과 {overItems.length}품목</span>}
              </span>
              <button className="btn ghost sm" onClick={onClose}>취소</button>
              <button
                className={'btn ' + (isShip ? 'ship' : 'milk')}
                disabled={hasOver}
                onClick={() => onCreateLot && onCreateLot(containers, allocations)}
              >
                <I.Check size={13}/> lot 만들기 ({items.length}건)
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function HistoryViewV4({ job, lots = { ship: [], milk: [] }, uploadHistory = { ship: [], milk: [] } }) {
  const { useState } = React;
  const [filter, setFilter] = useState('current');
  const items = filter === 'current' ? V4_HIST.filter(h => h.jobId === job.id) : V4_HIST;
  const shipUploads = uploadHistory.ship.length;
  const milkUploads = uploadHistory.milk.length;
  return (
    <div className="job-view">
      <div className="summary-row">
        <div className="stat"><div className="lbl">이 차수 파일</div><div className="val">{V4_HIST.filter(h => h.jobId === job.id).length}<span className="u">개</span></div></div>
        <div className="stat"><div className="lbl">박스 lot</div><div className="val" style={{color:'var(--ship)'}}>{lots.ship.length}<span className="u">개 · 업로드 {shipUploads}회</span></div></div>
        <div className="stat"><div className="lbl">팔레트 lot</div><div className="val" style={{color:'var(--milk)'}}>{lots.milk.length}<span className="u">개 · 업로드 {milkUploads}회</span></div></div>
        <div className="stat"><div className="lbl">전체 누적 파일</div><div className="val">{V4_HIST.length}<span className="u">개</span></div></div>
      </div>
      <div className="tool-row">
        <div className="search"><I.Search size={13} stroke="var(--text-3)"/><input placeholder="발주번호·파일명"/></div>
        <div style={{display:'flex', gap:4}}>
          <button className={'chip' + (filter === 'current' ? ' active' : '')} onClick={() => setFilter('current')}>이 차수만 <span className="n">{V4_HIST.filter(h => h.jobId === job.id).length}</span></button>
          <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>전체 <span className="n">{V4_HIST.length}</span></button>
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

function UploadModalV4({ stage, kind, batchCount, onClose, onBackground, vendor }) {
  const isLot = kind === 'ship' || kind === 'milk';
  const lotLabel = `lot ${batchCount || 1}개`;
  const steps = isLot ? [
    { k: 'login', label: '로그인', detail: `partition: ${vendor.id}` },
    { k: 'navigate', label: kind === 'ship' ? '쉽먼트 화면 진입' : '밀크런 화면 진입', detail: kind === 'ship' ? '/shipment/upload' : '/milkrun/batchRegister' },
    { k: 'upload', label: kind === 'ship' ? '박스 lot 일괄 업로드' : '팔레트 lot 일괄 업로드', detail: lotLabel },
    { k: 'verify', label: '결과 확인', detail: 'POST 200' },
    { k: 'route', label: '상태 갱신', detail: `${batchCount || 1}개 lot.uploaded = true` },
  ] : [
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
        {stage === 'countdown' ? <CountdownInnerV4 kind={kind} batchCount={batchCount}/> : (
          <>
            <div className="modal-head">
              <h3><I.Loader size={14} stroke="var(--accent)"/>{stage === 'done' ? '업로드 완료' : '쿠팡 자동화 진행 중'}</h3>
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
                  <I.CheckCircle size={14}/>{isLot ? `${kind === 'ship' ? '박스' : '팔레트'} ${lotLabel} 업로드 반영됨` : '4건 → 쉽먼트, 6건 → 밀크런 lot 배정으로 라우팅됨'}
                </div>
              )}
            </div>
            <div className="modal-foot">
              {stage === 'done' ? (
                <button className="btn primary" onClick={onClose}>확인</button>
              ) : (
                <>
                  <button className="btn ghost" onClick={onClose}>취소</button>
                  <button className="btn" onClick={onBackground} title="모달 숨기기 — 작업은 계속 진행">
                    <I.Min size={11}/> 백그라운드
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function CountdownInnerV4({ kind, batchCount }) {
  const { useState, useEffect } = React;
  const [n, setN] = useState(3);
  useEffect(() => { if (n <= 0) return; const t = setTimeout(() => setN(n - 1), 900); return () => clearTimeout(t); }, [n]);
  const r = 36, c = 2 * Math.PI * r, p = (3 - n) / 3;
  const title = kind === 'ship' ? `박스 lot ${batchCount || 1}개 일괄 업로드 직전` : kind === 'milk' ? `팔레트 lot ${batchCount || 1}개 일괄 업로드 직전` : '발주확정 업로드 직전';
  return (
    <>
      <div className="modal-head" style={{textAlign:'center', borderBottom:'none'}}>
        <h3 style={{justifyContent:'center'}}><I.AlertTriangle size={14} stroke="var(--warn)"/>{title}</h3>
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
          <strong style={{color:'var(--text)'}}>10 SKU</strong> · 4 ship + 6 milk · 반려 1건
        </div>
      </div>
    </>
  );
}

window.JobViewV4 = JobViewV4;
