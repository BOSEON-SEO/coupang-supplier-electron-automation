import React, { useState, useEffect } from 'react';
import WebView from './components/WebView';
import WorkView from './components/WorkView';
import VendorSelector from './components/VendorSelector';
import LoginButton from './components/LoginButton';

const PANEL_OPEN_KEY = 'coupang-supplier:workPanelOpen';
const PANEL_HEIGHT = '70vh'; // 작업 패널 고정 높이 (열렸을 때)

export default function App() {
  const [vendor, setVendor] = useState('');

  const [workOpen, setWorkOpen] = useState(() => {
    try {
      return window.localStorage?.getItem(PANEL_OPEN_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // localStorage 동기화
  useEffect(() => {
    try { window.localStorage?.setItem(PANEL_OPEN_KEY, String(workOpen)); } catch { /* 무시 */ }
  }, [workOpen]);

  // 패널 트랜지션 동안 매 프레임 WebView bounds 갱신
  useEffect(() => {
    const start = performance.now();
    let rafId = 0;
    const tick = (now) => {
      if (now - start > 400) return;
      window.dispatchEvent(new Event('webview-bounds-update'));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [workOpen]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">쿠팡 서플라이어 자동화</h1>
        <VendorSelector value={vendor} onChange={setVendor} />
        <LoginButton vendor={vendor} />
      </header>

      <main className="app-main app-main--stack">
        <section className="app-pane app-pane--web">
          <WebView vendor={vendor} isActive={true} />
        </section>

        {/* 토글 바 — 패널 바로 위에 붙어있어 패널과 함께 위/아래 슬라이드 */}
        <button
          type="button"
          className={`work-bar${workOpen ? ' work-bar--open' : ''}`}
          onClick={() => setWorkOpen((o) => !o)}
          aria-expanded={workOpen}
          aria-controls="work-panel"
        >
          <span className="work-bar__label">📋 작업 패널</span>
          <span className="work-bar__chevron">{workOpen ? '▼ 닫기' : '▲ 펼치기'}</span>
        </button>

        {/* 패널 — 항상 렌더, flex-basis 트랜지션으로 슬라이드 */}
        <section
          id="work-panel"
          className={`work-panel${workOpen ? '' : ' work-panel--closed'}`}
          style={{ flexBasis: workOpen ? PANEL_HEIGHT : '0px' }}
          aria-hidden={!workOpen}
        >
          <WorkView vendor={vendor} />
        </section>
      </main>
    </div>
  );
}
