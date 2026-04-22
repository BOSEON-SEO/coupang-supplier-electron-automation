const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { registerIpcHandlers } = require('./ipc-handlers');

// 쿠팡 서플라이어 사이트 진입 URL
const COUPANG_HOME_URL = 'https://supplier.coupang.com/dashboard/KR';

// ── CDP 원격 디버깅 포트 ────────────────────────────────────
// Playwright가 connect_over_cdp()로 attach하기 위한 엔드포인트.
// 환경변수 CDP_PORT로 오버라이드 가능 (기본: 9222).
const CDP_PORT = parseInt(process.env.CDP_PORT, 10) || 9222;
app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));

// ── 경로 상수 ──────────────────────────────────────────────
const DATA_DIR = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'CoupangAutomation'
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── 메인 윈도우 + 웹 뷰 (WebContentsView) ──────────────────
let mainWindow = null;
let webView = null;          // 현재 활성 WebContentsView (벤더별)
let webViewVendor = null;    // 현재 webView가 사용 중인 vendor id
let webViewBounds = { x: 0, y: 0, width: 0, height: 0 };
let webViewVisible = false;

// ── 플러그인 서브 창 관리 (재고조정 / 운송분배 공용) ─────────
// jobKey = `${date}/${vendor}/${seq:02d}` 단위로 각 종류별 최대 1개 창.
// 어느 종류든 창이 살아있으면 그 job 은 메인창에서 편집 잠금.
const stockAdjustWindows = new Map(); // jobKey → BrowserWindow
const transportWindows = new Map();   // jobKey → BrowserWindow

function jobKeyOf(date, vendor, sequence) {
  const seq = String(sequence).padStart(2, '0');
  return `${date}/${vendor}/${seq}`;
}

function getLockedJobKeys() {
  const s = new Set();
  for (const k of stockAdjustWindows.keys()) s.add(k);
  for (const k of transportWindows.keys()) s.add(k);
  return Array.from(s);
}

/**
 * 현재 lock 상태를 jobKey → { stockAdjust?: true, transport?: true } 형태로 반환.
 * renderer 에서 어떤 종류의 플러그인 창이 열려있는지 라벨링에 활용.
 */
function getLockedJobsByType() {
  const map = {};
  for (const k of stockAdjustWindows.keys()) {
    if (!map[k]) map[k] = {};
    map[k].stockAdjust = true;
  }
  for (const k of transportWindows.keys()) {
    if (!map[k]) map[k] = {};
    map[k].transport = true;
  }
  return map;
}

function broadcastLocks() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stock-adjust:locks-changed', {
      lockedJobKeys: getLockedJobKeys(),
      locks: getLockedJobsByType(),
    });
  }
}
// 하위 호환 — 기존 호출부 유지
const broadcastStockAdjustLocks = broadcastLocks;

// 다음 다운로드를 어디에 저장할지 — ipc-handlers 의 python:run 이 args 를
// 파싱해 setPendingDownloadTarget 으로 설정하고, will-download 훅에서 소비한다.
let pendingDownloadTarget = null;
function setPendingDownloadTarget(absPath) { pendingDownloadTarget = absPath; }

// 폴더 모드 — 해당 경로가 설정돼 있는 동안의 모든 다운로드는 이 폴더에
// suggested_filename 그대로 저장된다 (여러 파일 연속 수신용, 예: 밀크런 서류 일괄).
// setPendingDownloadTarget(단일 파일) 이 우선순위 높음.
let pendingDownloadDir = null;
function setPendingDownloadDir(absDir) { pendingDownloadDir = absDir; }

/**
 * Ctrl+F 찾기 — 포커스된 webContents 의 accelerator 를 가로채서 renderer 에 알림.
 * found-in-page 결과도 renderer 로 forwarding.
 *
 *   target: 'main' | 'webview' — renderer FindBar 가 어느 contents 를 대상으로
 *           findInPage / stopFindInPage 호출할지 결정.
 */
function attachFindHandlers(wc, { target = 'main', interceptKeys = true, rendererWc = null } = {}) {
  if (!wc || wc.isDestroyed?.()) return;

  // renderer = FindBar 가 띄워진 webContents. 보통은 자기 자신(같은 창의 renderer),
  // 웹뷰일 때만 mainWindow.webContents 로 별도 지정.
  const getRenderer = () => {
    const r = rendererWc || wc;
    return r && !r.isDestroyed() ? r : null;
  };

  // 웹뷰는 자체 React 가 없어 Ctrl+F 를 가로채야 함. 일반 BrowserWindow(main·plugin)
  // 의 renderer 는 window keydown 으로 React 쪽에서 직접 받음 → interceptKeys=false.
  if (interceptKeys) {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = (input.key || '').toLowerCase();
      if (key === 'f' && (input.control || input.meta) && !input.alt && !input.shift) {
        event.preventDefault();
        const r = getRenderer();
        if (r) r.send('find:open', { target });
      }
    });
  }

  wc.on('found-in-page', (_e, result) => {
    const r = getRenderer();
    if (!r) return;
    r.send('find:result', {
      target,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    });
  });
}

/**
 * 벤더별 WebContentsView 생성/교체.
 * - partition: persist:vendor-{vendorId} 로 세션 격리
 * - 기존 webView 가 있으면 destroy 후 재생성
 * - 초기 URL: https://supplier.coupang.com/dashboard/KR (Keycloak으로 자동 redirect)
 */
function ensureWebView(vendorId) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (!vendorId) return null;
  if (webViewVendor === vendorId && webView) return webView;

  // 기존 제거
  if (webView) {
    try {
      mainWindow.contentView.removeChildView(webView);
      webView.webContents.close({ waitForBeforeUnload: false });
    } catch {
      // 이미 닫힘 — 무시
    }
    webView = null;
  }

  const wcv = new WebContentsView({
    webPreferences: {
      partition: `persist:vendor-${vendorId}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  wcv.setBackgroundColor('#ffffff');
  mainWindow.contentView.addChildView(wcv);
  wcv.setBounds(webViewVisible ? webViewBounds : { x: 0, y: 0, width: 0, height: 0 });
  wcv.webContents.loadURL(COUPANG_HOME_URL);

  // 다운로드 훅 — pendingDownloadTarget 에 지정된 경로로 자동 저장하여
  // OS 저장 대화상자를 우회한다. Python 쪽은 expect_download 를 쓰지 않고
  // 이 경로에 파일이 나타날 때까지 polling 한다 (경합 방지).
  wcv.webContents.session.on('will-download', (_event, item) => {
    // 1) 단일 파일 타겟 (po_download 등) — 한 번만 소비
    if (pendingDownloadTarget) {
      const target = pendingDownloadTarget;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        item.setSavePath(target);
        pendingDownloadTarget = null;
      } catch (err) {
        console.error('[will-download] setSavePath failed:', err.message);
      }
      return;
    }
    // 2) 폴더 모드 (밀크런/쉽먼트 서류 일괄) — 소비하지 않고 여러 파일 계속 받음
    //    파일명은 사이트가 보낸 suggested_filename 그대로 저장 (덮어쓰기)
    if (pendingDownloadDir) {
      try {
        fs.mkdirSync(pendingDownloadDir, { recursive: true });
        const suggested = item.getFilename() || `download-${Date.now()}`;
        item.setSavePath(path.join(pendingDownloadDir, suggested));
      } catch (err) {
        console.error('[will-download] dir setSavePath failed:', err.message);
      }
      return;
    }
    // 둘 다 없으면 기본 동작 (OS 대화상자)
  });

  // ── popup 인터셉트 — 폴더 모드일 때 새 창을 hidden 으로 열어 PDF 캡처 ──
  // 쿠팡 밀크런 서류 버튼은 PDF 자체가 아니라 "프린트용 HTML 페이지" 를
  // window.open 으로 띄운다. 두 단계로 동작:
  //   (a) window.open('about:blank', ...) 로 빈 창 생성
  //   (b) JS 로 콘텐츠 주입 + 자동 window.print()
  // 따라서 setWindowOpenHandler 에서 url 을 잡아 직접 loadURL 하면 (a) 단계의
  // about:blank 만 받아져서 빈 PDF 가 됨. 해결: popup 은 'allow' 하되 hidden
  // BrowserWindow 로 띄우고, did-create-window 에서 그 popup 의 webContents 가
  // 콘텐츠 navigate 후 printToPDF.  pendingDownloadDir 활성 시에만 동작.
  const PRINT_BLOCK_PRELOAD = path.join(__dirname, 'preload-printblock.js');

  wcv.webContents.setWindowOpenHandler(({ url: _url }) => {
    if (pendingDownloadDir) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          show: false,
          webPreferences: {
            session: wcv.webContents.session,
            backgroundThrottling: false,
            // popup 이 콘텐츠 주입 직후 자동 window.print() 를 호출해
            // OS 프린트 다이얼로그를 띄우는 걸 막기 위한 preload.
            preload: PRINT_BLOCK_PRELOAD,
            sandbox: false,
            // ⚠ contextIsolation=false: preload 가 사이트 JS 와 같은 world
            // 에서 동작해야 window.print 교체가 실제로 적용됨. true 면
            // preload 의 window.print 교체가 격리된 world 에만 반영돼서
            // 사이트 JS 의 window.print() 는 그대로 동작 → OS 프린트
            // 다이얼로그 발생. hidden + 사용자 입력 없는 read-only 창이라
            // 보안상 수용 가능.
            contextIsolation: false,
            nodeIntegration: false,
          },
        },
      };
    }
    return { action: 'allow' };
  });

  wcv.webContents.on('did-create-window', (childWin, _details) => {
    if (!pendingDownloadDir) return;
    const targetDir = pendingDownloadDir;

    // 방어적 override — preload 누락 케이스 대비
    childWin.webContents.on('dom-ready', () => {
      childWin.webContents.executeJavaScript(
        'try { window.print = () => {}; } catch (e) {}; void 0', true,
      ).catch(() => {});
    });

    let captured = false;
    const captureToPDF = async () => {
      if (captured || childWin.isDestroyed()) return;
      captured = true;
      let handledByEmbed = false;
      try {
        // 이미지/렌더링 안정화 대기
        await new Promise((r) => setTimeout(r, 1500));
        if (childWin.isDestroyed()) return;

        // 1) popup 이 iframe 으로 실제 콘텐츠를 감싸는 패턴 (밀크런 printPOFiles
        //    → previewPOFiles). iframe.src 자체가 application/pdf 응답을 주는
        //    endpoint 라 downloadURL 로 직접 바이너리 PDF 를 받는다.
        const iframeSrc = await childWin.webContents.executeJavaScript(
          `(() => {
            const f = document.querySelector('iframe[src]');
            return f ? f.src : '';
          })()`,
          true,
        ).catch(() => '');

        if (iframeSrc && iframeSrc !== 'about:blank') {
          handledByEmbed = true;
          // previewPOFiles 같은 endpoint 는 application/pdf 를 직접 응답.
          // Chromium 이 PDF Viewer 로 inline 표시(<embed>)하지만 우리는
          // 그걸 캡처할 수 없으므로 downloadURL 로 바이너리 PDF 를 직접 받는다.
          console.log('[popup] inner iframe (PDF endpoint):', iframeSrc);
          const sess = childWin.webContents.session;
          const onDownload = (_event, item) => {
            item.once('done', (_e, state) => {
              console.log('[popup→iframe→download] state:', state);
              sess.removeListener('will-download', onDownload);
              if (!childWin.isDestroyed()) childWin.close();
            });
          };
          sess.on('will-download', onDownload);
          try {
            childWin.webContents.downloadURL(iframeSrc);
          } catch (err) {
            console.error('[popup→iframe→download] downloadURL failed:', err.message);
            sess.removeListener('will-download', onDownload);
            if (!childWin.isDestroyed()) childWin.close();
          }
          // 안전망: 20초 뒤 강제 close
          setTimeout(() => {
            try { sess.removeListener('will-download', onDownload); } catch {}
            if (!childWin.isDestroyed()) childWin.close();
          }, 20_000);
          return;
        }

        // 2) HTML 렌더 페이지 — printToPDF
        //    printBackground:false + margins:none 로 중복/배경 이슈 최소화.
        // 사이트 자체 버그로 div#20_20173 같은 라벨 div 가 동일 outerHTML 로
        // 여러 번 그려지는 경우가 있어 dedupe 후 캡처 (예: 빨간 라벨 popup).
        try {
          const result = await childWin.webContents.executeJavaScript(`(() => {
            const targets = Array.from(document.body ? document.body.children : []);
            const seen = new Set();
            let removed = 0;
            for (const el of targets) {
              if (el.classList && el.classList.contains('pagebreak')) continue;
              const key = el.outerHTML;
              if (seen.has(key)) {
                const next = el.nextElementSibling;
                if (next && next.classList && next.classList.contains('pagebreak')) {
                  next.remove();
                }
                el.remove();
                removed += 1;
              } else {
                seen.add(key);
              }
            }
            // 마지막에 남은 trailing pagebreak 모두 제거 (빈 페이지 방지)
            let trailing = 0;
            while (true) {
              const last = document.body && document.body.lastElementChild;
              if (!last) break;
              if (last.classList && last.classList.contains('pagebreak')) {
                last.remove();
                trailing += 1;
              } else { break; }
            }
            // 마지막 element 의 page-break-after CSS 도 제거
            const last = document.body && document.body.lastElementChild;
            if (last) {
              last.style.pageBreakAfter = 'avoid';
              last.style.breakAfter = 'avoid';
            }
            return { removed, trailing };
          })()`, true);
          if (result.removed > 0 || result.trailing > 0) {
            console.log('[popup dedupe] removed', result.removed,
                        'duplicates, trimmed', result.trailing, 'trailing pagebreaks');
            await new Promise((r) => setTimeout(r, 200));
          }
        } catch (e) { console.log('[popup dedupe] failed:', e.message); }

        const title = await childWin.webContents
          .executeJavaScript('document.title || ""', true)
          .catch(() => '');
        const pdfBuffer = await childWin.webContents.printToPDF({
          printBackground: false,
          pageSize: 'A4',
          margins: { marginType: 'none' },
          preferCSSPageSize: true,
        });
        let baseName = (title || '').trim();
        if (!baseName) {
          try {
            const u = new URL(childWin.webContents.getURL());
            const seq = u.searchParams.get('milkrunSeq')
              || u.searchParams.get('milkrun-seq')
              || u.searchParams.get('purchaseOrderSeq')
              || '';
            baseName = seq ? `milkrun_${seq}` : `print_${Date.now()}`;
          } catch { baseName = `print_${Date.now()}`; }
        }
        baseName = baseName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
        const fileName = baseName.toLowerCase().endsWith('.pdf')
          ? baseName : `${baseName}.pdf`;
        fs.mkdirSync(targetDir, { recursive: true });
        const fp = path.join(targetDir, fileName);
        fs.writeFileSync(fp, pdfBuffer);
        console.log('[popup→printToPDF] saved:', fp, `(${pdfBuffer.length} bytes)`);
      } catch (err) {
        console.error('[popup→printToPDF] failed:', err.message);
      } finally {
        // embed 분기에서는 will-download 'done' 핸들러가 close 담당 — 여기선 skip
        if (!handledByEmbed && !childWin.isDestroyed()) childWin.close();
      }
    };

    // about:blank 단계는 무시하고 실제 콘텐츠가 로드되면 캡처
    childWin.webContents.on('did-finish-load', () => {
      const cur = childWin.webContents.getURL();
      if (cur === 'about:blank' || cur === '') return;
      captureToPDF();
    });

    // about:blank 인 채로 JS 로만 콘텐츠가 주입되는 경우 폴백 — 일정 시간 후 강제 캡처
    setTimeout(() => { captureToPDF(); }, 5000);

    childWin.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
      // -3 은 ERR_ABORTED — 보통 navigate 전환이라 무시해도 됨
      if (errorCode === -3) return;
      console.error('[popup→printToPDF] did-fail-load:', errorCode, errorDesc);
      if (!childWin.isDestroyed()) childWin.close();
    });
  });

  // URL 변경 이벤트를 Renderer 의 주소창에 전달
  const notifyUrl = (url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('webview:url-changed', { url });
    }
  };
  wcv.webContents.on('did-navigate', (_e, url) => notifyUrl(url));
  wcv.webContents.on('did-navigate-in-page', (_e, url) => notifyUrl(url));
  wcv.webContents.on('did-finish-load', () => notifyUrl(wcv.webContents.getURL()));

  // 웹뷰는 renderer 가 없어 Ctrl+F intercept 필수. 이벤트는 mainWindow renderer 에 전달.
  attachFindHandlers(wcv.webContents, {
    target: 'webview',
    interceptKeys: true,
    rendererWc: mainWindow?.webContents,
  });

  webView = wcv;
  webViewVendor = vendorId;
  return wcv;
}

function applyWebViewBounds() {
  if (!webView) return;
  webView.setBounds(webViewVisible ? webViewBounds : { x: 0, y: 0, width: 0, height: 0 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Python subprocess IPC에 필요
    },
    title: '쿠팡 서플라이어 자동화',
  });

  const isDev = !app.isPackaged && !process.env.ELECTRON_LOAD_DIST;
  if (isDev) {
    const http = require('http');
    const devUrl = 'http://localhost:3000';
    const checkDevServer = () => new Promise((resolve) => {
      const req = http.get(devUrl, () => resolve(true));
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    checkDevServer().then((isRunning) => {
      if (isRunning) {
        mainWindow.loadURL(devUrl);
      } else {
        mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // main 쪽은 intercept 하지 않음 — renderer 가 window keydown 으로 직접 받아
  // 스프레드시트(canvas) 포커스면 FortuneSheet 네이티브, 아니면 FindBar 열기로 분기.
  attachFindHandlers(mainWindow.webContents, { target: 'main', interceptKeys: false });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 플러그인 BrowserWindow 생성 (같은 번들을 hash 라우팅으로 재사용).
 * kind: 'stock-adjust' | 'transport'
 * 같은 kind + 같은 jobKey 이면 기존 창을 focus.
 */
function openPluginWindow(kind, { date, vendor, sequence }) {
  const map = kind === 'transport' ? transportWindows : stockAdjustWindows;
  const titlePrefix = kind === 'transport' ? '운송 분배' : '재고조정';
  const key = jobKeyOf(date, vendor, sequence);
  const existing = map.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    parent: mainWindow || undefined,
    modal: false,
    title: `${titlePrefix} · ${vendor} · ${date} · ${sequence}차`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const hash = `#/${kind}?date=${encodeURIComponent(date)}&vendor=${encodeURIComponent(vendor)}&sequence=${sequence}`;
  const isDev = !app.isPackaged && !process.env.ELECTRON_LOAD_DIST;
  if (isDev) {
    win.loadURL(`http://localhost:3000/${hash}`);
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'), { hash: hash.slice(1) });
  }

  // 플러그인 창도 find: 지원 — renderer 가 keydown 을 직접 받아 처리.
  attachFindHandlers(win.webContents, { target: 'main', interceptKeys: false });

  map.set(key, win);
  broadcastLocks();

  win.on('closed', () => {
    if (map.get(key) === win) map.delete(key);
    broadcastLocks();
  });

  return win;
}

// 기존 호출부 호환 — 재고조정 전용 wrapper
function openStockAdjustWindow(opts) {
  return openPluginWindow('stock-adjust', opts);
}
function openTransportWindow(opts) {
  return openPluginWindow('transport', opts);
}

app.whenReady().then(() => {
  registerIpcHandlers({
    ipcMain,
    getWindow: () => mainWindow,
    dataDir: DATA_DIR,
    cdpPort: CDP_PORT,
    setPendingDownloadTarget,
    setPendingDownloadDir,
    openStockAdjustWindow,
    openTransportWindow,
    isJobLocked: (date, vendor, seq) => {
      const k = jobKeyOf(date, vendor, seq);
      return stockAdjustWindows.has(k) || transportWindows.has(k);
    },
    getLockedJobKeys,
    getLockedJobsByType,
    closeStockAdjustWindow: (date, vendor, seq) => {
      const key = jobKeyOf(date, vendor, seq);
      const w = stockAdjustWindows.get(key);
      if (w && !w.isDestroyed()) w.close();
    },
  });

  // ── WebContentsView 제어 IPC ────────────────────────────
  ipcMain.handle('webview:setVendor', (_e, vendorId) => {
    const v = ensureWebView(vendorId);
    return { success: !!v };
  });

  ipcMain.handle('webview:setBounds', (_e, bounds) => {
    if (
      !bounds ||
      typeof bounds.x !== 'number' ||
      typeof bounds.y !== 'number' ||
      typeof bounds.width !== 'number' ||
      typeof bounds.height !== 'number'
    ) {
      return { success: false, error: 'invalid bounds' };
    }
    webViewBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
    applyWebViewBounds();
    return { success: true };
  });

  ipcMain.handle('webview:setVisible', (_e, visible) => {
    webViewVisible = !!visible;
    applyWebViewBounds();
    return { success: true };
  });

  ipcMain.handle('webview:navigate', (_e, url) => {
    if (!webView) return { success: false, error: 'no webview' };
    let target = String(url || '').trim();
    if (!target) return { success: false, error: 'empty url' };

    if (!/^[a-zA-Z]+:\/\//.test(target)) {
      // 스킴 없음 → 도메인-like 면 https:// 보정, 아니면 구글 검색
      const looksLikeDomain = /^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(target) || /^localhost(:\d+)?(\/.*)?$/i.test(target);
      if (looksLikeDomain) {
        target = 'https://' + target;
      } else {
        target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
    }
    webView.webContents.loadURL(target);
    return { success: true, url: target };
  });

  ipcMain.handle('webview:reload', () => {
    if (!webView) return { success: false, error: 'no webview' };
    webView.webContents.reload();
    return { success: true };
  });

  ipcMain.handle('webview:getUrl', () => {
    if (!webView) return { url: null };
    return { url: webView.webContents.getURL() };
  });

  // ── 찾기 (Ctrl+F) ──
  //   target === 'webview' → WebContentsView(쿠팡) 대상
  //   그 외 → event.sender (요청을 보낸 창의 renderer webContents 그대로)
  const resolveFindTarget = (event, target) => {
    if (target === 'webview') {
      return (webView && !webView.webContents.isDestroyed())
        ? webView.webContents : null;
    }
    return event.sender && !event.sender.isDestroyed() ? event.sender : null;
  };

  ipcMain.handle('find:query', async (event, payload) => {
    const { target, text, options } = payload || {};
    const wc = resolveFindTarget(event, target);
    if (!wc) return { success: false, error: 'no webContents' };
    if (!text) {
      wc.stopFindInPage('clearSelection');
      return { success: true, matches: 0 };
    }
    wc.findInPage(String(text), options || {});
    return { success: true };
  });

  ipcMain.handle('find:close', async (event, payload) => {
    const wc = resolveFindTarget(event, payload?.target);
    if (!wc) return { success: false };
    wc.stopFindInPage('clearSelection');
    return { success: true };
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
