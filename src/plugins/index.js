/**
 * 플러그인 레지스트리 — 빌드 플레이버에 따라 다른 manifest 배열을 export.
 *
 * 실제 import 는 scripts/prepare-flavor.js 가 빌드 직전 생성하는
 * `_generated.js` 가 담당. 이 파일은 그걸 그대로 re-export.
 *
 * dev 환경: `npm run dev` 가 prepare-flavor 를 먼저 돌려서 _generated.js 가
 * 항상 존재. (기본 flavor=tbnws — 모든 플러그인 포함)
 *
 * 새 플러그인 등록:
 *   1. src/plugins/<id>/index.js 작성
 *   2. scripts/prepare-flavor.js 의 FLAVORS 맵에 해당 flavor 추가/수정
 */

export { MANIFESTS, FLAVOR } from './_generated';
