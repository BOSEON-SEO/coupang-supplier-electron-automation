/**
 * 플러그인 메인 프로세스 half 로더.
 *
 * renderer 측 플러그인은 src/plugins/<id>/index.js (webpack 번들).
 * main 측 플러그인은 src/plugins/<id>/main.js (Node 직접 require, 번들 미대상).
 *
 * 각 플러그인은 `ipcMain.handle('plugin:<id>:<channel>', handler)` 형태로 IPC 를
 * 등록. 채널 네임스페이스는 pluginId 프리픽스로 분리해 충돌 방지.
 *
 * preload 의 invokePluginChannel(pluginId, channel, ...args) 가 이쪽으로 포워딩.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

/**
 * @param {{ ipcMain: import('electron').IpcMain, app: import('electron').App, dataDir: string }} opts
 * @returns {{ loaded: string[], dispose: () => void }}
 */
function loadPluginMainHalves({ ipcMain, app, dataDir }) {
  const pluginsDir = path.join(__dirname, 'src', 'plugins');
  const loaded = [];
  const disposers = [];

  if (!fs.existsSync(pluginsDir)) {
    return { loaded, dispose: () => {} };
  }

  const userDataPath = app.getPath('userData');

  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!PLUGIN_ID_RE.test(entry.name)) continue;

    const mainPath = path.join(pluginsDir, entry.name, 'main.js');
    if (!fs.existsSync(mainPath)) continue;

    const pluginId = entry.name;
    const handlerChannels = [];
    const registrar = {
      pluginId,
      userDataPath,   // Electron 기본 userData — 앱 세션/쿠키 등
      dataDir,        // 프로젝트 데이터 루트 — settings.json / 작업 폴더 저장소
      /**
       * @param {string} channel  'eflexs.submit' 형태. 'plugin:<id>:' 프리픽스 자동 부여.
       * @param {(event: any, ...args: any[]) => any} handler
       * @returns {() => void}
       */
      handle(channel, handler) {
        if (typeof channel !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,59}$/i.test(channel)) {
          throw new Error(`[plugin-main '${pluginId}'] invalid channel: ${channel}`);
        }
        const full = `plugin:${pluginId}:${channel}`;
        ipcMain.handle(full, handler);
        handlerChannels.push(full);
        return () => {
          try { ipcMain.removeHandler(full); } catch {}
        };
      },
    };

    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(mainPath);
      const manifest = mod && (mod.default || mod);
      if (!manifest || typeof manifest.activate !== 'function') {
        console.warn(`[plugin-main '${pluginId}'] no default export or activate(); skipping`);
        continue;
      }
      if (manifest.id && manifest.id !== pluginId) {
        console.warn(`[plugin-main '${pluginId}'] manifest.id='${manifest.id}' mismatches folder; using folder name`);
      }
      const userDispose = manifest.activate(registrar);
      disposers.push(() => {
        try { if (typeof userDispose === 'function') userDispose(); } catch (err) {
          console.error(`[plugin-main '${pluginId}'] user dispose threw`, err);
        }
        for (const ch of handlerChannels) {
          try { ipcMain.removeHandler(ch); } catch {}
        }
      });
      loaded.push(pluginId);
    } catch (err) {
      console.error(`[plugin-main '${pluginId}'] activate failed`, err);
    }
  }

  // eslint-disable-next-line no-console
  console.info(`[plugin-main] loaded: [${loaded.join(', ')}]`);

  return {
    loaded,
    dispose() {
      for (const d of disposers) {
        try { d(); } catch {}
      }
    },
  };
}

module.exports = { loadPluginMainHalves };
