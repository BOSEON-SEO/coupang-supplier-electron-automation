// Calendar root window
const { CAL_JOBS, VENDORS } = window.V3;

function Calendar({ vendor, setVendor, onOpenJob, onOpenPlugins }) {
  const [month, setMonth] = useState({ y: 2026, m: 5 });
  const today = '2026-05-06';

  const days = useMemo(() => {
    const first = new Date(month.y, month.m - 1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(month.y, month.m, 0).getDate();
    const cells = [];
    // prev month tail
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(month.y, month.m - 1, -i);
      cells.push({ date: fmt(d), other: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ date: `${month.y}-${String(month.m).padStart(2,'0')}-${String(i).padStart(2,'0')}`, other: false });
    }
    while (cells.length < 42) {
      const last = new Date(cells[cells.length-1].date);
      last.setDate(last.getDate() + 1);
      cells.push({ date: fmt(last), other: true });
    }
    return cells;
  }, [month]);

  const jobsByDate = useMemo(() => {
    const m = {};
    CAL_JOBS.filter(j => j.vendor === vendor.id).forEach(j => {
      if (!m[j.date]) m[j.date] = [];
      m[j.date].push(j);
    });
    return m;
  }, [vendor]);

  const monthJobs = CAL_JOBS.filter(j => j.vendor === vendor.id && j.date.startsWith(`${month.y}-${String(month.m).padStart(2,'0')}`));
  const totalSku = monthJobs.reduce((s,j) => s + j.skus, 0);
  const totalQty = monthJobs.reduce((s,j) => s + j.qty, 0);

  return (
    <div className="cal-shell" style={{flexDirection:'row'}}>
      <div className="cal-sidebar">
        <div className="cal-sb-section">벤더</div>
        {VENDORS.map(v => (
          <div key={v.id} className={'cal-sb-vendor' + (vendor.id === v.id ? ' active' : '')} onClick={() => setVendor(v)}>
            <div className="swatch" style={{background: v.color}}>{v.initial}</div>
            <div className="info">
              <div className="name">{v.name}</div>
              <div className="meta">partition_{v.id}</div>
            </div>
          </div>
        ))}
        <div className="cal-sb-section">{month.y}년 {month.m}월 · {vendor.name}</div>
        <div className="cal-sb-stat"><span className="lbl">차수</span><span className="val">{monthJobs.length}건</span></div>
        <div className="cal-sb-stat"><span className="lbl">총 SKU</span><span className="val">{totalSku}</span></div>
        <div className="cal-sb-stat"><span className="lbl">총 수량</span><span className="val">{totalQty.toLocaleString()}</span></div>
        <div style={{flex:1}}/>
        <div className="cal-sb-section">시스템</div>
        <button className="cal-sb-item" onClick={onOpenPlugins}>
          <I.Plug size={14}/><span className="label">플러그인</span>
          <span className="badge plugin" style={{fontSize:10}}>1 활성</span>
        </button>
        <button className="cal-sb-item">
          <I.Settings size={14}/><span className="label">설정</span>
        </button>
      </div>

      <div className="cal-shell">
        <div className="cal-header">
          <h1>달력</h1>
          <div className="month-nav">
            <button className="btn ghost sm" onClick={() => setMonth({...month, m: month.m === 1 ? 12 : month.m - 1, y: month.m === 1 ? month.y - 1 : month.y})}><I.ChevronL size={14}/></button>
            <span className="month mono">{month.y} · {String(month.m).padStart(2,'0')}월</span>
            <button className="btn ghost sm" onClick={() => setMonth({...month, m: month.m === 12 ? 1 : month.m + 1, y: month.m === 12 ? month.y + 1 : month.y})}><I.Chevron size={14}/></button>
            <button className="btn sm">오늘</button>
          </div>
          <div className="vendor-pick">
            <div className="swatch" style={{background: vendor.color}}>{vendor.initial}</div>
            <span style={{fontSize:12, fontWeight:600}}>{vendor.name}</span>
          </div>
          <div style={{flex:1}}/>
          <div style={{display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text-3)'}}>
            <span style={{display:'inline-flex', alignItems:'center', gap:4}}><span style={{width:10, height:10, background:'var(--accent-soft)', border:'1px solid var(--accent)', borderRadius:2}}/>오늘</span>
            <span style={{display:'inline-flex', alignItems:'center', gap:4}}><span style={{width:10, height:10, background:'var(--ok-soft)', borderLeft:'3px solid var(--ok)'}}/>완료</span>
            <span style={{display:'inline-flex', alignItems:'center', gap:4}}><span style={{width:10, height:10, background:'var(--accent-soft)', borderLeft:'3px solid var(--accent)'}}/>진행 중</span>
            <span style={{display:'inline-flex', alignItems:'center', gap:4}}><span style={{width:10, height:10, background:'var(--warn-soft)', borderLeft:'3px solid var(--warn)'}}/>초안</span>
          </div>
        </div>

        <div className="cal-grid">
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <div key={d} className={'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{d}</div>
          ))}
          {days.map((c, i) => {
            const day = +c.date.slice(-2);
            const dow = new Date(c.date).getDay();
            const jobs = jobsByDate[c.date] || [];
            const isToday = c.date === today;
            return (
              <div key={i} className={'cal-day' + (c.other ? ' other' : '') + (isToday ? ' today' : '')}>
                <div className={'date' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '')}>{day}</div>
                <div className="seq-list">
                  {jobs.map(j => (
                    <div key={j.id} className={'seq-card ' + j.state} onClick={(e) => { e.stopPropagation(); onOpenJob(j); }}>
                      <span className="label">{j.label}</span>
                      <span className="n">{j.skus}·{j.qty}</span>
                    </div>
                  ))}
                </div>
                {!c.other && (
                  <div className="new-seq" onClick={() => onOpenJob({ id: `j-new-${c.date}`, vendor: vendor.id, date: c.date, seq: (jobs.length + 1), state: 'draft', label: `${c.date.slice(5).replace('-','/')} ${jobs.length + 1}차`, skus: 0, qty: 0 })}>
                    <I.Plus size={10}/> 차수 추가
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

window.Calendar = Calendar;
