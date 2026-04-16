import React from 'react';

/**
 * 작업 phase 진행 상태를 시각적으로 보여주는 stepper.
 *
 * 쿠팡 3스텝 + 사이 2개 작업:
 *   1. po_downloaded  — PO 다운 완료 (쿠팡 1단계)
 *   2. confirmed      — 발주확정서 작성 (사내 작업 1~2 사이)
 *   3. uploaded       — 발주확정 업로드 완료 (쿠팡 2단계)
 *   4. assigned       — 운송(쉽먼트/밀크런) 분배 (사내 작업 2~3 사이)
 *   5. completed      — 쿠팡 운송 지정 완료 (쿠팡 3단계)
 *
 * Props:
 *   - phase: 위 id 중 하나
 *   - completed: boolean (사용자 명시적 완료)
 */

export const PHASE_STEPS = [
  { id: 'po_downloaded', label: 'PO 다운' },
  { id: 'confirmed',     label: '발주확정서' },
  { id: 'uploaded',      label: '쿠팡 업로드' },
  { id: 'assigned',      label: '운송 분배' },
  { id: 'completed',     label: '완료' },
];

export function nextPhase(currentPhase) {
  const idx = PHASE_STEPS.findIndex((s) => s.id === currentPhase);
  if (idx < 0 || idx >= PHASE_STEPS.length - 1) return null;
  return PHASE_STEPS[idx + 1].id;
}

const STEPS = PHASE_STEPS;

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
