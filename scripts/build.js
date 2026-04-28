/**
 * 빌드 오케스트레이터 — flavor 인자 받아 전체 빌드 파이프라인 실행.
 *
 * 흐름:
 *   1) prepare-flavor: src/plugins/_generated.js 생성 (어떤 플러그인 번들)
 *   2) prepare-release-notes: release-notes/<version>.md → release-notes/latest.md
 *   3) webpack production
 *   4) electron-builder + flavor 별 publish.repo 자동 override
 *
 * 사용:
 *   node scripts/build.js tbnws
 *   node scripts/build.js basic
 */

const { execFileSync, execSync } = require('child_process');
const path = require('path');

// flavor 별 GitHub Release 채널.
// 비어있는(=현재) tbnws 채널은 기존 repo 재사용.
const PUBLISH_REPOS = {
  basic: 'coupang-supplier-releases-basic',
  tbnws: 'coupang-supplier-releases-tbnws',
  // acme: 'coupang-supplier-releases-acme',
};

const flavor = process.argv[2];
if (!flavor) {
  console.error('사용: node scripts/build.js <flavor>');
  console.error(`flavor: ${Object.keys(PUBLISH_REPOS).join(' | ')}`);
  process.exit(1);
}
const repo = PUBLISH_REPOS[flavor];
if (!repo) {
  console.error(`알 수 없는 flavor: ${flavor}`);
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const opts = { stdio: 'inherit', cwd: root, env: { ...process.env, BUILD_FLAVOR: flavor } };

console.log(`\n━━ flavor=${flavor} · publish=BOSEON-SEO/${repo} ━━\n`);

execFileSync('node', [path.join('scripts', 'prepare-flavor.js'), flavor], opts);
execFileSync('node', [path.join('scripts', 'prepare-release-notes.js')], opts);

execSync('npx webpack --mode production', opts);

// electron-builder publish.repo override — flavor 별 다른 release 채널 사용
execSync(`npx electron-builder --config.publish.repo=${repo}`, opts);

console.log(`\n✓ flavor=${flavor} 빌드 완료. dist-electron/ 확인.\n`);
