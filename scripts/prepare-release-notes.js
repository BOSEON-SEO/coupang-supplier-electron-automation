/**
 * 빌드 직전 — release-notes/<version>.md 를 release-notes/latest.md 로 복사.
 * electron-builder 의 releaseInfo.releaseNotesFile 은 템플릿 치환을 안 해서
 * 단일 경로(latest.md) 를 가리키게 하고, 이 스크립트가 현재 버전에 맞는
 * 노트 파일을 복사해 둠.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version;

const src = path.join(root, 'release-notes', `${version}.md`);
const dst = path.join(root, 'release-notes', 'latest.md');

if (!fs.existsSync(src)) {
  console.warn(`[release-notes] ${src} 없음 — 빈 노트로 진행`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, `## ${version}\n\n(릴리즈 노트 없음)\n`);
  process.exit(0);
}

fs.copyFileSync(src, dst);
console.log(`[release-notes] ${path.relative(root, src)} → ${path.relative(root, dst)}`);
