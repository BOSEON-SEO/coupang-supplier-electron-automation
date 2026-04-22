/**
 * 플러그인 부트스트래퍼 — 명시적 레지스트리(src/plugins/index.js) 의 manifest 를
 * entitlements 필터링 후 순차 로드.
 *
 * Webpack 환경 호환 (Vite import.meta.glob 미사용).
 */

import { loadPlugin, unloadAllPlugins } from './plugin-registry';
import { MANIFESTS } from '../plugins';

export function collectManifests() {
  return MANIFESTS.filter((m) => m && m.id);
}

/**
 * 모든 manifest 를 entitlements 필터링 후 순차 로드.
 *
 * @param {{ entitlements: string[], currentVendor: string|null, electronAPI: any }} runtime
 * @returns {string[]}  실제로 로드된 플러그인 id 목록
 */
export function bootstrapPlugins(runtime) {
  unloadAllPlugins();
  const loaded = [];
  for (const manifest of collectManifests()) {
    try {
      const dispose = loadPlugin(manifest, runtime);
      if (dispose) loaded.push(manifest.id);
    } catch (err) {
      console.error(`[plugin-loader] failed to load '${manifest.id}'`, err);
    }
  }
  // eslint-disable-next-line no-console
  console.info(`[plugin-loader] loaded: [${loaded.join(', ')}]`);
  return loaded;
}
