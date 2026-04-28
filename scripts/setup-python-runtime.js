/**
 * Python 런타임 번들러 — 빌드 전 자동 실행.
 *
 * 사용자 PC 에 Python 미설치라도 동작하도록 embeddable Python 을 다운로드하고
 * pip + playwright + openpyxl 를 미리 설치한 디렉토리(`python-runtime/`) 를
 * 만들어둔다. electron-builder 가 이 디렉토리를 asarUnpack 으로 포함.
 *
 * 한 번 만들어지면 캐시 — 재빌드 시 skip. 강제 재생성: --force.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, execSync } = require('child_process');

const PYTHON_VERSION = '3.11.9';
const PYTHON_ZIP = `python-${PYTHON_VERSION}-embed-amd64.zip`;
const PYTHON_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_ZIP}`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const root = path.resolve(__dirname, '..');
const runtimeDir = path.join(root, 'python-runtime');
const pythonExe = path.join(runtimeDir, 'python.exe');

const force = process.argv.includes('--force');

if (!force && fs.existsSync(pythonExe)) {
  // playwright import 가능한지 sanity check
  try {
    execFileSync(pythonExe, ['-c', 'import playwright; import openpyxl'], { stdio: 'ignore' });
    console.log(`[python-runtime] OK — ${path.relative(root, runtimeDir)} (캐시 사용)`);
    process.exit(0);
  } catch {
    console.log('[python-runtime] sanity check 실패 — 재생성');
  }
}

console.log(`[python-runtime] 생성 시작 → ${runtimeDir}`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', reject);
  });
}

async function main() {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 1) embeddable Python 다운로드
  const zipPath = path.join(runtimeDir, PYTHON_ZIP);
  console.log(`  ↓ ${PYTHON_URL}`);
  await download(PYTHON_URL, zipPath);

  // 2) 압축 해제 (PowerShell Expand-Archive)
  console.log('  ▣ unzip');
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${runtimeDir}' -Force"`, { stdio: 'inherit' });
  fs.unlinkSync(zipPath);

  // 3) python<ver>._pth 의 'import site' 주석 해제 (site-packages 활성화)
  const pthFile = fs.readdirSync(runtimeDir).find((f) => /^python\d+\._pth$/.test(f));
  if (!pthFile) throw new Error('._pth 파일을 찾을 수 없음');
  const pthPath = path.join(runtimeDir, pthFile);
  let pth = fs.readFileSync(pthPath, 'utf-8');
  pth = pth.replace(/^#\s*import\s+site\s*$/m, 'import site');
  fs.writeFileSync(pthPath, pth);

  // 4) get-pip.py 다운로드 + 실행
  const getPipPath = path.join(runtimeDir, 'get-pip.py');
  console.log('  ↓ get-pip.py');
  await download(GET_PIP_URL, getPipPath);
  console.log('  ▣ install pip');
  execFileSync(pythonExe, [getPipPath, '--no-warn-script-location'], { stdio: 'inherit' });
  fs.unlinkSync(getPipPath);

  // 5) requirements 설치
  const reqFile = path.join(root, 'python', 'requirements.txt');
  console.log('  ▣ pip install -r requirements.txt');
  execFileSync(pythonExe, ['-m', 'pip', 'install', '-r', reqFile, '--no-warn-script-location'], { stdio: 'inherit' });

  // 6) sanity check
  execFileSync(pythonExe, ['-c', 'import playwright; import openpyxl; print("OK")'], { stdio: 'inherit' });

  // 7) 크기 보고
  const size = (() => {
    let total = 0;
    function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    }
    walk(runtimeDir);
    return total;
  })();
  console.log(`[python-runtime] 완료 — ${(size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error('[python-runtime] 실패:', err);
  process.exit(1);
});
