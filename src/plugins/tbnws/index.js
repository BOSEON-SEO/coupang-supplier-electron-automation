/**
 * TBNWS 플러그인 — 투비네트웍스 전용 커스터마이즈.
 *
 * 계획된 기능 (아직 스켈레톤):
 *   1. PO 후처리 (po.postprocess)
 *      - 원본 PO 에 내부 컬럼 추가해 별도 파일 생성
 *   2. 재고조정 자동 채움 (stock-adjust.autofill)
 *      - 자사 재고표 대조해 납품여부·비고 자동 지정
 *   3. 제품 그룹핑 (product.group-key)
 *      - 투비 내부 상품코드로 SKU → 그룹키 매핑
 *   4. 재고 반영 phase (registerPhase)
 *      - 사내 백엔드 출고예정·로케이션 이동 + eFlexs 반출신청
 *   5. job.completed 라이프사이클
 *      - 밀크런/쉽먼트 기반 커스텀 파일 생성 (엑셀·PDF)
 */

import { KNOWN_SCOPES } from '../../core/plugin-api';

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'tbnws',
  name: 'TBNWS',
  version: '0.1.0',
  entitlement: 'tbnws.plugin',

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
        when: (whenCtx) => whenCtx.currentVendor === 'tbnws' || true, // 개발 단계는 항상 표시
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

    // TODO: po.postprocess 훅 등록
    // TODO: stock-adjust.autofill 훅 등록
    // TODO: product.group-key 훅 등록
    // TODO: registerPhase 로 '재고 반영' 단계 삽입
    // TODO: job.completed 라이프사이클 핸들러

    return () => { disposables.forEach((d) => d()); };
  },
};

export default manifest;
