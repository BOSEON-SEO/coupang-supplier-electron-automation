/**
 * 플러그인 명시적 레지스트리.
 *
 * Webpack 환경에서는 Vite 의 import.meta.glob 이 동작하지 않으므로,
 * 모든 플러그인 manifest 를 여기에 import 해서 배열로 export.
 *
 * 새 플러그인 추가 시:
 *   1. src/plugins/<id>/index.js 작성
 *   2. 여기 import + MANIFESTS 배열에 추가
 */

import helloManifest from './hello';

/** @type {import('../core/plugin-api').PluginManifest[]} */
export const MANIFESTS = [
  helloManifest,
];
