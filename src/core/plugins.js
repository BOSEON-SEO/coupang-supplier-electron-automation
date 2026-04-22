/**
 * 플러그인 시스템 — 회사별 커스텀 로직을 코어에서 분리
 *
 * 플러그인 인터페이스 (모든 필드 선택):
 *   {
 *     id: string,                 // 레지스트리 식별자
 *     name: string,                // UI 표시명
 *     sheetLabels?: {              // phase → 시트 이름 매핑 (기본값 제공)
 *       po, confirmed, assigned
 *     },
 *     // 각 phase 진행 시 새 시트 생성 (선택)
 *     buildSheet?(phase, workbook) => Sheet | null,
 *     // 쿠팡 제출용 양식 export (선택)
 *     exportCoupangFormat?(workbook) => xlsx buffer,
 *     // 단계 진입 전 검증 (선택)
 *     validate?(phase, workbook) => string[],
 *   }
 *
 * 플러그인 없어도 코어는 동작:
 *   - phase 진행 시 시트 자동 생성 없음 (사용자가 FortuneSheet 에서 직접 편집)
 *   - export / validate 생략
 */

// TODO: 회사별 플러그인은 별도 브랜치/포크에서 여기 등록
const REGISTRY = {
  // 'tbnws': require('../plugins/tbnws').default,
};

export function getPlugin(id) {
  if (!id) return null;
  return REGISTRY[id] || null;
}

export function listPlugins() {
  return Object.values(REGISTRY).map((p) => ({ id: p.id, name: p.name }));
}
