import React, { useEffect, useRef, useState } from 'react';
import { I } from './icons';
import { subscribeReserveTop } from '../lib/webviewReserve';

/**
 * v4 우측 슬라이드 웹뷰 — mockup 디자인 (◀ ▶ ↻ + URL + ✕).
 * Main process 의 WebContentsView 를 컨테이너에 overlay.
 * 기존 src/components/WebView.jsx 의 IPC 로직을 그대로 가져오되 toolbar 만 v4 모양으로.
 */
export default function WebPanel({ vendor, isActive, onClose }) {
  const containerRef = useRef(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [downloadingPO, setDownloadingPO] = useState(false);

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
    const updateBounds = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rt = reserveTopRef.current;
      api.setBounds({
        x: rect.x,
        y: rect.y + rt,
        width: rect.width,
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
