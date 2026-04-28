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

const flavor = process.argv[2];
if (!flavor) {
  console.error('사용: node scripts/build.js <flavor>');
  console.error('flavor: scripts/builder-config-<flavor>.yml 이 있는 이름 (basic, tbnws, ...)');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const extraConfigPath = path.join('scripts', `builder-config-${flavor}.yml`);
if (!require('fs').existsSync(path.join(root, extraConfigPath))) {
  console.error(`설정 파일 없음: ${extraConfigPath}`);
  process.exit(1);
}

const opts = { stdio: 'inherit', cwd: root, env: { ...process.env, BUILD_FLAVOR: flavor } };

console.log(`\n━━ flavor=${flavor} · config=${extraConfigPath} ━━\n`);

execFileSync('node', [path.join('scripts', 'check-builder-files.js')], opts);
execFileSync('node', [path.join('scripts', 'prepare-flavor.js'), flavor], opts);
execFileSync('node', [path.join('scripts', 'prepare-release-notes.js')], opts);
// Python embeddable + playwright 번들 (캐시 — 첫 빌드만 오래 걸림).
execFileSync('node', [path.join('scripts', 'setup-python-runtime.js')], opts);

execSync('npx webpack --mode production', opts);
execSync(`npx electron-builder --config ${extraConfigPath}`, opts);

console.log(`\n✓ flavor=${flavor} 빌드 완료. dist-electron/ 확인.\n`);
