import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import JobCard from './JobCard';
import NewJobModal from './NewJobModal';
import { useRunHook } from '../core/plugin-host';
import { KNOWN_HOOKS } from '../core/plugin-api';

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
  const runHook = useRunHook();
  const today = todayStr();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [byDate, setByDate] = useState({});
  const [jobsForDay, setJobsForDay] = useState([]);
  const [creating, setCreating] = useState(false);
  const [ymPickerOpen, setYmPickerOpen] = useState(false);
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const ymPickerRef = useRef(null);

  const loadMonth = useCallback(async () => {
    const api = window.electronAPI?.jobs;
    if (!api) return;
    const res = await api.listMonth(year, month, activeVendor || undefined);
    if (res?.success) setByDate(res.byDate || {});
  }, [year, month, activeVendor]);

  const loadDay = useCallback(async () => {
    const api = window.electronAPI?.jobs;
    if (!api || !selectedDate) return;
    const res = await api.list(selectedDate, activeVendor || undefined);
    if (res?.success) setJobsForDay(res.jobs || []);
  }, [selectedDate, activeVendor]);

  useEffect(() => { loadMonth(); }, [loadMonth]);
  useEffect(() => { loadDay(); }, [loadDay]);

  // 연·월 피커 바깥 클릭으로 닫기
  useEffect(() => {
    if (!ymPickerOpen) return undefined;
    const onDoc = (e) => {
      if (ymPickerRef.current && !ymPickerRef.current.contains(e.target)) {
        setYmPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [ymPickerOpen]);

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

  // 새 작업 버튼 — 모달 오픈
  const handleOpenNewJobModal = () => {
    if (!activeVendor) { alert('먼저 헤더에서 벤더를 선택하세요.'); return; }
    if (!selectedDate) { alert('먼저 날짜를 선택하세요.'); return; }
    setShowNewJobModal(true);
  };

  // 공통 — 새 job manifest 생성 (sequence 명시 가능)
  const createJobManifest = useCallback(async (sequence) => {
    const api = window.electronAPI;
    const vendorMeta = vendors?.find((v) => v.id === activeVendor);
    const res = await api.jobs.create(selectedDate, activeVendor, {
      plugin: vendorMeta?.plugin ?? null,
      sequence,
    });
    if (!res?.success) {
      alert(res?.error || '작업 생성 실패');
      return null;
    }
    // 플러그인에게 작업 생성 사실 브로드캐스트 (실패해도 작업 생성 자체는 계속)
    try { await runHook(KNOWN_HOOKS.JOB_CREATED, { job: res.manifest }); }
    catch (err) { console.warn('[job.created hook]', err); }
    return res.manifest;
  }, [vendors, activeVendor, selectedDate, runHook]);

  // 쿠팡 자동 다운로드 모드
  const handleCoupangMode = useCallback(async (sequence, options) => {
    setCreating(true);
    try {
      const job = await createJobManifest(sequence);
      if (!job) return;

      // PO 다운 전 — 플러그인에게 사전 작업 기회 부여 (예: tbnws 풀필 재고 동기화).
      // 실패하면 작업은 이미 생성됐으므로 파일만 없이 열림. 사용자가 수동으로 다시 시도 가능.
      try {
        await runHook(KNOWN_HOOKS.JOB_PRE_CREATE, {
          date: job.date, vendor: job.vendor, sequence: job.sequence,
          plugin: job.plugin, options: options || {},
        });
      } catch (err) {
        alert(`사전 작업 실패: ${err?.message || err}\n수동으로 해당 작업을 재시도하세요.`);
        // 계속 진행 — PO 다운 자체는 시도
      }

      const api = window.electronAPI;
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
      setShowNewJobModal(false);
      onOpenJob(job, { isNew: true });
    } finally {
      setCreating(false);
    }
  }, [createJobManifest, activeVendor, selectedDate, loadMonth, loadDay, onOpenJob, runHook]);

  // 파일 업로드 모드 — 사용자가 선택한 xlsx 를 job/po.xlsx 로 저장
  const handleFileMode = useCallback(async (fileBuffer, fileName, sequence, options) => {
    setCreating(true);
    try {
      const job = await createJobManifest(sequence);
      if (!job) return;

      // PO 파일 저장 전 — 플러그인 사전 작업 (tbnws 풀필 재고 동기화 등).
      try {
        await runHook(KNOWN_HOOKS.JOB_PRE_CREATE, {
          date: job.date, vendor: job.vendor, sequence: job.sequence,
          plugin: job.plugin, options: options || {},
        });
      } catch (err) {
        alert(`사전 작업 실패: ${err?.message || err}`);
        // 계속 진행 — 파일 저장은 시도
      }

      const api = window.electronAPI;
      const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'po.xlsx');
      if (!resolved?.success) {
        alert(`경로 해석 실패: ${resolved?.error}`);
        return;
      }
      const w = await api.writeFile(resolved.path, fileBuffer);
      if (!w?.success) {
        alert(`PO 파일 저장 실패: ${w?.error ?? 'unknown'}`);
        return;
      }
      // phase 를 po_downloaded 로 명시 세팅 (jobs:create 는 기본값으로 두지만 보증용)
      await api.jobs.updateManifest(job.date, job.vendor, job.sequence, {
        phase: 'po_downloaded',
        source: 'file-upload',
        sourceFileName: fileName,
      });
      const refreshed = await api.jobs.loadManifest(job.date, job.vendor, job.sequence);
      const finalJob = refreshed?.success ? refreshed.manifest : job;

      // 플러그인 po.postprocess 훅 — 파일 업로드 방식은 buffer 이미 확보됨.
      // Python 다운로드 모드는 완료 후 별도로 처리 예정 (URL 확정 후).
      try {
        await runHook(KNOWN_HOOKS.PO_POSTPROCESS, {
          buffer: fileBuffer,
          fileName,
          job: finalJob,
        });
      } catch (err) { console.warn('[po.postprocess hook]', err); }

      await loadMonth();
      await loadDay();
      setShowNewJobModal(false);
      onOpenJob(finalJob, { isNew: true });
    } finally {
      setCreating(false);
    }
  }, [createJobManifest, loadMonth, loadDay, onOpenJob, runHook]);

  // 해당 날짜·activeVendor 의 기존 차수 목록 (중복 방지용)
  const usedSequences = activeVendor
    ? jobsForDay
        .filter((j) => j.vendor === activeVendor)
        .map((j) => j.sequence)
    : [];
  const lastSeq = usedSequences.length ? Math.max(...usedSequences) : 0;
  const defaultSequence = Math.min(99, lastSeq + 1);

  const newJobDisabled = creating || !vendors?.length || !activeVendor;
  const newJobTitle = !vendors?.length
    ? '먼저 벤더를 추가하세요'
    : !activeVendor
    ? '헤더에서 벤더를 선택하세요'
    : `${selectedDate} · ${activeVendor} 새 작업 생성`;

  return (
    <div className="calendar-view">
      <div className="calendar-view__header">
        <div className="calendar-view__nav">
          <button type="button" className="btn btn--secondary" onClick={goPrevMonth} aria-label="이전 달">◀</button>
          <div className="calendar-view__title-wrap" ref={ymPickerRef}>
            <button
              type="button"
              className="calendar-view__title-btn"
              onClick={() => setYmPickerOpen((o) => !o)}
              title="연도 · 월 선택"
            >
              <h2 className="calendar-view__title">{year}년 {month}월</h2>
              <span className="calendar-view__title-chev">▾</span>
            </button>
            {ymPickerOpen && (
              <div className="ym-picker">
                <div className="ym-picker__year-row">
                  <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="이전 해">◀</button>
                  <span className="ym-picker__year">{year}</span>
                  <button type="button" onClick={() => setYear((y) => y + 1)} aria-label="다음 해">▶</button>
                </div>
                <div className="ym-picker__month-grid">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`ym-picker__month${m === month ? ' is-active' : ''}`}
                      onClick={() => { setMonth(m); setYmPickerOpen(false); }}
                    >
                      {m}월
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
              onClick={handleOpenNewJobModal}
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

      {showNewJobModal && (
        <NewJobModal
          date={selectedDate}
          vendor={activeVendor}
          usedSequences={usedSequences}
          defaultSequence={defaultSequence}
          onCancel={() => setShowNewJobModal(false)}
          onCoupang={handleCoupangMode}
          onFile={handleFileMode}
        />
      )}
    </div>
  );
}
