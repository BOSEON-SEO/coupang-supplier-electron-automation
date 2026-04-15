import React from 'react';

/**
 * 작업 phase 진행 상태를 시각적으로 보여주는 stepper.
 *
 * Props:
 *   - phase: 'po_downloaded' | 'matched' | 'assigned' | 'uploaded'
 *   - completed: boolean (uploaded 자동 또는 사용자 명시)
 */

const STEPS = [
  { id: 'po_downloaded', label: 'PO 다운' },
  { id: 'matched',       label: '재고 매칭' },
  { id: 'assigned',      label: '쉽먼트 지정' },
  { id: 'uploaded',      label: '업로드 완료' },
];

export default function PhaseStepper({ phase = 'po_downloaded', completed = false }) {
  const currentIdx = STEPS.findIndex((s) => s.id === phase);

  return (
    <div className="phase-stepper">
      {STEPS.map((s, i) => {
        const done = i < currentIdx || (completed && i <= currentIdx);
        const active = i === currentIdx && !completed;
        return (
          <React.Fragment key={s.id}>
            <div className={`phase-stepper__step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}>
              <span className="phase-stepper__bullet">
                {done ? '●' : active ? '◐' : '○'}
              </span>
              <span className="phase-stepper__label">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className={`phase-stepper__line${done ? ' is-done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
