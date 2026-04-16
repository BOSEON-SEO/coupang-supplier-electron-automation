import React, { useEffect, useMemo, useState, useCallback } from 'react';
import JobCard from './JobCard';

/**
 * 달력 메뉴 — 월 네비 + 작업 있는 날짜 점 표시 + 선택 시 그날의 작업 카드 리스트.
 *
 * + 새 작업 버튼은 현재 활성 벤더(헤더) + 선택된 날짜로 즉시 생성한다.
 * 벤더 미선택 / 차수 가드 실패 / PO 다운 실패는 alert 로 폴백.
 *
 * Props:
 *   - onOpenJob: (job) => void
 *   - vendors: array
 *   - activeVendor: string (헤더에서 선택된 벤더 id)
 */

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function todayStr() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export default function CalendarView({ onOpenJob, vendors, activeVendor }) {
  const today = todayStr();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [byDate, setByDate] = useState({});
  const [jobsForDay, setJobsForDay] = useState([]);
  const [creating, setCreating] = useState(false);

  const loadMonth = useCallback(async () => {
    const api = window.electronAPI?.jobs;
    if (!api) return;
    const res = await api.listMonth(year, month);
    if (res?.success) setByDate(res.byDate || {});
  }, [year, month]);

  const loadDay = useCallback(async () => {
    const api = window.electronAPI?.jobs;
    if (!api || !selectedDate) return;
    const res = await api.list(selectedDate);
    if (res?.success) setJobsForDay(res.jobs || []);
  }, [selectedDate]);

  useEffect(() => { loadMonth(); }, [loadMonth]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const startWeekday = first.getDay();
    const totalDays = last.getDate();
    const arr = [];
    for (let i = 0; i < startWeekday; i += 1) arr.push(null);
    for (let d = 1; d <= totalDays; d += 1) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  const goPrevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const goNextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };
  const goToday = () => {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDate(todayStr());
  };

  const handleNewJob = async () => {
    if (!activeVendor) {
      alert('먼저 헤더에서 벤더를 선택하세요.');
      return;
    }
    if (!selectedDate) {
      alert('먼저 날짜를 선택하세요.');
      return;
    }
    setCreating(true);
    const api = window.electronAPI;
    const res = await api.jobs.create(selectedDate, activeVendor);
    if (!res?.success) {
      alert(res?.error || '작업 생성 실패');
      setCreating(false);
      return;
    }
    const job = res.manifest;

    // PO 자동 다운로드 트리거 (실패해도 작업은 생성된 상태)
    const dl = await api.runPython('scripts/po_download.py', [
      '--vendor', activeVendor,
      '--date-from', selectedDate,
      '--date-to', selectedDate,
      '--sequence', String(job.sequence),
    ]);
    if (!dl?.success && !dl?.error?.includes('already running')) {
      alert(`PO 다운로드 시작 실패: ${dl?.error || 'unknown'}\n작업은 생성되었습니다.`);
    }

    await loadMonth();
    await loadDay();
    setCreating(false);
    onOpenJob(job, { isNew: true });
  };

  // 해당 날짜의 activeVendor 마지막 차수가 미완료면 새 작업 생성 불가 (ipc 가드와 동일 규칙)
  const lastSeqJob = activeVendor
    ? jobsForDay
        .filter((j) => j.vendor === activeVendor)
        .reduce((a, b) => (a && a.sequence > b.sequence ? a : b), null)
    : null;
  const blockedBySequence = !!lastSeqJob && !lastSeqJob.completed;

  const newJobDisabled =
    creating || !vendors?.length || !activeVendor || blockedBySequence;
  const newJobTitle = !vendors?.length
    ? '먼저 벤더를 추가하세요'
    : !activeVendor
    ? '헤더에서 벤더를 선택하세요'
    : blockedBySequence
    ? `이전 차수(${lastSeqJob.sequence}차)가 완료되지 않았습니다. 먼저 완료 처리하세요.`
    : `${selectedDate} · ${activeVendor} 새 작업 생성`;

  return (
    <div className="calendar-view">
      <div className="calendar-view__header">
        <div className="calendar-view__nav">
          <button type="button" className="btn btn--secondary" onClick={goPrevMonth} aria-label="이전 달">◀</button>
          <h2 className="calendar-view__title">{year}년 {month}월</h2>
          <button type="button" className="btn btn--secondary" onClick={goNextMonth} aria-label="다음 달">▶</button>
          <button type="button" className="btn btn--secondary" onClick={goToday}>오늘</button>
        </div>
      </div>

      <div className="calendar-view__body">
        <div className="calendar-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
            <div key={w} className="calendar-grid__weekday">{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={`e-${i}`} className="calendar-grid__cell calendar-grid__cell--empty" />;
            const date = ymd(year, month, d);
            const info = byDate[date];
            const isToday = date === today;
            const isSelected = date === selectedDate;
            return (
              <button
                key={date}
                type="button"
                className={
                  'calendar-grid__cell' +
                  (isToday ? ' is-today' : '') +
                  (isSelected ? ' is-selected' : '') +
                  (info ? ' has-jobs' : '')
                }
                onClick={() => setSelectedDate(date)}
              >
                <span className="calendar-grid__day">{d}</span>
                {info && (
                  <span
                    className={`calendar-grid__badge${info.hasIncomplete ? ' is-incomplete' : ''}`}
                    title={`${info.count}건${info.hasIncomplete ? ' (미완료 포함)' : ''}`}
                  >
                    {info.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <aside className="calendar-view__day-panel">
          <div className="calendar-view__day-header">
            <h3>{selectedDate}</h3>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleNewJob}
              disabled={newJobDisabled}
              title={newJobTitle}
            >
              {creating ? '생성 중...' : '+ 새 작업'}
            </button>
          </div>
          {jobsForDay.length === 0 ? (
            <p className="calendar-view__empty">등록된 작업이 없습니다.</p>
          ) : (
            <div className="calendar-view__cards">
              {jobsForDay.map((job) => (
                <JobCard
                  key={`${job.vendor}-${job.sequence}`}
                  job={job}
                  vendorName={vendors?.find((v) => v.id === job.vendor)?.name}
                  onClick={() => onOpenJob(job)}
                  onDelete={async (j) => {
                    const res = await window.electronAPI.jobs.delete(j.date, j.vendor, j.sequence);
                    if (!res?.success) {
                      alert(`삭제 실패: ${res?.error || 'unknown'}`);
                      return;
                    }
                    await loadMonth();
                    await loadDay();
                  }}
                />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
