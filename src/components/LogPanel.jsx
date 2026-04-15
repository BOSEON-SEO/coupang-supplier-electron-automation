import React, { useEffect, useRef } from 'react';

/**
 * 로그 패널 컴포넌트
 * - Python subprocess stdout/stderr 스트리밍 표시
 * - 새 로그 추가 시 자동 스크롤
 *
 * @param {{ logs: { time: string, level: string, message: string }[] }} props
 */
export default function LogPanel({ logs, hideHeader = false }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLevelClass = (level) => {
    switch (level) {
      case 'error': return 'log-entry--error';
      case 'warn': return 'log-entry--warn';
      default: return 'log-entry--info';
    }
  };

  return (
    <div className="log-panel">
      {!hideHeader && (
        <div className="log-panel__header">
          <span>📋 작업 로그</span>
          <span className="log-panel__count">{logs.length}건</span>
        </div>
      )}
      <div className="log-panel__body">
        {logs.map((log, i) => (
          <div key={i} className={`log-entry ${getLevelClass(log.level)}`}>
            <span className="log-entry__time">
              {new Date(log.time).toLocaleTimeString('ko-KR')}
            </span>
            <span className="log-entry__level">[{log.level.toUpperCase()}]</span>
            <span className="log-entry__message">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
