import React, { useEffect, useRef, useState } from 'react';

/**
 * 웹 뷰 탭 — Main 의 WebContentsView 를 컨테이너 위에 overlay
 *
 * 구성:
 *   상단 툴바: 🏠 / ↻ 아이콘 + 주소창(편집 가능) + 이동 버튼
 *   본문: WebContentsView 가 overlay 되는 빈 영역
 *
 * 주소창은 실제 브라우저처럼 동작:
 *   - 입력 후 Enter 또는 ↵ 클릭 → main 의 webview.navigate 호출
 *   - 'http://' / 'https://' 가 없으면 자동 보정 (도메인 형태) 또는 구글 검색
 *   - WCV 에서 페이지가 바뀌면 onUrlChanged 이벤트로 입력 박스 동기화
 */
export default function WebView({ vendor, isActive }) {
  const containerRef = useRef(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);

  // 컨테이너 bounds 추적 → main
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api || !containerRef.current) return;

    const updateBounds = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      api.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };

    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    ro.observe(containerRef.current);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, { passive: true, capture: true });
    window.addEventListener('webview-bounds-update', updateBounds);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, { capture: true });
      window.removeEventListener('webview-bounds-update', updateBounds);
    };
  }, []);

  // 가시성
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api) return;
    api.setVisible(!!isActive && !!vendor);
  }, [isActive, vendor]);

  // 벤더 변경 → main 에서 partition 별 WCV 재생성
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api || !vendor) return;
    api.setVendor(vendor);
  }, [vendor]);

  // WCV 의 URL 변경을 수신 → 주소창 동기화 (편집 중이면 덮어쓰지 않음)
  useEffect(() => {
    const api = window.electronAPI?.webview;
    if (!api?.onUrlChanged) return;
    const unsub = api.onUrlChanged(({ url }) => {
      setCurrentUrl(url || '');
      if (!editingUrl) setDraftUrl(url || '');
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [editingUrl]);

  const handleGoHome = () =>
    window.electronAPI?.webview?.navigate('https://supplier.coupang.com');
  const handleReload = () => window.electronAPI?.webview?.reload();
  const handleNavigate = () => {
    if (!draftUrl.trim()) return;
    window.electronAPI?.webview?.navigate(draftUrl.trim());
    setEditingUrl(false);
  };
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNavigate();
    } else if (e.key === 'Escape') {
      setDraftUrl(currentUrl);
      setEditingUrl(false);
      e.target.blur();
    }
  };

  return (
    <div className="webview-wrapper">
      {vendor && (
        <div className="webview-toolbar">
          <button
            type="button"
            className="webview-icon-btn"
            onClick={handleGoHome}
            title="supplier.coupang.com 으로 이동"
            aria-label="홈"
          >
            🏠
          </button>
          <button
            type="button"
            className="webview-icon-btn"
            onClick={handleReload}
            title="새로고침"
            aria-label="새로고침"
          >
            ↻
          </button>
          <div className="webview-urlbar">
            <input
              type="text"
              className="webview-urlbar__input"
              value={draftUrl}
              onChange={(e) => { setDraftUrl(e.target.value); setEditingUrl(true); }}
              onFocus={(e) => { setEditingUrl(true); e.target.select(); }}
              onBlur={() => setEditingUrl(false)}
              onKeyDown={handleKeyDown}
              placeholder="URL 또는 검색어 입력 후 Enter"
              spellCheck={false}
            />
            <button
              type="button"
              className="webview-urlbar__go"
              onClick={handleNavigate}
              title="이동 (Enter)"
              aria-label="이동"
            >
              ↵
            </button>
          </div>
        </div>
      )}
      <div className="webview-host" ref={containerRef}>
        {!vendor && (
          <div className="webview-placeholder">
            <p className="placeholder-text">🌐 웹 뷰</p>
            <p className="placeholder-sub">먼저 상단에서 벤더를 선택하거나 추가하세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
