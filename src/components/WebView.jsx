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
  const [loginBusy, setLoginBusy] = useState(false);
  const [downloadingPO, setDownloadingPO] = useState(false);

  // Python 이벤트 감지: login 버튼 busy, PO 다운로드 overlay
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    // 마운트 시점에 이미 실행 중일 수 있음 → 현재 상태 조회
    api.pythonStatus?.().then((s) => {
      if (s?.running && s.scriptName?.includes('po_download.py')) {
        setDownloadingPO(true);
      }
    });

    const unsubLog = api.onPythonLog?.((data) => {
      const name = data?.scriptName || '';
      if (name.includes('po_download.py')) setDownloadingPO(true);
    });
    const unsubDone = api.onPythonDone?.((data) => {
      const name = data?.scriptName || '';
      if (name.includes('login.py')) setLoginBusy(false);
      if (name.includes('po_download.py')) setDownloadingPO(false);
    });
    return () => {
      if (typeof unsubLog === 'function') unsubLog();
      if (typeof unsubDone === 'function') unsubDone();
    };
  }, []);

  // 벤더 바뀌면 busy 리셋
  useEffect(() => { setLoginBusy(false); }, [vendor]);

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

  // 가시성 — WCV 는 항상 살려두어 쿠팡 페이지 동작을 실시간으로 보여준다.
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
  const handleLogin = async () => {
    if (!vendor) {
      alert('먼저 벤더를 선택하세요.');
      return;
    }
    const api = window.electronAPI;
    const cred = await api.checkCredentials(vendor);
    if (!cred?.hasId || !cred?.hasPassword) {
      alert('자격증명이 설정되지 않았습니다.\n[⚙ 관리] 에서 ID/PW 를 먼저 저장하세요.');
      return;
    }
    setLoginBusy(true);
    const res = await api.runPython('scripts/login.py', ['--vendor', vendor]);
    if (!res?.success) {
      if (res?.error?.includes('already running')) {
        alert('이미 다른 작업이 진행 중입니다.');
      } else {
        alert(`로그인 실행 실패: ${res?.error ?? 'unknown'}`);
      }
      setLoginBusy(false);
    }
  };
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
            onClick={handleLogin}
            disabled={loginBusy || !vendor}
            title={loginBusy ? '로그인 중...' : '저장된 자격증명으로 로그인'}
            aria-label="로그인"
          >
            {loginBusy ? '◌' : '🔑'}
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
          {downloadingPO && (
            <span
              className="webview-progress-badge"
              title="PO 다운로드 진행 중 — 보통 5~10초 소요됩니다"
            >
              <span className="webview-progress-badge__spinner" />
              PO 다운로드 중
            </span>
          )}
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
