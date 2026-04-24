import React from 'react';
import PhaseStepper from './PhaseStepper';

/**
 * 작업 카드 — 달력 우측 패널에 표시.
 * Props:
 *   - job: manifest. `remote: true` 면 DB 에만 있는 원격 작업 (로컬 skeleton 없음).
 *   - vendorName?: 표시용 벤더 이름 (없으면 id)
 *   - onClick: () => void
 *   - onDelete?: (job) => void. null 이면 삭제 버튼 숨김 (원격 전용 작업).
 */
function formatUpdated(raw) {
  if (!raw) return '';
  // MySQL DATETIME 은 '2026-04-22 10:00:00' 로 직렬화되는 경우가 있어 브라우저 Date 파서가 실패.
  // 공백 → 'T' 치환해서 ISO 로 표준화.
  const s = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2} /.test(raw)
    ? raw.replace(' ', 'T')
    : raw;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR');
}

export default function JobCard({ job, vendorName, onClick, onDelete }) {
  const updated = formatUpdated(job.updatedAt);
  const isRemote = !!job.remote;

  const handleDelete = (e) => {
    e.stopPropagation();
    const label = `${vendorName || job.vendor} ${job.sequence}차 (${job.date})`;
    if (!window.confirm(`${label} 작업을 삭제하시겠습니까?\n로컬 파일이 함께 삭제됩니다.`)) return;
    onDelete?.(job);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={
        'job-card'
        + (job.completed ? ' job-card--completed' : '')
        + (isRemote ? ' job-card--remote' : '')
      }
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
      title={isRemote ? '원격 DB 에만 있는 작업 — 클릭하면 로컬로 가져와 열립니다.' : undefined}
    >
      <div className="job-card__head">
        <span className="job-card__title">
          {vendorName || job.vendor} <span className="job-card__seq">· {job.sequence}차</span>
        </span>
        <span className="job-card__head-actions">
          {isRemote && (
            <span className="job-card__badge job-card__badge--remote" title="원격 작업">
              ☁ 원격
            </span>
          )}
          {job.completed
            ? <span className="job-card__badge job-card__badge--done">✓ 완료</span>
            : <span className="job-card__badge job-card__badge--inprogress">진행중</span>}
          {onDelete && (
            <button
              type="button"
              className="job-card__delete"
              onClick={handleDelete}
              title="작업 삭제"
              aria-label="작업 삭제"
            >
              🗑
            </button>
          )}
        </span>
      </div>
      <PhaseStepper job={job} />
      {updated && <div className="job-card__updated">최근 수정 {updated}</div>}
    </div>
  );
}
