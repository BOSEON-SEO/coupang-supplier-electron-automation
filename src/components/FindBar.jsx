import React, { useCallback, useEffect, useRef, useState } from 'react';
import { setReserveTop } from '../lib/webviewReserve';

// FindBar 높이(36px) + 상단 여유 8px + 하단 여유 4px
const WEBVIEW_FIND_RESERVE = 48;

/**
 * 찾기 바 — Chrome 네이티브 찾기 바 모양을 따라함.
 *
 *   main.js 의 attachFindHandlers 가 webView 의 before-input-event 로 Ctrl+F 를
 *   가로채 renderer 에 find:open 이벤트 발송. 메인 renderer 쪽은 App.jsx 가
 *   window keydown 으로 받아 app-find-open 커스텀 이벤트 발송.
 *
 *   target === 'webview' 일 때: .webview-host 우상단에 absolute(fixed) 포지셔닝
 *   target === 'main'    일 때: 앱 윈도우 우상단 고정
 *
 *   Enter = 다음, Shift+Enter = 이전, Esc = 닫기.
 */
export default function FindBar() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('main');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ current: 0, total: 0 });
  const [pos, setPos] = useState({ top: 12, right: 12 });
  const inputRef = useRef(null);
  const targetRef = useRef('main');

  useEffect(() => { targetRef.current = target; }, [target]);

  // target === 'webview' 일 때:
  //   1) WCV 상단 48px 양보 시켜 HTML 이 노출될 공간 확보 (setReserveTop)
  //   2) .webview-host 기준 우상단에 바 배치, bounds 변화 감지해서 재측정
  useEffect(() => {
    if (!open || target !== 'webview') {
      setReserveTop(0);
      setPos({ top: 12, right: 12 });
      return undefined;
    }

    setReserveTop(WEBVIEW_FIND_RESERVE);

    const measure = () => {
      const host = document.querySelector('.webview-host');
      if (!host) return;
      const r = host.getBoundingClientRect();
      const ww = window.innerWidth;
      setPos({
        top: Math.max(8, r.top + 6),
        right: Math.max(8, ww - r.right + 6),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('webview-bounds-update', measure);
    let ro = null;
    const host = document.querySelector('.webview-host');
    if (host && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(host);
    }
    return () => {
      setReserveTop(0);
      window.removeEventListener('resize', measure);
      window.removeEventListener('webview-bounds-update', measure);
      if (ro) ro.disconnect();
    };
  }, [open, target]);

  // Ctrl+F 신호 수신 + found-in-page 결과 수신
  useEffect(() => {
    const api = window.electronAPI?.find;
    if (!api) return undefined;

    const doOpen = (t) => {
      setTarget(t || 'main');
      setOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    const offOpen = api.onOpen((data) => doOpen(data?.target || 'main'));

    // 이 창의 Ctrl+F 를 직접 감지 — 포커스가 스프레드시트면 FortuneSheet 네이티브에 위임.
    const onKey = (e) => {
      const isCtrlF = (e.ctrlKey || e.metaKey)
        && typeof e.key === 'string'
        && e.key.toLowerCase() === 'f'
        && !e.altKey && !e.shiftKey;
      if (!isCtrlF) return;
      const activeEl = document.activeElement;
      const inSheet = !!(activeEl && activeEl.closest
        && activeEl.closest('.spreadsheet-container'));
      if (inSheet) return;
      e.preventDefault();
      doOpen('main');
    };
    window.addEventListener('keydown', onKey);

    const offResult = api.onResult((data) => {
      if (!data) return;
      if (data.target !== targetRef.current) return;
      if (data.finalUpdate || data.matches === 0) {
        // findInPage 가 FindBar 의 input value 까지 매칭에 포함하므로 1건 보정.
        // (Chromium 의 webContents.findInPage 는 visible form control 의 value
        // 도 매칭하는 동작이라 Shadow DOM 격리로는 회피 불가 — 상수 1 빼는 것이
        // 가장 단순.)
        const total = Math.max(0, (data.matches || 0) - 1);
        const ord = (data.activeMatchOrdinal || 0) - 1;
        setResult({
          current: total > 0 ? Math.max(1, Math.min(ord, total)) : 0,
          total,
        });
      }
    });

    return () => {
      if (typeof offOpen === 'function') offOpen();
      if (typeof offResult === 'function') offResult();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = useCallback(() => {
    const api = window.electronAPI?.find;
    if (api) api.close(targetRef.current);
    setOpen(false);
    setQuery('');
    setResult({ current: 0, total: 0 });
  }, []);

  // Esc 로 닫기 (FindBar 가 열려있을 때만)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const handleChange = (e) => {
    const text = e.target.value;
    setQuery(text);
    const api = window.electronAPI?.find;
    if (!api) return;
    if (!text) {
      api.close(targetRef.current);
      setResult({ current: 0, total: 0 });
      return;
    }
    // 새 쿼리 — findNext 없이 재시작
    api.query(targetRef.current, text, { findNext: false });
  };

  const step = (forward) => {
    if (!query) return;
    const api = window.electronAPI?.find;
    if (!api) return;
    api.query(targetRef.current, query, { findNext: true, forward });
  };

  if (!open) return null;

  const noMatch = !!query && result.total === 0;
  const disabled = result.total === 0;

  return (
    <div
      className={`find-bar find-bar--${target}${noMatch ? ' find-bar--nomatch' : ''}`}
      role="search"
      style={{ top: pos.top, right: pos.right }}
    >
      {/*
       * input value 가 findInPage 결과에 1건 포함되는 건 onResult 보정으로 처리.
       * (이전 ShadowPortal 격리 시도는 Shadow DOM + Strict Mode 가 createPortal
       * race 를 만들어 한 글자만 입력되고 멈추는 부작용이 있었음.)
       */}
      <input
        ref={inputRef}
        type="text"
        className="find-bar__input"
        placeholder="찾기"
        value={query}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(!e.shiftKey);
          }
        }}
      />
      <span className="find-bar__count">
        {query
          ? (result.total > 0 ? `${result.current}/${result.total}` : '0/0')
          : ''}
      </span>
      <div className="find-bar__divider" />
      <button
        type="button"
        className="find-bar__btn"
        onClick={() => step(false)}
        title="이전 (Shift+Enter)"
        disabled={disabled}
        aria-label="이전"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 5l-5 5h10l-5-5z" />
        </svg>
      </button>
      <button
        type="button"
        className="find-bar__btn"
        onClick={() => step(true)}
        title="다음 (Enter)"
        disabled={disabled}
        aria-label="다음"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 11l5-5H3l5 5z" />
        </svg>
      </button>
      <div className="find-bar__divider" />
      <button
        type="button"
        className="find-bar__btn find-bar__btn--close"
        onClick={close}
        title="닫기 (Esc)"
        aria-label="닫기"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 6.59L11.59 3 13 4.41 9.41 8 13 11.59 11.59 13 8 9.41 4.41 13 3 11.59 6.59 8 3 4.41 4.41 3 8 6.59z" />
        </svg>
      </button>
    </div>
  );
}
