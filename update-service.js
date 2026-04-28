/**
 * 자동 업데이트 — electron-updater 래퍼.
 *
 * 배포 채널: Supabase Storage 의 public bucket `releases/` (generic provider).
 * 빌드 시 electron-builder 가 다음을 산출:
 *   - 쿠팡 서플라이어 자동화 Setup x.x.x.exe
 *   - latest.yml  (버전·sha512·releaseNotes 포함)
 * 두 파일을 `releases/` 버킷에 업로드하면 클라이언트가 자동으로 감지·다운로드.
 *
 * 흐름:
 *   1) app ready 후 5초 뒤 checkForUpdates (네트워크 안정화 대기)
 *   2) update-available → renderer 에 status='available' + releaseNotes 송신
 *   3) renderer 가 사용자 동의 후 update:download 호출
 *   4) download-progress → status='downloading' 로 진행률 송신
 *   5) update-downloaded → status='downloaded'
 *   6) renderer 가 update:install 호출 → quitAndInstall (NSIS 가 재시작)
 *
 * dev 모드(app.isPackaged=false)는 autoUpdater 가 동작하지 않음 — 자연스레 noop.
 */

const { app, BrowserWindow } = require('electron');

let registered = false;
let lastStatus = { state: 'idle' };

function registerUpdateIpc({ ipcMain, broadcast }) {
  if (registered) return;
  registered = true;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('[update] electron-updater 미설치 — auto-update 비활성', err.message);
    ipcMain.handle('update:get', () => ({ state: 'unavailable' }));
    ipcMain.handle('update:check', () => ({ success: false, error: 'unavailable' }));
    ipcMain.handle('update:download', () => ({ success: false, error: 'unavailable' }));
    ipcMain.handle('update:install', () => ({ success: false, error: 'unavailable' }));
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info:  (m) => console.log('[update]', m),
    warn:  (m) => console.warn('[update]', m),
    error: (m) => console.error('[update]', m),
    debug: () => {},
  };

  const setStatus = (next) => {
    lastStatus = { ...lastStatus, ...next, ts: Date.now() };
    if (typeof broadcast === 'function') broadcast('update:status', lastStatus);
  };

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    setStatus({
      state: 'available',
      version: info?.version || null,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : '',
      releaseDate: info?.releaseDate || null,
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    setStatus({ state: 'up-to-date', version: info?.version || app.getVersion() });
  });
  autoUpdater.on('error', (err) => {
    setStatus({ state: 'error', error: String(err?.message || err) });
  });
  autoUpdater.on('download-progress', (p) => {
    setStatus({
      state: 'downloading',
      percent: Math.round(p?.percent || 0),
      bytesPerSecond: p?.bytesPerSecond || 0,
      transferred: p?.transferred || 0,
      total: p?.total || 0,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'downloaded', version: info?.version || null });
  });

  ipcMain.handle('update:get', () => lastStatus);

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      setStatus({ state: 'dev', message: '개발 모드에서는 자동 업데이트 비활성' });
      return { success: false, error: 'dev mode' };
    }
    try {
      const r = await autoUpdater.checkForUpdates();
      return { success: true, version: r?.updateInfo?.version || null };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) return { success: false, error: 'dev mode' };
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) return { success: false, error: 'dev mode' };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { success: true };
  });

  // 부팅 후 5초 뒤 자동 체크 (패키징된 경우만)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[update] initial check failed:', err.message);
      });
    }, 5000);
  } else {
    setStatus({ state: 'dev', message: '개발 모드' });
  }
}

module.exports = { registerUpdateIpc };
