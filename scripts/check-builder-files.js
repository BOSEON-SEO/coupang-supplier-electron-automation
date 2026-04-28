/**
 * 빌드 사전 체크 — 프로젝트 루트의 .js 파일 중 런타임 필요분이 모든
 * builder-config-*.yml 의 `files` 배열에 명시되어 있는지 검증.
 *
 * 누락 시 빌드 실패. v1.0.4 / v1.0.8 처럼 새 .js 추가하고 yml 갱신을
 * 잊어 부팅 크래시로 이어지는 사고 방지.
 *
 * 빌드 시 의존성이 없는 dev-only 스크립트는 IGNORE 에 명시.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// 빌드 결과물에 포함할 필요 없는 dev-only 파일
const IGNORE = new Set([
  'webpack.config.js',
  'preflight.js',
  'run-ui-test.js',
  'test-cdp-attach.js',
  'test-excel-lib.js',
  'test-integration.js',
  'test-python-bridge.js',
]);

const rootJs = fs.readdirSync(root)
  .filter((f) => f.endsWith('.js') && fs.statSync(path.join(root, f)).isFile())
  .filter((f) => !IGNORE.has(f));

const ymls = fs.readdirSync(path.join(root, 'scripts'))
  .filter((f) => /^builder-config-.+\.yml$/.test(f));

let failed = false;

for (const yml of ymls) {
  const content = fs.readFileSync(path.join(root, 'scripts', yml), 'utf-8');
  const missing = rootJs.filter((js) => !content.includes(`- ${js}`));
  if (missing.length) {
    failed = true;
    console.error(`[check-builder-files] ${yml} 에 누락: ${missing.join(', ')}`);
  }
}

if (failed) {
  console.error('\nscripts/builder-config-*.yml 의 files 에 누락된 .js 추가 필요.');
  console.error('dev-only 파일이라 무시해야 한다면 scripts/check-builder-files.js 의 IGNORE 에 추가.');
  process.exit(1);
}

console.log(`[check-builder-files] OK — ${rootJs.length} 파일 / ${ymls.length} yml 모두 일치`);
