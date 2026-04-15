const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { registerIpcHandlers } = require('./ipc-handlers');

// 쿠팡 서플라이어 사이트 진입 URL
const COUPANG_HOME_URL = 'https://supplier.coupang.com';

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

/**
 * 벤더별 WebContentsView 생성/교체.
 * - partition: persist:vendor-{vendorId} 로 세션 격리
 * - 기존 webView 가 있으면 destroy 후 재생성
 * - 초기 URL: https://supplier.coupang.com (Keycloak으로 자동 redirect)
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

  // 다운로드 발생 시 OS 저장 대화상자 / Chromium 다운로드 바 등장을 막는다.
  // 임시 디렉토리로 자동 저장 — Playwright 가 expect_download + download.save_as 로
  // 최종 위치(데이터 폴더)로 옮겨 적기 때문에 여기서는 임시 경로면 충분하다.
  wcv.webContents.session.on('will-download', (_event, item) => {
    try {
      const filename = item.getFilename() || `download-${Date.now()}`;
      const tmpPath = path.join(os.tmpdir(), `coupang-wcv-${Date.now()}-${filename}`);
      item.setSavePath(tmpPath);
    } catch {
      // setSavePath 실패 — 무시 (Playwright 가 CDP 로 별도 처리 가능)
    }
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
        mainWindow.webContents.openDevTools({ mode: 'bottom' });
      } else {
        mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers({
    ipcMain,
    getWindow: () => mainWindow,
    dataDir: DATA_DIR,
    cdpPort: CDP_PORT,
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
