import React from 'react';

/**
 * 웹 뷰 탭
 * - Phase 1에서는 플레이스홀더
 * - 추후 BrowserView를 Electron Main에서 attach하여
 *   Playwright 동작을 실시간으로 보여주는 영역
 */
export default function WebView() {
  return (
    <div className="webview-container">
      <div className="webview-placeholder">
        <p className="placeholder-text">
          🌐 웹 뷰 영역
        </p>
        <p className="placeholder-sub">
          Playwright 자동화 동작이 이 영역에서 실시간으로 표시됩니다.
        </p>
        <p className="placeholder-sub">
          위험 동작(적용 버튼 등)은 3초 카운트다운 후 실행됩니다.
        </p>
      </div>
    </div>
  );
}
