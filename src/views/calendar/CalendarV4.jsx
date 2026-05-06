import React, { useEffect, useMemo, useState } from 'react';
import { I } from '../../icons/v4-icons';

/**
 * v4 Calendar — 사이드바(벤더 + 월 통계) + 7×6 그리드.
 *   - jobs.listMonth IPC 로 manifest 인덱스 fetch
 *   - 날짜 클릭 → onOpenDate(date)  → PoListView 진입
 *   - 차수(seq-card) 클릭 → onOpenJob(job) (선택)
 *
 * Props:
 *   vendors          [{id, name, initial?, color?}]
 *   activeVendor     string (id)
 *   onVendorChange   (id) => void
 *   onOpenDate       (date) => void
 *   onOpenJob        (job) => void   (optional — 클릭 시 직접 작업 진입)
 *   onOpenPlugins    () => void
 */
export default function CalendarV4({
  vendors = [],
  activeVendor,
  onVendorChange,
  onOpenDate,
  onOpenJob,
  onOpenPlugins,
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1 };
  });
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);

  const today = useMemo(() => fmt(new Date()), []);

  useEffect(() => {
    if (!activeVendor) { setJobs([]); return; }
    let cancelled = false;
    setLoading(true);
    Promise.resolve(window.electronAPI?.jobs?.listMonth?.(month.y, month.m, activeVendor))
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.jobs) ? res.jobs
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res) ? res : [];
        setJobs(list);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month.y, month.m, activeVendor]);

  const days = useMemo(() => buildMonthCells(month), [month]);

  const jobsByDate = useMemo(() => {
    const m = {};
    jobs.forEach((j) => {
      if (!m[j.date]) m[j.date] = [];
      m[j.date].push(j);
    });
    return m;
  }, [jobs]);

  const totalSku = jobs.reduce((s, j) => s + (j.skuCount || j.totalSkus || j.skus || 0), 0);
  const totalQty = jobs.reduce((s, j) => s + (j.totalQty || j.qty || 0), 0);

  const vendor = vendors.find((v) => v.id === activeVendor) || vendors[0] || { id: '', name: '벤더 없음', initial: '?' };
  const nextMonth = () => setMonth((m) => m.m === 12 ? { y: m.y + 1, m: 1 } : { ...m, m: m.m + 1 });
  const prevMonth = () => setMonth((m) => m.m === 1 ? { y: m.y - 1, m: 12 } : { ...m, m: m.m - 1 });
  const goToday = () => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() + 1 }); };

  return (
    <div className="cal-shell" style={{ flexDirection: 'row' }}>
      <aside className="cal-sidebar">
        <div className="cal-sb-section">벤더</div>
        {vendors.length === 0 && (
          <div style={{ fontSize: 11, color: '#71717A', padding: '8px 10px' }}>등록된 벤더 없음</div>
        )}
        {vendors.map((v) => (
          <div
            key={v.id}
            className={'cal-sb-vendor' + (activeVendor === v.id ? ' active' : '')}
            onClick={() => onVendorChange?.(v.id)}
          >
            <div className="swatch" style={{ background: v.color || 'oklch(0.55 0.14 250)' }}>
              {v.initial || (v.name || v.id || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="info">
              <div className="name">{v.name || v.id}</div>
              <div className="meta">partition_{v.id}</div>
            </div>
          </div>
        ))}

        <div className="cal-sb-section">{month.y}년 {month.m}월 · {vendor.name}</div>
        <div className="cal-sb-stat"><span className="lbl">차수</span><span className="val">{jobs.length}건</span></div>
        <div className="cal-sb-stat"><span className="lbl">총 SKU</span><span className="val">{totalSku}</span></div>
        <div className="cal-sb-stat"><span className="lbl">총 수량</span><span className="val">{totalQty.toLocaleString()}</span></div>

        <div style={{ flex: 1 }} />

        <div className="cal-sb-section">시스템</div>
        <button className="cal-sb-item" onClick={onOpenPlugins}>
          <I.Plug size={14} /><span className="label">플러그인</span>
        </button>
      </aside>

      <div className="cal-shell">
        <div className="cal-header">
          <h1>달력</h1>
          <div className="month-nav">
            <button className="btn ghost sm" onClick={prevMonth}><I.ChevronL size={14} /></button>
            <span className="month">{month.y} · {String(month.m).padStart(2, '0')}월</span>
            <button className="btn ghost sm" onClick={nextMonth}><I.Chevron size={14} /></button>
            <button className="btn sm" onClick={goToday}>오늘</button>
          </div>
          <div className="vendor-pick">
            <div className="swatch" style={{ background: vendor.color || 'oklch(0.55 0.14 250)' }}>
              {vendor.initial || (vendor.name || vendor.id || '?').slice(0, 1).toUpperCase()}
            </div>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{vendor.name || vendor.id}</span>
          </div>
          <div style={{ flex: 1 }} />
          {loading && <span className="badge">불러오는 중…</span>}
        </div>

        <div className="cal-grid">
          {['일','월','화','수','목','금','토'].map((d, i) => (
            <div key={d} className={'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{d}</div>
          ))}
          {days.map((c, i) => {
            const day = +c.date.slice(-2);
            const dow = new Date(c.date).getDay();
            const dayJobs = jobsByDate[c.date] || [];
            const isToday = c.date === today;
            return (
              <div
                key={i}
                className={'cal-day' + (c.other ? ' other' : '') + (isToday ? ' today' : '')}
                onClick={() => !c.other && onOpenDate?.(c.date)}
              >
                <div className={'date' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '')}>{day}</div>
                <div className="seq-list">
                  {dayJobs.map((j) => {
                    const seqNum = j.sequence ?? j.seq ?? '?';
                    const state = j.completed ? 'shipped' : (c.date === today ? 'active' : 'draft');
                    return (
                      <div
                        key={`${j.date}-${seqNum}`}
                        className={'seq-card ' + state}
                        onClick={(ev) => {
                          if (!onOpenJob) return;
                          ev.stopPropagation();
                          onOpenJob(j);
                        }}
                      >
                        <span className="label">{seqNum}차</span>
                        {j.totalQty != null && <span className="n">{j.totalQty}</span>}
                      </div>
                    );
                  })}
                </div>
                {!c.other && dayJobs.length === 0 && (
                  <div className="new-seq"><I.ArrowRight size={10} /> PO 보기</div>
                )}
                {!c.other && dayJobs.length > 0 && (
                  <div className="new-seq" style={{ borderStyle: 'solid', color: 'var(--accent)', borderColor: 'var(--accent)', opacity: 0.6 }}>
                    <I.ArrowRight size={10} /> 열기
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMonthCells(month) {
  const first = new Date(month.y, month.m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(month.y, month.m, 0).getDate();
  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(month.y, month.m - 1, -i);
    cells.push({ date: fmt(d), other: true });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({
      date: `${month.y}-${String(month.m).padStart(2, '0')}-${String(i).padStart(2, '0')}`,
      other: false,
    });
  }
  while (cells.length < 42) {
    const last = new Date(cells[cells.length - 1].date);
    last.setDate(last.getDate() + 1);
    cells.push({ date: fmt(last), other: true });
  }
  return cells;
}
