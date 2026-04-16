/**
 * 플러그인 시스템 — 회사별 커스텀 로직을 코어에서 분리
 *
 * 플러그인 인터페이스:
 *   {
 *     id: string,                          // 'tbnws' 등 식별자
 *     name: string,                        // UI 표시명
 *     sheetLabels: { data, matching, logistics, ... },
 *
 *     // phase 전환 훅 — po 시트 기반으로 다음 단계 시트 생성
 *     buildMatchingSheet(poSheet) => Sheet,
 *     buildLogisticsSheet(matchingSheet) => Sheet,
 *
 *     // 최종 제출 양식 export (선택)
 *     exportCoupangFormat?(workbook) => xlsx buffer,
 *
 *     // 검증 (선택)
 *     validate?(workbook) => string[] // 에러 메시지 배열
 *   }
 *
 * 플러그인 없이도 코어는 동작 (SpreadsheetView 기본 편집만).
 */

import tbnws from '../plugins/tbnws';

const REGISTRY = {
  tbnws,
};

export function getPlugin(id) {
  if (!id) return null;
  return REGISTRY[id] || null;
}

export function listPlugins() {
  return Object.values(REGISTRY).map((p) => ({ id: p.id, name: p.name }));
}
