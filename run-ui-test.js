/**
 * UI 검증 테스트 런처
 * ELECTRON_RUN_AS_NODE 환경변수를 제거하고 Electron을 올바르게 실행한다.
 */
const { execFileSync } = require('child_process');
const electronPath = require('electron');
const path = require('path');

// ELECTRON_RUN_AS_NODE 를 제거한 환경 구성
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_LOAD_DIST = '1'; // dist/index.html 강제 로드

const testScript = path.join(__dirname, 'test-ui-validation.js');

try {
  const result = execFileSync(electronPath, [testScript], {
    env,
    timeout: 30000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log(result);
} catch (e) {
  // Electron이 exit code != 0 으로 종료해도 stdout 출력
  if (e.stdout) console.log(e.stdout);
  if (e.stderr) console.error(e.stderr);
  process.exit(e.status || 1);
}
