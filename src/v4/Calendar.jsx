// v4 Calendar — clicking any day opens PO List view (not job directly)
import React, { useState, useMemo, useEffect } from 'react';
import { I } from './icons';
import { VENDORS as V4_VENDORS } from './data';

// 실 manifest → mockup 셸이 기대하는 모양 변환
//   manifest: { vendor, date, sequence, completed, ... }
//   mockup:   { id, vendor, date, seq, state, label, skus, qty }
function adaptJob(m, todayStr) {
  const seq = m.sequence ?? m.seq;
  const state = m.completed ? 'shipped' : (m.date === todayStr ? 'active' : 'draft');
  const monthDay = m.date.slice(5).replace('-', '/');
  return {
    id: `${m.vendor}-${m.date}-${seq}`,
    vendor: m.vendor,
    date: m.date,
    seq,
    state,
    label: `${monthDay} ${seq}차`,
    skus: m.stats?.skuCount || 0,
    qty: m.stats?.totalQty || 0,
    completed: !!m.completed,
    raw: m,
  };
}

export default function CalendarV4({ vendor, setVendor, vendors = V4_VENDORS, onOpenDate, onOpenPlugins, onOpenSettings, activePluginCount = 0, installedPluginCount = 0 }) {
  const _now = new Date();
  const [month, setMonth] = useState({ y: _now.getFullYear(), m: _now.getMonth() + 1 });
  const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
  const goToday = () => { const n = new Date(); setMonth({ y: n.getFullYear(), m: n.getMonth() + 1 }); };
  const [pickerOpen, setPickerOpen] = useState(false);

  // 실 jobs 데이터 — manifest 들을 listMonthFull 로 한 번에 fetch
  const [monthManifests, setMonthManifests] = useState([]);
  useEffect(() => {
    if (!vendor?.id) { setMonthManifests([]); return; }
    let cancelled = false;
    Promise.resolve(window.electronAPI?.jobs?.listMonthFull?.(month.y, month.m, vendor.id))
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.jobs) ? res.jobs : [];
        setMonthManifests(list);
      })
      .catch(() => { if (!cancelled) setMonthManifests([]); });
    return () => { cancelled = true; };
  }, [month.y, month.m, vendor?.id]);
  const yearList = (() => {
    const y = _now.getFullYear();
    const arr = [];
    for (let i = y - 2; i <= y + 1; i++) arr.push(i);
    return arr;
  })();

  const days = useMemo(() => {
    const first = new Date(month.y, month.m - 1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(month.y, month.m, 0).getDate();
    const cells = [];
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(month.y, month.m - 1, -i);
      cells.push({ date: fmtV4(d), other: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ date: `${month.y}-${String(month.m).padStart(2,'0')}-${String(i).padStart(2,'0')}`, other: false });
    }
    while (cells.length < 42) {
      const last = new Date(cells[cells.length-1].date);
      last.setDate(last.getDate() + 1);
      cells.push({ date: fmtV4(last), other: true });
    }
    return cells;
  }, [month]);

  const adaptedJobs = useMemo(
    () => monthManifests.map((m) => adaptJob(m, today)),
    [monthManifests, today]
  );

  const jobsByDate = useMemo(() => {
    const m = {};
    adaptedJobs.forEach(j => {
      if (!m[j.date]) m[j.date] = [];
      m[j.date].push(j);
    });
    return m;
  }, [adaptedJobs]);

  const monthJobs = adaptedJobs;
  const totalSku = monthJobs.reduce((s,j) => s + (j.skus || 0), 0);
  const totalQty = monthJobs.reduce((s,j) => s + (j.qty || 0), 0);

  return (
    <div className="cal-shell" style={{flexDirection:'row'}}>
      <div className="cal-sidebar">
        <div className="cal-sb-section">벤더</div>
        {vendors.map(v => (
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
          {installedPluginCount > 0 && (
            <span
              className={'badge ' + (activePluginCount > 0 ? 'plugin' : '')}
              style={{fontSize:10, opacity: activePluginCount > 0 ? 1 : 0.5}}
            >
              {activePluginCount > 0 ? `${activePluginCount} 활성` : '비활성'}
            </span>
          )}
        </button>
        <button className="cal-sb-item" onClick={onOpenSettings}>
          <I.Settings size={14}/><span className="label">설정</span>
        </button>
      </div>

      <div className="cal-shell">
        <div className="cal-header">
          <h1>달력</h1>
          <div className="month-nav" style={{position:'relative'}}>
            <button className="btn ghost sm" onClick={() => setMonth({...month, m: month.m === 1 ? 12 : month.m - 1, y: month.m === 1 ? month.y - 1 : month.y})}><I.ChevronL size={14}/></button>
            <button
              className="month mono"
              onClick={() => setPickerOpen(o => !o)}
              style={{
                background: pickerOpen ? 'var(--accent-soft)' : 'transparent',
                border: '1px solid ' + (pickerOpen ? 'var(--accent)' : 'transparent'),
                borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontWeight: 600,
              }}
              title="연/월 선택"
            >
              {month.y} · {String(month.m).padStart(2,'0')}월
            </button>
            <button className="btn ghost sm" onClick={() => setMonth({...month, m: month.m === 12 ? 1 : month.m + 1, y: month.m === 12 ? month.y + 1 : month.y})}><I.Chevron size={14}/></button>
            <button className="btn sm" onClick={goToday}>오늘</button>
            {pickerOpen && (
              <>
                <div style={{position:'fixed', inset:0, zIndex:30}} onClick={() => setPickerOpen(false)}/>
                <div style={{
                  position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:31,
                  background:'var(--bg-elev)', border:'1px solid var(--border)', borderRadius:6,
                  boxShadow:'0 12px 32px rgba(0,0,0,0.12)', padding:10, minWidth:240,
                  display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 12px',
                }}>
                  <div style={{fontSize:10, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600}}>연</div>
                  <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                    {yearList.map(y => (
                      <button
                        key={y}
                        className={'btn ghost sm' + (y === month.y ? ' accent' : '')}
                        style={{padding:'2px 8px', height:24, fontSize:11}}
                        onClick={() => { setMonth({...month, y}); }}
                      >{y}</button>
                    ))}
                  </div>
                  <div style={{fontSize:10, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:0.6, fontWeight:600}}>월</div>
                  <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:4}}>
                    {Array.from({length:12}).map((_, i) => {
                      const m = i + 1;
                      return (
                        <button
                          key={m}
                          className={'btn ghost sm' + (m === month.m ? ' accent' : '')}
                          style={{padding:'2px 6px', height:24, fontSize:11}}
                          onClick={() => { setMonth({...month, m}); setPickerOpen(false); }}
                        >{m}</button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
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
              <div key={i} className={'cal-day' + (c.other ? ' other' : '') + (isToday ? ' today' : '')}
                   onClick={() => !c.other && onOpenDate(c.date)}>
                <div className={'date' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '')}>{day}</div>
                <div className="seq-list">
                  {jobs.slice(0, 2).map(j => (
                    <div key={j.id} className={'seq-card ' + j.state}>
                      <span className="label">{j.label}</span>
                      <span className="n">{j.skus}·{j.qty}</span>
                    </div>
                  ))}
                  {jobs.length > 2 && (
                    <div className="seq-more">외 {jobs.length - 2}건</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtV4(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

