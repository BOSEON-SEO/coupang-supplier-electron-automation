/**
 * Popup 창 전용 preload — window.print 를 첫 JS 실행 이전에 무력화.
 *
 * 쿠팡 밀크런 서류 popup 은 콘텐츠 주입 직후 자동 window.print() 를 호출해
 * OS 프린트 다이얼로그를 띄운다. dom-ready 이벤트에서 override 하면 이미
 * 늦어서 다이얼로그가 먼저 뜸 → 이 preload 가 가장 이른 시점에 window.print
 * 를 no-op 으로 고정.
 *
 * setWindowOpenHandler 의 overrideBrowserWindowOptions.webPreferences.preload
 * 로 연결되며, 이후 main 측이 printToPDF 로 직접 PDF 를 생성한다.
 */

// 정상 실행 — Object.defineProperty 로 재할당 차단까지
try {
  Object.defineProperty(window, 'print', {
    value: () => {},
    writable: false,
    configurable: false,
  });
} catch {
  // 실패해도 최소한 덮어쓰기는 시도
  try { window.print = () => {}; } catch {}
}

// 자식 프레임/iframe 에서도 같이 차단
try {
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName, options) {
    const el = origCreateElement(tagName, options);
    if (tagName && tagName.toLowerCase() === 'iframe') {
      // iframe load 시 contentWindow.print 도 막음
      el.addEventListener('load', () => {
        try {
          if (el.contentWindow) el.contentWindow.print = () => {};
        } catch {}
      });
    }
    return el;
  };
} catch {}
