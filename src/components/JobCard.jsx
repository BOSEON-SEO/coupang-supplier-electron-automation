import React from 'react';
import PhaseStepper from './PhaseStepper';

/**
 * 작업 카드 — 달력 우측 패널에 표시.
 * Props:
 *   - job: manifest
 *   - vendorName?: 표시용 벤더 이름 (없으면 id)
 *   - onClick: () => void
 */
export default function JobCard({ job, vendorName, onClick, onDelete }) {
  const updated = job.updatedAt ? new Date(job.updatedAt).toLocaleString('ko-KR') : '';

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
      className={`job-card${job.completed ? ' job-card--completed' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
    >
      <div className="job-card__head">
        <span className="job-card__title">
          {vendorName || job.vendor} <span className="job-card__seq">· {job.sequence}차</span>
        </span>
        <span className="job-card__head-actions">
          {job.completed
            ? <span className="job-card__badge job-card__badge--done">✓ 완료</span>
            : <span className="job-card__badge job-card__badge--inprogress">진행중</span>}
          <button
            type="button"
            className="job-card__delete"
            onClick={handleDelete}
            title="작업 삭제"
            aria-label="작업 삭제"
          >
            🗑
          </button>
        </span>
      </div>
      <PhaseStepper phase={job.phase} completed={job.completed} />
      {updated && <div className="job-card__updated">최근 수정 {updated}</div>}
    </div>
  );
}
