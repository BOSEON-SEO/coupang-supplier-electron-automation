const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── 경로 상수 ──────────────────────────────────────────────
const DATA_DIR = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'CoupangAutomation'
);
const VENDORS_PATH = path.join(DATA_DIR, 'vendors.json');

// 데이터 디렉토리 보장
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

  // 개발 모드: webpack-dev-server / 프로덕션: 빌드된 파일
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── IPC 핸들러: 벤더 관리 ──────────────────────────────────
ipcMain.handle('vendors:load', async () => {
  try {
    if (!fs.existsSync(VENDORS_PATH)) {
      const defaults = { schemaVersion: 1, vendors: [] };
      fs.writeFileSync(VENDORS_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
      return defaults;
    }
    const raw = fs.readFileSync(VENDORS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { schemaVersion: 1, vendors: [], error: err.message };
  }
});

ipcMain.handle('vendors:save', async (_event, data) => {
  try {
    fs.writeFileSync(VENDORS_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC 핸들러: 파일 I/O ──────────────────────────────────
ipcMain.handle('file:getDataDir', async () => DATA_DIR);

ipcMain.handle('file:exists', async (_event, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('file:read', async (_event, filePath) => {
  try {
    return { data: fs.readFileSync(filePath), success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:write', async (_event, filePath, buffer) => {
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC 핸들러: Python subprocess (Phase 1 스텁) ──────────
ipcMain.handle('python:run', async (_event, scriptName, args) => {
  // TODO: Phase 1에서 child_process.spawn으로 Python 스크립트 실행
  // stdout/stderr를 renderer로 스트리밍
  return { success: false, error: 'Python bridge not yet implemented' };
});

// ── IPC 핸들러: 위험 동작 카운트다운 확인 ──────────────────
ipcMain.handle('action:confirmDangerous', async (_event, actionName) => {
  // Renderer에서 3초 카운트다운 UI를 표시하고 결과를 반환
  // 여기서는 Renderer → Main 확인 흐름의 엔드포인트
  mainWindow?.webContents.send('action:countdown', { actionName });
  return { acknowledged: true };
});
