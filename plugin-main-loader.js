/**
 * 플러그인 메인 프로세스 half 로더.
 *
 * 각 플러그인은 별도 npm 패키지 (private git repo) 로 분리되어 있고,
 * 패키지 root 의 `src/main.js` 가 main process 진입점.
 * renderer half (`src/index.js`) 는 webpack 으로 묶이고, main half 는 Node 가
 * 직접 require — 번들링 대상이 아니라 패키징 시 node_modules 째 asar 에 들어감.
 *
 * 각 플러그인은 `ipcMain.handle('plugin:<id>:<channel>', handler)` 형태로 IPC 를
 * 등록. 채널 네임스페이스는 pluginId 프리픽스로 분리해 충돌 방지.
 *
 * preload 의 invokePluginChannel(pluginId, channel, ...args) 가 이쪽으로 포워딩.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

// 별도 repo 로 분리된 플러그인 패키지 화이트리스트.
// flavor 에 따라 npm install 단계에서 일부만 설치될 수 있고, require.resolve
// 가 실패하면 자동 skip — 비구매자 빌드에는 해당 패키지가 없음.
// 새 플러그인 패키지 추가 시 prepare-flavor.js 의 FLAVORS 맵과 함께 갱신.
const KNOWN_PLUGIN_PACKAGES = [
  'coupang-supplier-plugin-tbnws',
  // 'coupang-supplier-plugin-acme',
];

/**
 * @param {{ ipcMain: import('electron').IpcMain, app: import('electron').App, dataDir: string }} opts
 * @returns {{ loaded: string[], dispose: () => void }}
 */
function loadPluginMainHalves({ ipcMain, app, dataDir }) {
  const loaded = [];
  const disposers = [];
  const userDataPath = app.getPath('userData');

  // 패키지별로 main.js 위치를 해석. 미설치는 skip.
  const candidates = [];
  for (const pkgName of KNOWN_PLUGIN_PACKAGES) {
    let mainPath;
    try {
      const pkgJson = require.resolve(`${pkgName}/package.json`);
      mainPath = path.join(path.dirname(pkgJson), 'src', 'main.js');
    } catch (_) {
      continue; // 이 flavor 에 미포함
    }
    if (!fs.existsSync(mainPath)) continue;
    candidates.push({ pkgName, mainPath });
  }

  for (const { pkgName, mainPath } of candidates) {
    let mod;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      mod = require(mainPath);
    } catch (err) {
      console.error(`[plugin-main '${pkgName}'] require failed`, err);
      continue;
    }
    const manifest = mod && (mod.default || mod);
    if (!manifest || typeof manifest.activate !== 'function') {
      console.warn(`[plugin-main '${pkgName}'] no default export or activate(); skipping`);
      continue;
    }
    const pluginId = manifest.id;
    if (!pluginId || !PLUGIN_ID_RE.test(pluginId)) {
      console.warn(`[plugin-main '${pkgName}'] invalid manifest.id='${pluginId}'; skipping`);
      continue;
    }

    const handlerChannels = [];
    const registrar = {
      pluginId,
      userDataPath,
      dataDir,
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
