/**
 * hello 플러그인 — 플러그인 시스템 smoke test 용.
 *
 * 역할:
 *   - settings.section scope 에 "플러그인 상태" 버튼 추가
 *   - job.created 훅 핸들러 → 콘솔에 작업 메타 찍음 (훅 동작 증명)
 *   - 아무 entitlement 요구 없음 → 항상 로드
 *
 * 실제 배포에서는 이 플러그인이 기본 비활성화되게 조정할 예정.
 */

import { __internal } from '../../core/plugin-registry';
import { KNOWN_HOOKS } from '../../core/plugin-api';

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'hello',
  name: 'Hello (dev)',
  version: '0.1.0',
  // entitlement 없음 — 모든 환경에서 로드

  activate(ctx) {
    const disposables = [];

    disposables.push(
      ctx.registerCommand({
        id: 'hello.status',
        title: '플러그인 상태',
        icon: '🔌',
        scope: 'settings.section',
        order: 999,
        variant: 'secondary',
        handler: () => {
          const counts = __internal.counts();
          alert(
            `[플러그인 시스템]\n` +
            `- 로드된 플러그인: ${counts.plugins}\n` +
            `- 등록된 커맨드: ${counts.commands}\n` +
            `- 등록된 뷰: ${counts.views}\n` +
            `- 등록된 훅: ${counts.hooks}\n` +
            `- 등록된 phase: ${counts.phases}\n\n` +
            `벤더: ${ctx.currentVendor || '(미선택)'}\n` +
            `entitlements: [${ctx.entitlements.join(', ') || '(비어있음)'}]`,
          );
        },
      }),
    );

    // job.created 훅 — 라이프사이클 훅이므로 next() 호출해 체인 계속.
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
