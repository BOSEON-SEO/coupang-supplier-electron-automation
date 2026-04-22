/**
 * TBNWS 플러그인 — 투비네트웍스 전용 커스터마이즈.
 *
 * 계획된 기능:
 *   1. ✅ po.postprocess: 원본 PO 에 자사 컬럼 추가 (스텁 — URL 확정 후 채움)
 *   2. 재고조정 자동 채움 (stock-adjust.autofill)
 *   3. 제품 그룹핑 (product.group-key)
 *   4. 재고 반영 phase (registerPhase)
 *   5. job.completed 라이프사이클 (커스텀 파일 생성)
 *
 * 백엔드 HTTP 는 main-half(main.js) 에서 처리. renderer 는 ctx.ipcInvoke 로 호출.
 */

import { KNOWN_SCOPES, KNOWN_HOOKS } from '../../core/plugin-api';

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'tbnws',
  name: 'TBNWS',
  version: '0.1.0',
  entitlement: 'tbnws.plugin',

  settingsSchema: [
    {
      key: 'apiBaseUrl',
      label: 'API Base URL',
      type: 'url',
      placeholder: 'https://tbnws-admin.internal/api',
      description: 'TBNWS 사내 관리 백엔드 주소. 예) http://10.0.0.5:8080',
    },
    {
      key: 'apiToken',
      label: 'API 인증 토큰',
      type: 'password',
      description: 'Bearer 토큰 또는 세션 쿠키 값. 백엔드 관리자에게 문의.',
    },
    {
      key: 'category',
      label: '벤더 카테고리',
      type: 'text',
      placeholder: 'BASIC 또는 CANON',
      description: '쿠팡 발주서 검증 시 백엔드로 전달되는 벤더 구분값.',
    },
  ],

  activate(ctx) {
    const disposables = [];

    // 스모크 테스트용 — work.toolbar 에 플러그인 식별 버튼.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.menu',
        title: 'TBNWS',
        icon: '🏢',
        scope: KNOWN_SCOPES.WORK_TOOLBAR,
        order: 50,
        variant: 'secondary',
        handler: (args) => {
          alert(
            `[TBNWS 플러그인]\n` +
            `- 작업: ${args?.job ? `${args.job.vendor}/${args.job.sequence}차` : '(없음)'}\n` +
            `- 탭: ${args?.activeTab || '-'}\n\n` +
            `5개 기능 구현 예정 — 스켈레톤 상태.`,
          );
        },
      }),
    );

    /**
     * po.postprocess 훅 — PO 원본을 받아 자사 컬럼 추가된 workbook 생성.
     *
     * payload: { buffer: ArrayBuffer, fileName: string, job: object }
     * 반환: { buffer: ArrayBuffer, fileName: string } — 변환된 새 파일
     *
     * 현재는 스텁: apiBaseUrl 미설정이면 원본 그대로 통과(next 호출).
     * URL 확정 후 coupangCheckForm API 호출 → 응답 파싱 → 컬럼 추가 로직 구현.
     */
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.PO_POSTPROCESS, async (payload, hookCtx, next) => {
        try {
          const res = await ctx.ipcInvoke('po.checkForm', {
            fileName: payload?.fileName,
            fileBuffer: payload?.buffer,
            // category 는 main.js 가 설정에서 읽어옴 (override 필요 시 여기서 전달)
          });
          if (!res?.success) {
            console.warn('[tbnws] po.checkForm 실패:', res?.error);
            return next();  // 실패 시 원본 체인 계속
          }
          // TODO: res.data (SKU 배열 + 재고 정보) 를 원본 workbook 에 컬럼 추가
          // 현재는 데이터만 로그 — 실제 엑셀 변환은 다음 단계에서.
          console.info('[tbnws] coupangCheckForm 응답 수신:', {
            rowCount: Array.isArray(res.data) ? res.data.length : 'n/a',
            sample: Array.isArray(res.data) ? res.data[0] : res.data,
          });
          return next();
        } catch (err) {
          console.error('[tbnws] po.postprocess 실패', err);
          return next();  // 훅 실패가 체인을 끊지 않도록
        }
      }),
    );

    // TODO: stock-adjust.autofill 훅 등록
    // TODO: product.group-key 훅 등록
    // TODO: registerPhase 로 '재고 반영' 단계 삽입
    // TODO: job.completed 라이프사이클 핸들러

    return () => { disposables.forEach((d) => d()); };
  },
};

export default manifest;
