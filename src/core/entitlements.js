/**
 * 현재 활성화된 entitlement 플래그 목록.
 *
 * 출시 단계에서는 라이선스 서버가 JWT 토큰에 담아 발급한 값으로 대체됨.
 * 현재는 개발용 하드코딩 — App / popup 윈도우 모두 이 값을 공유.
 */
export const DEV_ENTITLEMENTS = Object.freeze(['core', 'hello', 'tbnws.plugin']);
