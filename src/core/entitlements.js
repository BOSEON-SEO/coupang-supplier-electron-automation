/**
 * 현재 활성화된 entitlement 플래그 목록.
 *
 * 라이선스 dto 의 status 가 'valid' 또는 'near-expiry' 이면 거기 담긴
 * entitlements 사용. 그 외 (unlicensed/invalid/expired) 는 빈 배열 — 라이선스
 * 게이트가 메인 앱 자체를 차단하므로 도달할 일이 거의 없지만 안전.
 */

const ACTIVE_STATUSES = new Set(['valid', 'near-expiry']);

/**
 * @param {{status?:string, entitlements?:string[]} | null | undefined} license  license dto
 * @returns {string[]}
 */
export function resolveEntitlementsFromLicense(license) {
  if (license && ACTIVE_STATUSES.has(license.status) && Array.isArray(license.entitlements)) {
    return license.entitlements.slice();
  }
  return [];
}
