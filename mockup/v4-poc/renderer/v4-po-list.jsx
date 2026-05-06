// v4 PO List view — opened from Calendar. Sidebar lists 차수, main shows ALL POs.
// Selecting a 차수 dims non-member POs. Orphans (no 차수) are color-flagged.
const { ALL_POS, CAL_JOBS: V4PL_JOBS } = window.V3;

function PoListView({ vendor, date, onOpenJob, onBack, onCreateJob }) {
  const { useState, useMemo } = React;
  const dayJobs = useMemo(() => V4PL_JOBS.filter(j => j.vendor === vendor.id && j.date === date), [vendor, date]);
  const [selectedJobId, setSelectedJobId] = useState(dayJobs[0]?.id || 'all');
  const [search, setSearch] = useState('');
  const [refreshOpen, setRefreshOpen] = useState(false);
  // 미배정 PO 새 차수 만들 때 선택된 행 id 집합
  const [pickedOrphans, setPickedOrphans] = useState(new Set());
  const togglePicked = (id) => setPickedOrphans(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePickedAll = (orphans) => setPickedOrphans(s =>
    orphans.length === s.size ? new Set() : new Set(orphans.map(o => o.id))
  );

  // Filter scope: same vendor, but show all POs (even from other 차수) so we visualize membership
  const scopedPos = useMemo(() =>
    ALL_POS.filter(p => p.po && (search === '' || `${p.po} ${p.name} ${p.barcode}`.includes(search))),
    [search]
  );

  const orphanCount = scopedPos.filter(p => p.jobId === null).length;
  const isOrphanView = selectedJobId === 'orphan';
  const isAllView = selectedJobId === 'all';

  const totalForJob = (jobId) => scopedPos.filter(p => p.jobId === jobId).reduce((s, p) => s + p.reqQty, 0);
  const countForJob = (jobId) => scopedPos.filter(p => p.jobId === jobId).length;

  return (
    <div className="cal-shell" style={{flexDirection:'row'}}>
      {/* Sidebar — 차수 list */}
      <div className="cal-sidebar">
        <button className="sb-back" onClick={onBack} title="달력으로">
          <I.ChevronL size={13}/>
          <span>달력으로</span>
        </button>

        <div className="cal-sb-section">{date.slice(5).replace('-','/')} · {vendor.name}</div>
        <div className="cal-sb-stat"><span className="lbl">전체 PO</span><span className="val">{scopedPos.length}건</span></div>
        <div className="cal-sb-stat"><span className="lbl">차수</span><span className="val">{dayJobs.length}개</span></div>
        <div className="cal-sb-stat"><span className="lbl">미배정</span><span className="val" style={{color: orphanCount > 0 ? 'oklch(0.75 0.16 60)' : '#71717A'}}>{orphanCount}건</span></div>

        <div className="cal-sb-section">차수 선택</div>

        <div className={'cal-sb-vendor' + (isAllView ? ' active' : '')} onClick={() => setSelectedJobId('all')} style={{padding: '8px 10px'}}>
          <div style={{width:24, height:24, borderRadius:5, background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center'}}>
            <I.Layers size={12} stroke="#E4E4E7"/>
          </div>
          <div className="info">
            <div className="name" style={{fontSize:12}}>전체 PO</div>
            <div className="meta">{scopedPos.length}건</div>
          </div>
        </div>

        {dayJobs.map(j => (
          <div key={j.id} className={'cal-sb-vendor' + (selectedJobId === j.id ? ' active' : '')} onClick={() => setSelectedJobId(j.id)} style={{padding:'8px 10px'}}>
            <div style={{width:24, height:24, borderRadius:5, background: j.state === 'shipped' ? 'oklch(0.45 0.10 155)' : j.state === 'active' ? 'var(--accent)' : 'oklch(0.55 0.12 60)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:700, fontSize:11}}>
              {j.seq}
            </div>
            <div className="info">
              <div className="name" style={{fontSize:12}}>{j.label}</div>
              <div className="meta">{countForJob(j.id)}건 · {totalForJob(j.id)}개</div>
            </div>
            {j.state === 'shipped' && <I.Check size={11} stroke="#5EBC78"/>}
            {j.state === 'active' && <span style={{width:6, height:6, borderRadius:'50%', background:'var(--accent)', animation:'pulse 2s infinite'}}/>}
          </div>
        ))}

        {orphanCount > 0 && (
          <div className={'cal-sb-vendor' + (isOrphanView ? ' active' : '')} onClick={() => setSelectedJobId('orphan')} style={{padding: '8px 10px', boxShadow: !isOrphanView ? 'inset 0 0 0 1px oklch(0.55 0.16 60 / 0.5)' : undefined}}>
            <div style={{width:24, height:24, borderRadius:5, background:'oklch(0.55 0.16 60)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              <I.AlertTriangle size={12} stroke="white"/>
            </div>
            <div className="info">
              <div className="name" style={{fontSize:12}}>미배정 PO</div>
              <div className="meta">{orphanCount}건</div>
            </div>
          </div>
        )}

        <div style={{flex:1}}/>

        {/* Action depends on selection */}
        <div style={{padding: '0 8px 8px'}}>
          {!isAllView && !isOrphanView && (
            <button className="btn primary" style={{width:'100%', justifyContent:'center'}} onClick={() => onOpenJob(dayJobs.find(j => j.id === selectedJobId))}>
              <I.Maximize size={13}/> 작업 창 열기
            </button>
          )}
          {isOrphanView && (
            <button
              className="btn accent"
              style={{width:'100%', justifyContent:'center'}}
              disabled={pickedOrphans.size === 0}
              onClick={() => onCreateJob && onCreateJob([...pickedOrphans])}
              title={pickedOrphans.size === 0 ? '체크한 PO 없음' : `선택한 ${pickedOrphans.size}건으로 새 차수 만들기`}
            >
              <I.Plus size={13}/> 새 차수 만들기 ({pickedOrphans.size})
            </button>
          )}
          {isAllView && (
            <div style={{padding:'8px 10px', fontSize:10, color:'#71717A', textAlign:'center'}}>
              차수를 선택하거나<br/>미배정 PO로 새 차수 만들기
            </div>
          )}
        </div>
      </div>

      {/* Main — PO table */}
      <div className="cal-shell">
        <div className="cal-header">
          <h1 style={{display:'flex', alignItems:'center', gap:8}}>
            <I.Calendar size={16} stroke="var(--text-2)"/>
            {date} <span style={{color:'var(--text-3)', fontWeight:400, fontSize:13}}>· PO 리스트</span>
          </h1>
          {isOrphanView && (
            <div className="badge warn" style={{fontSize:11, padding:'4px 10px'}}>
              <I.AlertTriangle size={11}/> 어느 차수에도 없는 PO만 표시
            </div>
          )}
          <div style={{flex:1}}/>
          <div className="search">
            <I.Search size={13} stroke="var(--text-3)"/>
            <input placeholder="발주·SKU·이름" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <button className="btn" onClick={() => setRefreshOpen(true)}><I.RefreshCw size={13}/> PO 갱신</button>
        </div>

        {/* Legend */}
        <div style={{padding: '10px 22px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)', display:'flex', alignItems:'center', gap:14, fontSize:11, color:'var(--text-3)'}}>
          <span>범례:</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}><span style={{width:10, height:10, background:'var(--bg-elev)', borderLeft:'3px solid var(--accent)'}}/>선택한 차수</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}><span style={{width:10, height:10, background:'oklch(0.97 0.005 250)', borderLeft:'3px solid var(--text-3)'}}/>다른 차수 (흐림)</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5}}><span style={{width:10, height:10, background:'var(--warn-soft)', borderLeft:'3px solid var(--warn)'}}/>미배정 (신규)</span>
          <div style={{flex:1}}/>
          <span className="mono" style={{color:'var(--text-3)'}}>전체 {scopedPos.length}건 · 신규 {orphanCount}건 빨려옴</span>
        </div>

        <div className="grid-wrap" style={{flex:1}}>
          <table className="gtable">
            <thead>
              <tr>
                {isOrphanView && (
                  <th className="check-col">
                    <div
                      className={'cb ' + (pickedOrphans.size > 0 && pickedOrphans.size === scopedPos.filter(p => p.jobId === null).length ? 'on' : pickedOrphans.size > 0 ? 'partial' : '')}
                      onClick={() => togglePickedAll(scopedPos.filter(p => p.jobId === null))}
                      title="모두 선택/해제"
                    >
                      {pickedOrphans.size > 0 && pickedOrphans.size === scopedPos.filter(p => p.jobId === null).length
                        ? <I.Check size={11}/>
                        : pickedOrphans.size > 0 ? <I.Min size={11}/> : null}
                    </div>
                  </th>
                )}
                <th className="row-num">#</th>
                <th>차수</th>
                <th>발주번호</th>
                <th>물류센터</th>
                <th>바코드</th>
                <th>상품명</th>
                <th style={{textAlign:'right'}}>발주수량</th>
                <th>발주일시</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {scopedPos.map((p, i) => {
                const isMember = isAllView ? true : isOrphanView ? p.jobId === null : p.jobId === selectedJobId;
                const isOrphan = p.jobId === null;
                const job = V4PL_JOBS.find(j => j.id === p.jobId);
                const isPicked = pickedOrphans.has(p.id);

                let style = {};
                if (!isMember) {
                  style.opacity = 0.32;
                  style.background = 'oklch(0.98 0.005 250)';
                }
                if (isOrphan && (isAllView || isOrphanView)) {
                  style.background = 'var(--warn-soft)';
                  style.borderLeft = '3px solid var(--warn)';
                }
                if (isMember && !isAllView && !isOrphanView) {
                  style.borderLeft = '3px solid var(--accent)';
                }
                if (isOrphanView && isPicked) {
                  style.background = 'var(--accent-soft)';
                  style.borderLeft = '3px solid var(--accent)';
                }

                const onClickRow = isOrphanView && isOrphan ? () => togglePicked(p.id) : undefined;

                return (
                  <tr key={p.id} style={{...style, cursor: onClickRow ? 'pointer' : undefined}} onClick={onClickRow}>
                    {isOrphanView && (
                      <td className="check-col">
                        {isOrphan && (
                          <div className={'cb ' + (isPicked ? 'on' : '')}>
                            {isPicked && <I.Check size={11}/>}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="row-num">{i + 1}</td>
                    <td>
                      {p.jobId ? (
                        <span className="pill" style={{background: job?.state === 'shipped' ? 'var(--ok-soft)' : 'var(--accent-soft)', color: job?.state === 'shipped' ? 'var(--ok)' : 'var(--accent-strong)'}}>
                          {job?.label || p.jobId}
                        </span>
                      ) : (
                        <span className="pill" style={{background: 'var(--warn-soft)', color: 'var(--warn)'}}>미배정</span>
                      )}
                    </td>
                    <td className="mono" style={{fontSize:11}}>{p.po}</td>
                    <td>{p.wh}</td>
                    <td className="mono" style={{fontSize:11}}>{p.barcode}</td>
                    <td>{p.name}</td>
                    <td className="num">{p.reqQty}</td>
                    <td className="mono" style={{fontSize:10, color:'var(--text-3)'}}>{p.orderTime}</td>
                    <td>
                      {p.isNew && <span className="pill" style={{background:'oklch(0.95 0.05 60)', color:'var(--warn)'}}>NEW</span>}
                      {!p.isNew && job?.state === 'shipped' && <span className="pill send">완료</span>}
                      {!p.isNew && job?.state === 'active' && <span className="pill" style={{background:'var(--accent-soft)', color:'var(--accent-strong)'}}>진행 중</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {refreshOpen && <PoUpdateModalV4 onClose={() => setRefreshOpen(false)}/>}
    </div>
  );
}

function PoUpdateModalV4({ onClose }) {
  const { useState } = React;
  const [source, setSource] = useState('coupang');
  const [from, setFrom] = useState('2026-05-04T09:00');
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h3><I.RefreshCw size={14}/>PO 갱신</h3>
          <div className="sub">쿠팡에서 새 발주서를 가져옵니다. 신규 PO는 "미배정" 상태로 들어옵니다.</div>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>소스</label>
            <div className="radio-group">
              <div className={'radio' + (source === 'coupang' ? ' on' : '')} onClick={() => setSource('coupang')}>
                <div className="dot"/><div className="label">쿠팡 사이트에서 받기 <div className="desc">웹뷰 자동화</div></div>
              </div>
              <div className={'radio' + (source === 'excel' ? ' on' : '')} onClick={() => setSource('excel')}>
                <div className="dot"/><div className="label">Excel 업로드</div>
              </div>
            </div>
          </div>
          {source === 'coupang' && (
            <div className="field">
              <label>발주일시 ≥</label>
              <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}/>
            </div>
          )}
          <div style={{padding:10, background:'var(--accent-soft)', borderRadius:5, fontSize:12, color:'var(--accent-strong)', display:'flex', gap:8}}>
            <I.Info size={13}/>
            <span>예상 — 신규 <strong>5건</strong>, 중복 제외 <strong>3건</strong></span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={onClose}><I.RefreshCw size={13}/> 받기</button>
        </div>
      </div>
    </div>
  );
}

window.PoListView = PoListView;
