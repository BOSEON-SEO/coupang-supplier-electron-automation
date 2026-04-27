/**
 * 현재 활성화된 entitlement 플래그 목록.
 *
 * v1 라이선스 흐름:
 *   - license dto 의 status 가 'valid' 또는 'near-expiry' 이면 그 entitlements 사용
 *   - 그 외 (unlicensed/invalid/expired) 는 빈 배열 — 플러그인 로드 안 됨
 *   - 단, settings.pluginsMenuEnabled = true 이면 dev override 로 DEV_ENTITLEMENTS 폴백.
 *     출시 빌드에서는 이 토글 비활성화 또는 라벨 변경 ("개발자: 라이선스 무시").
 */

export const DEV_ENTITLEMENTS = Object.freeze(['core', 'hello', 'tbnws.plugin']);

const ACTIVE_STATUSES = new Set(['valid', 'near-expiry']);

/**
 * @param {{status?:string, entitlements?:string[]} | null | undefined} license  license dto
 * @param {{ pluginsMenuEnabled?: boolean } | null | undefined} settings  글로벌 설정
 * @returns {string[]}
 */
export function resolveEntitlementsFromLicense(license, settings) {
  if (license && ACTIVE_STATUSES.has(license.status) && Array.isArray(license.entitlements)) {
    return license.entitlements.slice();
  }
  // dev override — 라이선스 없거나 만료여도 토글 켜져있으면 모든 플러그인 활성.
  if (settings && settings.pluginsMenuEnabled) {
    return DEV_ENTITLEMENTS.slice();
  }
  return [];
}

/**
 * 기존 호출자 호환용 래퍼. license 없이 settings 만 보고 판단 (legacy).
 * 새 코드는 resolveEntitlementsFromLicense 를 직접 사용.
 *
 * @deprecated license dto 를 받는 resolveEntitlementsFromLicense 사용.
 */
export function resolveEntitlements(settings) {
  return resolveEntitlementsFromLicense(null, settings);
}
