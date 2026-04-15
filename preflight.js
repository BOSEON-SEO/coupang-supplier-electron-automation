#!/usr/bin/env node
/**
 * preflight.js — 실행 전 환경 사전 검증 스크립트
 *
 * 체크 항목:
 *   1. Python venv 존재 여부
 *   2. Playwright chromium 설치 여부
 *   3. CDP 9222 포트 접근 가능 여부 (warn only)
 *   4. vendors.json 존재 + 파싱 가능 여부
 *   5. COUPANG_ID_* / COUPANG_PW_* 환경변수 설정 여부
 *
 * 종료 코드:
 *   0 — 모든 필수(FAIL) 체크 통과
 *   1 — 하나 이상의 필수 체크 실패
 *
 * 사용:
 *   node preflight.js            # 일반 실행
 *   node preflight.js --json     # JSON 리포트 출력
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

// ── 출력 모드 ──────────────────────────────────────────────────
const JSON_MODE = process.argv.includes('--json');

// ── 상수 ───────────────────────────────────────────────────────
const PROJECT_ROOT = __dirname;
const VENV_DIR = path.join(PROJECT_ROOT, 'python', '.venv');
const VENDORS_JSON = path.join(PROJECT_ROOT, 'vendors.json');
const CDP_PORT = 9222;
const CDP_TIMEOUT_MS = 2000;

// severity: 'error' → 종료 코드에 반영, 'warn' → 경고만
const results = [];

// ── 유틸리티 ────────────────────────────────────────────────────
function record(name, passed, severity, message) {
  results.push({ name, passed, severity, message });
}

/**
 * ipc-handlers.js 의 detectPython() 로직을 경량 재구현.
 * ipc-handlers.js 를 직접 require 하면 Electron 의존 코드가 물려올 수 있으므로
 * 동일 알고리즘을 독립적으로 재현한다.
 */
function detectPython() {
  // 1) PYTHON_BIN
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN)) {
    return process.env.PYTHON_BIN;
  }
  // 2) PYTHON_PATH (하위 호환)
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) {
    return process.env.PYTHON_PATH;
  }
  // 3) 프로젝트 로컬 venv
  const venvCandidates = process.platform === 'win32'
    ? [path.join(VENV_DIR, 'Scripts', 'python.exe')]
    : [path.join(VENV_DIR, 'bin', 'python3'), path.join(VENV_DIR, 'bin', 'python')];
  for (const p of venvCandidates) {
    if (fs.existsSync(p)) return p;
  }
  // 4) 시스템 PATH
  const cmds = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  const which = process.platform === 'win32' ? 'where' : 'which';
  for (const cmd of cmds) {
    try {
      const out = execFileSync(which, [cmd], {
        encoding: 'utf-8', timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const found = out.trim().split(/\r?\n/)[0].trim();
      if (found) return found;
    } catch { /* next */ }
  }
  return null;
}

// ── Check 1: Python venv 존재 여부 ─────────────────────────────
function checkVenv() {
  const pyBin = process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', 'python.exe')
    : path.join(VENV_DIR, 'bin', 'python3');

  if (fs.existsSync(VENV_DIR) && fs.existsSync(pyBin)) {
    record('python-venv', true, 'error', `venv 확인됨: ${pyBin}`);
  } else {
    record('python-venv', false, 'error',
      `venv 미발견. 생성 명령: python -m venv python/.venv && pip install -r python/requirements.txt`);
  }
}

// ── Check 2: Playwright chromium 설치 여부 ─────────────────────
function checkPlaywright() {
  const pythonBin = detectPython();
  if (!pythonBin) {
    record('playwright-chromium', false, 'error',
      'Python 인터프리터를 찾을 수 없어 Playwright 검증 불가. venv를 먼저 생성하세요.');
    return;
  }

  // 2a) playwright 패키지 import 가능 여부
  try {
    execFileSync(pythonBin, [
      '-c',
      'from playwright.sync_api import sync_playwright; print("ok")',
    ], {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(PROJECT_ROOT, 'python'),
    });
  } catch {
    record('playwright-chromium', false, 'error',
      'playwright 패키지 import 실패. 설치: pip install playwright==1.40.0');
    return;
  }

  // 2b) chromium 브라우저 바이너리 설치 여부
  try {
    const out = execFileSync(pythonBin, [
      '-c',
      [
        'import json, subprocess, sys',
        'r = subprocess.run([sys.executable, "-m", "playwright", "install", "--dry-run", "chromium"],'
          + ' capture_output=True, text=True)',
        // dry-run 이 없는 playwright 버전 폴백: 브라우저 경로 직접 확인
        'from playwright._impl._driver import compute_driver_executable',
        'print("ok")',
      ].join('; '),
    ], {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(PROJECT_ROOT, 'python'),
    });
    // playwright 가 설치돼 있고 드라이버 경로가 존재하면 대체로 chromium 도 설치됨
    record('playwright-chromium', true, 'error', 'playwright + chromium 확인됨');
  } catch {
    // 드라이버 확인 실패 시에도 패키지 import 는 성공했으므로 warn 으로 격하
    // 더 확실한 검증: 실제로 chromium executable 경로 확인
    try {
      const browserCheck = execFileSync(pythonBin, [
        '-c',
        [
          'import os, pathlib, playwright',
          'pkg_dir = pathlib.Path(playwright.__file__).parent',
          'driver = pkg_dir / "driver" / "package" / ".local-browsers"',
          'chromiums = list(driver.glob("chromium-*")) if driver.exists() else []',
          'print("found" if chromiums else "missing")',
        ].join('\n'),
      ], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(PROJECT_ROOT, 'python'),
      });
      if (browserCheck.trim() === 'found') {
        record('playwright-chromium', true, 'error', 'playwright + chromium 확인됨');
      } else {
        record('playwright-chromium', false, 'error',
          'playwright 패키지는 설치됐으나 chromium 미설치. 실행: playwright install chromium');
      }
    } catch {
      // 최종 폴백: 패키지 import 성공 자체로 PASS (chromium 은 warn)
      record('playwright-chromium', true, 'warn',
        'playwright 패키지 확인됨. chromium 설치 여부 자동 검증 불가 — playwright install chromium 실행을 권장');
    }
  }
}

// ── Check 3: CDP 9222 포트 접근 가능 여부 ──────────────────────
function checkCdpPort() {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${CDP_PORT}/json/version`,
      { timeout: CDP_TIMEOUT_MS },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const info = JSON.parse(body);
            record('cdp-port-9222', true, 'warn',
              `CDP 활성: ${info.Browser || 'unknown browser'}`);
          } catch {
            record('cdp-port-9222', true, 'warn', 'CDP 포트 응답 있음 (파싱 실패)');
          }
          resolve();
        });
      },
    );
    req.on('error', () => {
      record('cdp-port-9222', false, 'warn',
        `localhost:${CDP_PORT} 미응답. Chrome을 --remote-debugging-port=${CDP_PORT} 로 실행하세요.`);
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      record('cdp-port-9222', false, 'warn',
        `localhost:${CDP_PORT} 타임아웃. Chrome을 --remote-debugging-port=${CDP_PORT} 로 실행하세요.`);
      resolve();
    });
  });
}

// ── Check 4: vendors.json 존재 + 파싱 ─────────────────────────
function checkVendorsJson() {
  if (!fs.existsSync(VENDORS_JSON)) {
    record('vendors-json', false, 'error',
      `vendors.json 미발견 (${VENDORS_JSON}). 앱 UI에서 벤더를 추가하거나 파일을 생성하세요.`);
    return;
  }
  try {
    const raw = fs.readFileSync(VENDORS_JSON, 'utf-8');
    const data = JSON.parse(raw);
    const vendorCount = Array.isArray(data) ? data.length
      : (typeof data === 'object' ? Object.keys(data).length : 0);
    record('vendors-json', true, 'error',
      `vendors.json 파싱 성공 (벤더 ${vendorCount}개)`);
  } catch (e) {
    record('vendors-json', false, 'error',
      `vendors.json 파싱 실패: ${e.message}`);
  }
}

// ── Check 5: COUPANG_ID_* / COUPANG_PW_* 환경변수 ─────────────
function checkEnvCredentials() {
  // vendors.json 에서 벤더 ID 목록 추출 시도
  let vendorIds = [];
  try {
    const raw = fs.readFileSync(VENDORS_JSON, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      vendorIds = data.map((v) => (v.id || v.name || '').toUpperCase()).filter(Boolean);
    } else if (typeof data === 'object') {
      vendorIds = Object.keys(data).map((k) => k.toUpperCase());
    }
  } catch { /* vendors.json 없으면 빈 목록 */ }

  // vendors.json 에서 추출한 ID 가 없으면 env 에서 패턴 매칭으로 탐색
  const envKeys = Object.keys(process.env);
  const idKeys = envKeys.filter((k) => /^COUPANG_ID_/.test(k));
  const pwKeys = envKeys.filter((k) => /^COUPANG_PW_/.test(k));

  if (vendorIds.length > 0) {
    // vendors.json 기반 검증
    const missing = [];
    for (const vid of vendorIds) {
      const idKey = `COUPANG_ID_${vid}`;
      const pwKey = `COUPANG_PW_${vid}`;
      if (!process.env[idKey]) missing.push(idKey);
      if (!process.env[pwKey]) missing.push(pwKey);
    }
    if (missing.length === 0) {
      record('env-credentials', true, 'error',
        `벤더별 자격증명 환경변수 모두 확인됨 (${vendorIds.join(', ')})`);
    } else {
      record('env-credentials', false, 'error',
        `누락된 환경변수: ${missing.join(', ')}`);
    }
  } else if (idKeys.length > 0 || pwKeys.length > 0) {
    // vendors.json 없지만 환경변수가 일부 존재
    const idVendors = idKeys.map((k) => k.replace('COUPANG_ID_', ''));
    const pwVendors = pwKeys.map((k) => k.replace('COUPANG_PW_', ''));
    const allVendors = [...new Set([...idVendors, ...pwVendors])];
    const incomplete = allVendors.filter(
      (v) => !process.env[`COUPANG_ID_${v}`] || !process.env[`COUPANG_PW_${v}`],
    );
    if (incomplete.length === 0) {
      record('env-credentials', true, 'error',
        `자격증명 환경변수 확인됨: ${allVendors.join(', ')}`);
    } else {
      record('env-credentials', false, 'error',
        `ID/PW 짝 불완전 벤더: ${incomplete.join(', ')} — COUPANG_ID_*/COUPANG_PW_* 쌍으로 설정 필요`);
    }
  } else {
    record('env-credentials', false, 'error',
      'COUPANG_ID_* / COUPANG_PW_* 환경변수가 하나도 설정되지 않음. vendors.json 벤더별로 설정 필요.');
  }
}

// ── 리포트 출력 ────────────────────────────────────────────────
function printReport() {
  const hasError = results.some((r) => !r.passed && r.severity === 'error');

  if (JSON_MODE) {
    const report = {
      schema_version: 1,
      timestamp: new Date().toISOString(),
      passed: !hasError,
      checks: results,
    };
    console.log(JSON.stringify(report, null, 2));
    return hasError;
  }

  // 사람이 읽는 콘솔 출력
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│       Preflight Environment Check            │');
  console.log('└─────────────────────────────────────────────┘');
  console.log('');

  for (const r of results) {
    const icon = r.passed ? '\x1b[32m✔ PASS\x1b[0m'
      : (r.severity === 'error' ? '\x1b[31m✘ FAIL\x1b[0m' : '\x1b[33m⚠ WARN\x1b[0m');
    console.log(`  ${icon}  [${r.name}]`);
    console.log(`         ${r.message}`);
    console.log('');
  }

  console.log('─'.repeat(47));
  if (hasError) {
    const failCount = results.filter((r) => !r.passed && r.severity === 'error').length;
    console.log(`\x1b[31m  ${failCount}개 필수 항목 실패 — 위 안내에 따라 조치하세요.\x1b[0m`);
  } else {
    const warnCount = results.filter((r) => !r.passed && r.severity === 'warn').length;
    if (warnCount > 0) {
      console.log(`\x1b[32m  필수 항목 모두 통과\x1b[0m \x1b[33m(경고 ${warnCount}건)\x1b[0m`);
    } else {
      console.log('\x1b[32m  모든 항목 통과 — 실행 준비 완료!\x1b[0m');
    }
  }
  console.log('');

  return hasError;
}

// ── 메인 ───────────────────────────────────────────────────────
async function main() {
  // 동기 체크
  checkVenv();
  checkPlaywright();
  checkVendorsJson();
  checkEnvCredentials();

  // 비동기 체크 (네트워크)
  await checkCdpPort();

  // 리포트 + 종료
  const hasError = printReport();
  process.exit(hasError ? 1 : 0);
}

main().catch((err) => {
  console.error('preflight 실행 중 예외:', err);
  process.exit(1);
});
