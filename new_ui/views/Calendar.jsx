// Calendar view
const { useState, useMemo } = React;

function Calendar({ onOpenJob, monthOffset, setMonthOffset }) {
  const { VENDORS, MONTH, TODAY, JOBS, PHASES } = window.MOCK;
  const baseYear = MONTH.y;
  const baseMonth = MONTH.m + monthOffset;
  const date = new Date(baseYear, baseMonth, 1);
  const y = date.getFullYear();
  const m = date.getMonth();
  const monthName = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  const firstDow = new Date(y, m, 1).getDay();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const prevLastDay = new Date(y, m, 0).getDate();

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ day: prevLastDay - i, dim: true });
  for (let d = 1; d <= lastDay; d++) cells.push({ day: d, dim: false, key: `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` });
  while (cells.length % 7) cells.push({ day: cells.length - lastDay - firstDow + 1, dim: true });

  const venMap = Object.fromEntries(VENDORS.map(v => [v.id, v]));

  // metrics
  const monthJobs = Object.entries(JOBS).filter(([k]) => k.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)).flatMap(([k, arr]) => arr.map(j => ({ ...j, date: k })));
  const totalJobs = monthJobs.length;
  const doneJobs = monthJobs.filter(j => j.phase === 4).length;
  const activeJobs = monthJobs.filter(j => j.phase > 0 && j.phase < 4).length;

  return (
    <div className="cal-wrap">
      <div className="cal-head">
        <h2>{monthName}</h2>
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonthOffset(monthOffset - 1)}><I.ChevronL size={16}/></button>
          <button className="btn sm ghost" onClick={() => setMonthOffset(0)}>오늘</button>
          <button className="icon-btn" onClick={() => setMonthOffset(monthOffset + 1)}><I.Chevron size={16}/></button>
        </div>
        <div style={{flex:1}}/>
        <div className="sync-pill"><span className="pulse"/>외부 일정 sync · 2분 전</div>
        <button className="btn sm"><I.Filter size={14}/> 필터</button>
        <button className="btn primary sm"><I.Plus size={14}/> 차수 생성</button>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:16}}>
        <div className="stat-card">
          <div className="lbl">이번 달 총 차수</div>
          <div className="val">{totalJobs}<span className="unit">건</span></div>
          <div className="delta"><span style={{color:'var(--text-3)'}}>지난달 대비</span><span style={{color:'var(--ok)', fontWeight:600}}>+8</span></div>
        </div>
        <div className="stat-card">
          <div className="lbl">완료</div>
          <div className="val" style={{color:'var(--ok)'}}>{doneJobs}<span className="unit">건</span></div>
          <div className="delta">
            <div className="bar"><div className="fill" style={{width: `${(doneJobs/totalJobs*100).toFixed(0)}%`, background:'var(--ok)'}}/></div>
            <span className="mono" style={{color:'var(--text-3)'}}>{(doneJobs/totalJobs*100).toFixed(0)}%</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">진행중</div>
          <div className="val" style={{color:'var(--accent-strong)'}}>{activeJobs}<span className="unit">건</span></div>
          <div className="delta"><span style={{color:'var(--text-3)'}}>오늘 처리 예정</span><span className="mono" style={{fontWeight:600}}>4</span></div>
        </div>
        <div className="stat-card">
          <div className="lbl">평균 처리 시간</div>
          <div className="val">14<span className="unit">분</span></div>
          <div className="delta"><span style={{color:'var(--text-3)'}}>차수 1건당</span><span style={{color:'var(--ok)', fontWeight:600}}>−3분</span></div>
        </div>
      </div>

      <div className="cal-grid">
        {['일','월','화','수','목','금','토'].map((d, i) => (
          <div key={d} className="cal-dow" style={{color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--accent)' : 'var(--text-3)'}}>{d}요일</div>
        ))}
        {cells.map((c, i) => {
          const dow = i % 7;
          const jobs = !c.dim && c.key ? (JOBS[c.key] || []) : [];
          const isToday = !c.dim && c.day === TODAY && monthOffset === 0;
          return (
            <div key={i} className={'cal-cell' + (c.dim ? ' dim' : '') + (isToday ? ' today' : '') + ((dow === 0 || dow === 6) && !c.dim ? ' weekend' : '')}>
              <div className="day-num">{c.day}</div>
              {jobs.slice(0, 4).map((j, ji) => {
                const v = venMap[j.vendor];
                const phaseName = j.phase >= 4 ? '완료' : PHASES[j.phase - 1]?.label || '대기';
                const klass = j.phase >= 4 ? 'done' : (j.phase === 1 ? 'warn' : '');
                return (
                  <div key={ji} className={'cal-card ' + klass}
                       style={!klass ? { borderLeftColor: v.color, background: `oklch(from ${v.color} 0.96 0.04 h)`, color: `oklch(from ${v.color} 0.42 0.16 h)` } : {}}
                       onClick={() => onOpenJob({ vendor: j.vendor, date: c.key, sequence: j.seq, phase: j.phase })}>
                    <span className="v-name">{v.name}</span>
                    <span className="seq">{j.seq}차</span>
                    <span className="progress-dots">
                      {[0,1,2,3].map(k => <span key={k} className={k < j.phase ? 'on' : ''}/>)}
                    </span>
                  </div>
                );
              })}
              {jobs.length > 4 && (
                <div style={{fontSize:10, color:'var(--text-3)', padding:'2px 6px'}}>+{jobs.length - 4}건</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.Calendar = Calendar;
