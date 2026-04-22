/**
 * hello 플러그인 — 플러그인 시스템 smoke test 용.
 *
 * 역할:
 *   - job.created 훅 핸들러 → 콘솔에 작업 메타 찍음 (라이프사이클 훅 동작 증명)
 *   - 아무 entitlement 요구 없음 → 항상 로드
 *
 * 과거에 settings.section scope 에 "플러그인 상태" 버튼을 등록했었는데,
 * 해당 기능은 사이드바의 🔌 플러그인 메뉴(PluginsView) 로 이전됨.
 */

import { KNOWN_HOOKS } from '../../core/plugin-api';

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'hello',
  name: 'Hello (dev)',
  version: '0.1.0',
  // entitlement 없음 — 모든 환경에서 로드

  activate(ctx) {
    const disposables = [];

    // job.created 훅 — 라이프사이클이므로 next() 호출해 체인 계속.
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.JOB_CREATED, (payload, hookCtx, next) => {
        // eslint-disable-next-line no-console
        console.log('[hello] job.created:', {
          vendor: payload?.job?.vendor,
          date: payload?.job?.date,
          sequence: payload?.job?.sequence,
        });
        return next();
      }),
    );

    return () => { disposables.forEach((d) => d()); };
  },
};

export default manifest;
