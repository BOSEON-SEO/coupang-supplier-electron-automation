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

function broadcastLocks() {
  const keys = getLockedJobKeys();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stock-adjust:locks-changed', { lockedJobKeys: keys });
  }
}
// 하위 호환 — 기존 호출부 유지
const broadcastStockAdjustLocks = broadcastLocks;

// 다음 다운로드를 어디에 저장할지 — ipc-handlers 의 python:run 이 args 를
// 파싱해 setPendingDownloadTarget 으로 설정하고, will-download 훅에서 소비한다.
let pendingDownloadTarget = null;
function setPendingDownloadTarget(absPath) { pendingDownloadTarget = absPath; }

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
    const target = pendingDownloadTarget;
    if (!target) return; // 타겟 없으면 기본 동작 (OS 대화상자)
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      item.setSavePath(target);
      pendingDownloadTarget = null; // 한 번만 소비
    } catch (err) {
      console.error('[will-download] setSavePath failed:', err.message);
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
    openStockAdjustWindow,
    openTransportWindow,
    isJobLocked: (date, vendor, seq) => {
      const k = jobKeyOf(date, vendor, seq);
      return stockAdjustWindows.has(k) || transportWindows.has(k);
    },
    getLockedJobKeys,
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
