const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { registerIpcHandlers } = require('./ipc-handlers');

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

// ── 메인 윈도우 ────────────────────────────────────────────
let mainWindow = null;

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
