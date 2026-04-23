/**
 * 플러그인 부트스트래퍼 — 명시적 레지스트리(src/plugins/index.js) 의 manifest 를
 * entitlements + 사용자 개별 on/off 로 필터링해 로드.
 *
 * Webpack 환경 호환 (Vite import.meta.glob 미사용).
 */

import { loadPlugin, unloadAllPlugins } from './plugin-registry';
import { MANIFESTS } from '../plugins';

export function collectManifests() {
  return MANIFESTS.filter((m) => m && m.id);
}

/**
 * 모든 설치된 플러그인 manifest 메타 조회 (UI 용).
 * loadPlugin 여부와 관계 없이 src/plugins/ 에 등록된 것 모두 반환.
 */
export function listInstalledManifests() {
  return collectManifests().map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    entitlement: m.entitlement || null,
    hasSettings: Array.isArray(m.settingsSchema) && m.settingsSchema.length > 0,
  }));
}

/**
 * @param {{
 *   entitlements: string[],
 *   currentVendor: string|null,
 *   electronAPI: any,
 *   perPluginEnabled?: Record<string, boolean>  // 사용자 설정의 plugins.<id>.enabled. 없으면 기본 true.
 * }} runtime
 * @returns {{ loaded: string[], skipped: Array<{id: string, reason: 'entitlement' | 'user-disabled' | 'error'}> }}
 */
export function bootstrapPlugins(runtime) {
  unloadAllPlugins();
  const loaded = [];
  const skipped = [];
  const perEnabled = runtime.perPluginEnabled || {};
  for (const manifest of collectManifests()) {
    // 사용자 개별 토글 (기본 true — 명시적으로 false 일 때만 skip)
    if (perEnabled[manifest.id] === false) {
      skipped.push({ id: manifest.id, reason: 'user-disabled' });
      continue;
    }
    try {
      const dispose = loadPlugin(manifest, runtime);
      if (dispose) {
        loaded.push(manifest.id);
      } else {
        // entitlement 부족 또는 중복 → dispose null
        skipped.push({ id: manifest.id, reason: 'entitlement' });
      }
    } catch (err) {
      console.error(`[plugin-loader] failed to load '${manifest.id}'`, err);
      skipped.push({ id: manifest.id, reason: 'error' });
    }
  }
  // eslint-disable-next-line no-console
  console.info(`[plugin-loader] loaded: [${loaded.join(', ')}] skipped: ${skipped.length}`);
  return { loaded, skipped };
}
