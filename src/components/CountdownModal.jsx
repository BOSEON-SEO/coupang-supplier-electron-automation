import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 위험 동작 3초 카운트다운 모달 (재사용)
 *
 * Props:
 *   - actionName: string — 실행하려는 동작의 이름
 *   - seconds?: number — 기본 3
 *   - onConfirm: () => void — 카운트다운 만료 시 호출
 *   - onCancel: () => void — 사용자가 취소하거나 unmount 시 호출
 *
 * 쿠팡 DoD: 위험 동작 실행 전 3초 카운트다운 + 취소 가능 (CLAUDE.md)
 */
export default function CountdownModal({
  actionName,
  seconds = 3,
  onConfirm,
  onCancel,
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onConfirm?.();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onConfirm]);

  const progress = Math.max(0, Math.min(1, (seconds - remaining) / seconds));

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal modal--countdown">
        <h2 className="modal__title">⚠️ 위험 동작 실행 대기</h2>
        <div className="modal__body">
          <p className="countdown__action">{actionName}</p>
          <div className="countdown__number" aria-live="polite">{remaining}</div>
          <div className="countdown__bar">
            <div
              className="countdown__bar-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p className="countdown__help">
            {remaining}초 후 자동 실행됩니다. 취소하려면 아래 버튼을 누르세요.
          </p>
        </div>
        <div className="modal__footer">
          <button
            type="button"
            className="btn btn--danger"
            onClick={onCancel}
          >
            ✕ 취소
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
