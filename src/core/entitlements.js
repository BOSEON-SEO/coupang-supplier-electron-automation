/**
 * 현재 활성화된 entitlement 플래그 목록.
 *
 * 출시 단계에서는 라이선스 서버가 JWT 토큰에 담아 발급한 값으로 대체됨.
 * 현재는 글로벌 설정의 "플러그인 활성화" 토글로 on/off:
 *   - on  → DEV_ENTITLEMENTS (모든 플러그인 로드)
 *   - off → 빈 배열 (entitlement 없는 'hello' 처럼 무조건 로드되는 것만 남음 —
 *           하지만 배포 시점엔 hello 도 entitlement 요구하게 변경 예정)
 */

export const DEV_ENTITLEMENTS = Object.freeze(['core', 'hello', 'tbnws.plugin']);

/**
 * settings 객체를 받아 현재 entitlements 배열 반환.
 * off 토글을 기본값(키 없음)으로 판단하면 플러그인이 로드되므로,
 * 출시 단계엔 default=false 로 변경할 것.
 *
 * @param {{ pluginsMenuEnabled?: boolean } | null | undefined} settings
 * @returns {string[]}
 */
export function resolveEntitlements(settings) {
  const enabled = !!(settings && settings.pluginsMenuEnabled);
  return enabled ? DEV_ENTITLEMENTS.slice() : [];
}
