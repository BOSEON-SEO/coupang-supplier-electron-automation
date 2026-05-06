import React, { useEffect, useRef, useState } from 'react';
import { I } from './icons';
import { subscribeReserveTop } from '../lib/webviewReserve';

/**
 * v4 우측 슬라이드 웹뷰 — mockup 디자인 (◀ ▶ ↻ + URL + ✕).
 * Main process 의 WebContentsView 를 컨테이너에 overlay.
 * 기존 src/components/WebView.jsx 의 IPC 로직을 그대로 가져오되 toolbar 만 v4 모양으로.
 */
const COUPANG_HOME_URL = 'https://supplier.coupang.com/dashboard/KR';

export default function WebPanel({ vendor, isActive, onClose }) {
  const containerRef = useRef(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [downloadingPO, setDownloadingPO] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  useEffect(() => { setLoginBusy(false); }, [vendor]);

  // python:* 이벤트 — PO 다운로드 진행 시 overlay
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.pythonStatus?.().then((s) => {
      if (s?.running && s.scriptName?.includes('po_download.py')) setDownloadingPO(true);
    });
    const unsubLog = api.onPythonLog?.((data) => {
      const name = data?.scriptName || '';
      if (name.includes('po_download.py')) setDownloadingPO(true);
    });
    const unsubDone = api.onPythonDone?.((data) => {
      const name = data?.scriptName || '';
      if (name.includes('po_download.py')) setDownloadingPO(false);
      if (name.includes('login.py')) setLoginBusy(false);
    });
    return () => {
      if (typeof unsubLog === 'function') unsubLog();
      if (typeof unsubDone === 'function') unsubDone();
    };
  }, []);

  // 컨테이너 bounds 추적 → main webview:setBounds. FindBar 가 양보하는 reserveTop 도 적용.
  const reserveTopRef = useRef(0);
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api || !containerRef.current) return;
    // 좌측 6px 는 resize handle 영역 — BrowserView 가 그 위 덮으면 드래그 불가.
    const RESIZER_GUTTER = 6;
    const updateBounds = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rt = reserveTopRef.current;
      api.setBounds({
        x: rect.x + RESIZER_GUTTER,
        y: rect.y + rt,
        width: Math.max(0, rect.width - RESIZER_GUTTER),
        height: Math.max(0, rect.height - rt),
      });
    };
    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    ro.observe(containerRef.current);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, { passive: true, capture: true });
    window.addEventListener('webview-bounds-update', updateBounds);
    const unsub = subscribeReserveTop((v) => {
      reserveTopRef.current = v;
      updateBounds();
    });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, { capture: true });
      window.removeEventListener('webview-bounds-update', updateBounds);
      unsub();
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api) return;
    api.setVisible(!!isActive && !!vendor);
  }, [isActive, vendor]);

  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api || !vendor) return;
    api.setVendor(vendor);
  }, [vendor]);

  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api?.onUrlChanged) return;
    const unsub = api.onUrlChanged(({ url }) => {
      setCurrentUrl(url || '');
      if (!editingUrl) setDraftUrl(url || '');
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [editingUrl]);

  const navigate = (url) => {
    if (!url) return;
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      // 도메인 형태면 https 보정, 아니면 구글 검색
      if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(target)) target = 'https://' + target;
      else target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
    }
    window.electronAPI?.webview?.navigate?.(target);
    setEditingUrl(false);
  };
  const handleBack = () => window.electronAPI?.webview?.goBack?.();
  const handleForward = () => window.electronAPI?.webview?.goForward?.();
  const handleReload = () => window.electronAPI?.webview?.reload?.();
  const handleHome = () => window.electronAPI?.webview?.navigate?.(COUPANG_HOME_URL);
  const handleLogin = async () => {
    if (!vendor) { alert('먼저 벤더를 선택하세요.'); return; }
    const api = window.electronAPI;
    const cred = await api?.checkCredentials?.(vendor);
    if (!cred?.hasId || !cred?.hasPassword) {
      alert('자격증명이 없습니다.\n[설정] 에서 ID/PW 를 먼저 저장하세요.');
      return;
    }
    setLoginBusy(true);
    const res = await api?.runPython?.('scripts/login.py', ['--vendor', vendor]);
    if (!res?.success) {
      alert(res?.error?.includes('already running') ? '이미 다른 작업이 진행 중입니다.' : `로그인 실행 실패: ${res?.error || 'unknown'}`);
      setLoginBusy(false);
    }
  };

  const displayUrl = editingUrl ? draftUrl : (currentUrl || '');

  return (
    <>
      <div className="web-panel-head">
        <button className="wp-iconbtn" onClick={handleBack} title="뒤로"><I.ChevronL size={13} stroke="#777"/></button>
        <button className="wp-iconbtn" onClick={handleForward} title="앞으로"><I.Chevron size={13} stroke="#777"/></button>
        <button className="wp-iconbtn" onClick={handleReload} title="새로고침"><I.RefreshCw size={13} stroke="#777"/></button>
        <input
          className="url"
          value={displayUrl}
          onChange={(e) => { setDraftUrl(e.target.value); setEditingUrl(true); }}
          onFocus={(e) => { setEditingUrl(true); e.target.select(); }}
          onBlur={() => setEditingUrl(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(draftUrl); if (e.key === 'Escape') { setEditingUrl(false); setDraftUrl(currentUrl); } }}
          placeholder="https://supplier.coupang.com"
          spellCheck={false}
        />
        {onClose && (
          <button className="x" onClick={onClose} title="닫기"><I.X size={13}/></button>
        )}
      </div>
      <div className="web-panel-bookmarks">
        <button className="wp-bookmark" onClick={handleHome} title="쿠팡 서플라이어 홈">
          <I.Home size={12}/>
          <span>쿠팡 서플라이어</span>
        </button>
        <button
          className={'wp-bookmark' + (loginBusy ? ' busy' : '')}
          onClick={handleLogin}
          disabled={loginBusy || !vendor}
          title={vendor ? `${vendor} 자동 로그인` : '벤더 미선택'}
        >
          {loginBusy ? <I.Loader size={12}/> : <I.Key size={12}/>}
          <span>{loginBusy ? '로그인 중…' : '자동 로그인'}</span>
        </button>
      </div>
      <div className="web-panel-body" ref={containerRef}>
        {/* WebContentsView 가 이 영역 위에 overlay (Main process bounds 동기화) */}
        {downloadingPO && (
          <div className="wp-overlay">
            <div className="wp-overlay-card">
              <I.Loader size={16} stroke="var(--accent)"/>
              <span>PO 다운로드 진행 중…</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
