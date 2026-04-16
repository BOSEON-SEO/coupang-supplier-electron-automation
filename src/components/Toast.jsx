import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * 화면 우하단에 쌓이는 토스트 알림.
 *   - type: 'success' | 'error' | 'warn' | 'info'
 *   - duration: 자동 닫힘 ms (기본 4000)
 */

const ICON_BY_TYPE = {
  success: '✓',
  error: '✕',
  warn: '⚠',
  info: 'ℹ',
};

function Toast({ toast, onRemove }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), toast.duration || 4000);
    return () => clearTimeout(t);
  }, [toast, onRemove]);

  return (
    <div className={`toast toast--${toast.type || 'info'}`}>
      <span className="toast__icon">{ICON_BY_TYPE[toast.type] || 'ℹ'}</span>
      <span className="toast__text">{toast.text}</span>
      <button
        type="button"
        className="toast__close"
        onClick={() => onRemove(toast.id)}
        aria-label="닫기"
      >
        ×
      </button>
    </div>
  );
}

export default function ToastContainer({ toasts, onRemove }) {
  if (!toasts?.length) return null;
  return createPortal(
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>,
    document.body,
  );
}
