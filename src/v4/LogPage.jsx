// 별도 BrowserWindow 의 실행 로그 뷰. main 의 logBuffer 백필 + python:log/error/done 실시간 구독.
import React, { useEffect, useRef, useState } from 'react';

const LIMIT = 5000; // 화면에 보여주는 최대 라인

function classify(channel, payload) {
  if (channel === 'python:done') {
    return { level: 'done', ts: payload?.ts || Date.now(), text: `[done] ${payload?.scriptName || ''} exitCode=${payload?.exitCode}` };
  }
  if (channel === 'python:error') {
    return { level: 'error', ts: payload?.ts || Date.now(), text: payload?.line || JSON.stringify(payload) };
  }
  // python:log — payload 의 level 필드가 있으면 그대로 (info/ok/warn/plugin)
  const lvl = (payload?.level && ['info', 'ok', 'warn', 'plugin'].includes(payload.level))
    ? payload.level : 'info';
  const text = payload?.line || payload?.message || JSON.stringify(payload);
  return { level: lvl, ts: payload?.ts || Date.now(), text };
}

function fmtTs(t) {
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function LogPage() {
  const [lines, setLines] = useState([]);
  const [autoscroll, setAutoscroll] = useState(true);
  const bodyRef = useRef(null);

  // 백필 + 실시간 구독
  useEffect(() => {
    const api = window.electronAPI;
    let cancelled = false;
    (async () => {
      const buf = await api?.logWindow?.fetchBuffer?.();
      if (cancelled || !buf?.lines) return;
      setLines(buf.lines.map((b) => classify(b.channel, b.payload)));
    })();

    const offLog = api?.onPythonLog?.((data) => setLines((ls) => trim([...ls, classify('python:log', data)])));
    const offErr = api?.onPythonError?.((data) => setLines((ls) => trim([...ls, classify('python:error', data)])));
    const offDone = api?.onPythonDone?.((data) => setLines((ls) => trim([...ls, classify('python:done', data)])));

    return () => {
      cancelled = true;
      if (typeof offLog === 'function') offLog();
      if (typeof offErr === 'function') offErr();
      if (typeof offDone === 'function') offDone();
    };
  }, []);

  // autoscroll
  useEffect(() => {
    if (!autoscroll) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, autoscroll]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    if (atBottom !== autoscroll) setAutoscroll(atBottom);
  };

  return (
    <div className="logpage">
      <header className="logpage-head">
        <span className="logpage-title">실행 로그</span>
        <span className="logpage-meta">{lines.length} lines · {autoscroll ? 'auto' : 'paused'}</span>
        <div style={{ flex: 1 }} />
        <button className="logpage-btn" onClick={() => setLines([])} title="화면 비우기">Clear</button>
        <button className="logpage-btn" onClick={() => setAutoscroll((v) => !v)}>
          {autoscroll ? '⏸ 일시정지' : '▶ 자동스크롤'}
        </button>
      </header>
      <div ref={bodyRef} className="logpage-body" onScroll={onScroll}>
        {lines.length === 0 ? (
          <div className="logpage-empty">로그 없음</div>
        ) : lines.map((l, i) => (
          <div key={i} className={`logpage-line lvl-${l.level}`}>
            <span className="logpage-ts">{fmtTs(l.ts)}</span>
            <span className="logpage-lvl">[{l.level}]</span>
            <span className="logpage-text">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function trim(arr) {
  if (arr.length <= LIMIT) return arr;
  return arr.slice(arr.length - LIMIT);
}
