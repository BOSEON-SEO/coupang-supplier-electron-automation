import React from 'react';

/**
 * 작업 진행 상태 stepper — 4 단계 (간소화).
 *
 *   1. PO 다운      — phase 가 어떤 값이든 일단 다운 단계는 지남 (= 0 이상)
 *   2. 발주 확정    — phase === 'uploaded' 되면 완료 (쿠팡에 업로드됨)
 *   3. 물류 처리    — manifest.shipmentHistory 또는 milkrunHistory 에 1건 이상
 *   4. 완료         — manifest.completed === true
 *
 * 내부 phase 필드(po_downloaded / confirmed / uploaded / assigned) 와는
 * 분리된 시각적 진행도 — manifest 필드는 그대로 둔 채 표시만 재구성.
 */

// 레거시 phase 체인 — nextPhase 사용처 (WorkView.handleAdvancePhase) 호환용.
// 실제 UI 스텝 수는 아래 VISUAL_STEPS 를 따름.
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

// 사용자에게 보여줄 스텝.
const VISUAL_STEPS = [
  { key: 'po',        label: 'PO 다운' },
  { key: 'confirm',   label: '발주 확정' },
  { key: 'logistics', label: '물류 처리' },
  { key: 'done',      label: '완료' },
];

/**
 * job 데이터에서 현재 활성 스텝 index 를 계산.
 *   0: PO 다운 중
 *   1: 발주 확정 중
 *   2: 물류 처리 대기/진행
 *   3: 완료 대기 (물류 완료했지만 아직 completed=false)
 *   4: 모든 스텝 완료
 */
function computeProgress({ phase, completed, shipmentHistory, milkrunHistory }) {
  if (completed) return VISUAL_STEPS.length;
  const hasLogistics =
    (Array.isArray(shipmentHistory) && shipmentHistory.length > 0)
    || (Array.isArray(milkrunHistory) && milkrunHistory.length > 0);
  if (hasLogistics) return 3;
  if (phase === 'uploaded') return 2;
  if (phase === 'confirmed') return 1;
  return 0; // po_downloaded 또는 그 외
}

export default function PhaseStepper({ job }) {
  const progress = computeProgress({
    phase: job?.phase,
    completed: !!job?.completed,
    shipmentHistory: job?.shipmentHistory,
    milkrunHistory: job?.milkrunHistory,
  });

  return (
    <div className="phase-stepper">
      {VISUAL_STEPS.map((s, i) => {
        const done = i < progress;
        const active = i === progress && progress < VISUAL_STEPS.length;
        return (
          <React.Fragment key={s.key}>
            <div className={`phase-stepper__step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}>
              <span className="phase-stepper__bullet">
                {done ? '●' : active ? '◐' : '○'}
              </span>
              <span className="phase-stepper__label">{s.label}</span>
            </div>
            {i < VISUAL_STEPS.length - 1 && (
              <span className={`phase-stepper__line${done ? ' is-done' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
