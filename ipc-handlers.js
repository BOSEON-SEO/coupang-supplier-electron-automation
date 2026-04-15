/**
 * IPC 핸들러 등록 (Main process)
 *
 * main.js (프로덕션)와 test-ui-validation.js (테스트) 양쪽에서 동일한
 * 핸들러 집합을 등록할 수 있도록 분리.
 *
 * @param {{ ipcMain: Electron.IpcMain, getWindow: () => Electron.BrowserWindow | null, dataDir: string }} deps
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { safeStorage } = require('electron');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Python 인터프리터 자동 탐지 ────────────────────────────────
let _cachedPythonPath = null;

/**
 * 파일이 존재하고 실행 가능한지 확인한다.
 * @param {string} p  절대 경로
 * @returns {boolean}
 */
function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Python 인터프리터 경로를 탐지한다.
 *
 * 탐지 우선순위:
 *   1. 환경변수 PYTHON_BIN (사용자가 절대 경로를 직접 지정)
 *   2. 환경변수 PYTHON_PATH (하위 호환)
 *   3. 프로젝트 로컬 venv (./python/.venv)
 *      - Windows: python/.venv/Scripts/python.exe
 *      - Unix:    python/.venv/bin/python3 → python/.venv/bin/python
 *   4. 시스템 PATH (where/which)
 *      - Windows: python → python3 → py
 *      - Unix:    python3 → python
 *
 * 한 번 탐지하면 캐시하여 재사용.
 * @returns {string|null}
 */
function detectPython() {
  if (_cachedPythonPath) return _cachedPythonPath;

  // ── 1) 환경변수 PYTHON_BIN (최우선) ──
  if (process.env.PYTHON_BIN) {
    const bin = process.env.PYTHON_BIN;
    if (fs.existsSync(bin)) {
      _cachedPythonPath = bin;
      return _cachedPythonPath;
    }
    // 경로가 존재하지 않으면 무시하고 다음 후보로 진행
  }

  // ── 2) 환경변수 PYTHON_PATH (하위 호환) ──
  if (process.env.PYTHON_PATH) {
    const pp = process.env.PYTHON_PATH;
    if (fs.existsSync(pp)) {
      _cachedPythonPath = pp;
      return _cachedPythonPath;
    }
  }

  // ── 3) 프로젝트 로컬 venv (./python/.venv) ──
  const venvDir = path.join(__dirname, 'python', '.venv');
  const venvCandidates = process.platform === 'win32'
    ? [path.join(venvDir, 'Scripts', 'python.exe')]
    : [path.join(venvDir, 'bin', 'python3'), path.join(venvDir, 'bin', 'python')];

  for (const venvBin of venvCandidates) {
    if (fs.existsSync(venvBin)) {
      _cachedPythonPath = venvBin;
      return _cachedPythonPath;
    }
  }

  // ── 4) 시스템 PATH (where/which) ──
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  const whichCmd = process.platform === 'win32' ? 'where' : 'which';

  // ELECTRON_RUN_AS_NODE 이 설정되어 있으면 오염될 수 있으므로 제거
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  for (const cmd of candidates) {
    try {
      const result = execFileSync(whichCmd, [cmd], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: cleanEnv,
      });
      // where는 여러 줄 반환할 수 있음 → 첫 줄만
      const found = result.trim().split(/\r?\n/)[0].trim();
      if (found) {
        _cachedPythonPath = found;
        return _cachedPythonPath;
      }
    } catch {
      // 해당 커맨드 없음 → 다음 후보
    }
  }
  return null;
}

/**
 * detectPython 캐시를 초기화한다 (테스트용).
 */
function resetPythonCache() {
  _cachedPythonPath = null;
}

// ── Python 프로세스 관리 ────────────────────────────────────────
// 동시 실행 방지용: 현재 실행 중인 Python child process 참조
let activeProcess = null;
let activeProcessId = 0; // 고유 실행 ID

function registerIpcHandlers({ ipcMain, getWindow, dataDir, cdpPort }) {
  const VENDORS_PATH = path.join(dataDir, 'vendors.json');
  const CREDENTIALS_PATH = path.join(dataDir, 'credentials.enc');
  const SCRIPTS_DIR = path.join(__dirname, 'python');
  // CDP 포트: main.js에서 주입, 없으면 환경변수/기본값 사용
  const _cdpPort = cdpPort || parseInt(process.env.CDP_PORT, 10) || 9222;

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // ── 자격증명 저장소 (safeStorage 암호화) ──────────────────────
  // 파일 포맷:
  //   {
  //     "schemaVersion": 1,
  //     "entries": {
  //       "<vendorId>": { "id": "<base64(encrypted)>", "pw": "<base64(encrypted)>" }
  //     }
  //   }
  // 암호화는 Electron safeStorage: Windows DPAPI / macOS Keychain / Linux libsecret.
  function loadCredentialStore() {
    try {
      if (!fs.existsSync(CREDENTIALS_PATH)) return { schemaVersion: 1, entries: {} };
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.entries || typeof parsed.entries !== 'object') parsed.entries = {};
      return parsed;
    } catch {
      return { schemaVersion: 1, entries: {} };
    }
  }

  function saveCredentialStore(store) {
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(store, null, 2), 'utf-8');
  }

  function encryptToBase64(plaintext) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS encryption (safeStorage) not available');
    }
    const buf = safeStorage.encryptString(String(plaintext));
    return buf.toString('base64');
  }

  function decryptFromBase64(b64) {
    try {
      const buf = Buffer.from(b64, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }

  /**
   * 특정 벤더의 암호화된 자격증명을 복호화해 평문으로 반환한다.
   * Main 프로세스 내부에서만 사용 (Python subprocess 주입용).
   * Renderer에는 절대 평문 password를 노출하지 않는다.
   */
  function getCredentialFor(vendorId) {
    const store = loadCredentialStore();
    const entry = store.entries?.[vendorId];
    if (!entry) return { id: null, password: null };
    return {
      id: entry.id ? decryptFromBase64(entry.id) : null,
      password: entry.pw ? decryptFromBase64(entry.pw) : null,
    };
  }

  // ── 헬퍼: Renderer로 이벤트 전송 ──
  function sendToRenderer(channel, payload) {
    try {
      const win = getWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    } catch {
      // 윈도우가 닫힌 상태 — 무시
    }
  }

  // ── 벤더 관리 ──
  ipcMain.handle('vendors:load', async () => {
    try {
      if (!fs.existsSync(VENDORS_PATH)) {
        const defaults = { schemaVersion: 1, vendors: [] };
        fs.writeFileSync(VENDORS_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
        return defaults;
      }
      const raw = fs.readFileSync(VENDORS_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      return { schemaVersion: 1, vendors: [], error: err.message };
    }
  });

  ipcMain.handle('vendors:save', async (_e, data) => {
    try {
      fs.writeFileSync(VENDORS_PATH, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 파일 I/O ──
  ipcMain.handle('file:getDataDir', async () => dataDir);

  ipcMain.handle('file:exists', async (_e, p) => fs.existsSync(p));

  ipcMain.handle('file:read', async (_e, p) => {
    try {
      const buf = fs.readFileSync(p);
      return {
        success: true,
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:write', async (_e, p, buffer) => {
    try {
      fs.writeFileSync(p, Buffer.from(buffer));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:listVendorFiles', async (_e, vendorId) => {
    try {
      if (!fs.existsSync(dataDir)) return { success: true, files: [] };
      const all = fs.readdirSync(dataDir);
      const pattern = vendorId
        ? new RegExp(`^${escapeRegex(vendorId)}-\\d{8}-\\d{2}\\.xlsx$`, 'i')
        : /^[a-z0-9_]+-\d{8}-\d{2}\.xlsx$/i;
      return { success: true, files: all.filter((n) => pattern.test(n)) };
    } catch (err) {
      return { success: false, error: err.message, files: [] };
    }
  });

  ipcMain.handle('file:resolveVendorPath', async (_e, fileName) => {
    if (
      typeof fileName !== 'string' ||
      fileName.includes('..') ||
      fileName.includes(path.sep) ||
      fileName.includes('/')
    ) {
      return { success: false, error: 'invalid filename' };
    }
    return { success: true, path: path.join(dataDir, fileName) };
  });

  // ── Python subprocess ─────────────────────────────────────────
  /**
   * python:run — Python 스크립트를 subprocess로 실행
   *
   * @param {string} scriptName  — python/ 디렉토리 내 스크립트 파일명 (예: 'po_download.py')
   * @param {string[]} args      — 스크립트에 전달할 추가 인자
   * @returns {Promise<{success: boolean, pid?: number, error?: string}>}
   *
   * 실행 중 stdout/stderr는 JSON-line 파싱 → python:log / python:error 이벤트로 스트리밍.
   * 프로세스 종료 시 python:done 이벤트 전송.
   *
   * stdout JSON-line 프로토콜:
   *   {"type":"log","data":"메시지"}  → python:log
   *   {"type":"error","data":"에러"}  → python:error
   *   (JSON 파싱 실패 시 raw 라인을 python:log로 전송)
   */
  ipcMain.handle('python:run', async (_e, scriptName, args) => {
    // ── 동시 실행 방지 ──
    if (activeProcess) {
      return {
        success: false,
        error: 'Python process already running (pid=' + activeProcess.pid + '). Cancel it first.',
      };
    }

    // ── Python 인터프리터 탐지 ──
    const pythonPath = detectPython();
    if (!pythonPath) {
      return {
        success: false,
        error: 'Python interpreter not found. Set PYTHON_BIN env, create python/.venv, or install Python system-wide.',
      };
    }

    // ── 스크립트 경로 검증 ──
    if (!scriptName || typeof scriptName !== 'string') {
      return { success: false, error: 'scriptName is required' };
    }
    // 디렉토리 탈출 방지: ".." 금지, 허용 패턴은 "파일명.py" 또는 "scripts/파일명.py"
    if (scriptName.includes('..')) {
      return { success: false, error: 'invalid scriptName: ".." not allowed' };
    }
    const normalized = scriptName.replace(/\\/g, '/');
    const segments = normalized.split('/');
    // 최대 2단계: "login.py" 또는 "scripts/login.py"
    if (segments.length > 2 || segments.some((s) => !s)) {
      return { success: false, error: 'invalid scriptName: max 1 subdirectory allowed' };
    }
    const scriptPath = path.join(SCRIPTS_DIR, ...segments);
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: `Script not found: ${scriptPath}` };
    }
    // 실제 경로가 SCRIPTS_DIR 내부인지 재확인
    const resolved = path.resolve(scriptPath);
    if (!resolved.startsWith(path.resolve(SCRIPTS_DIR))) {
      return { success: false, error: 'invalid scriptName: path escapes scripts directory' };
    }

    // 로그/이벤트용 표시 이름
    const baseName = normalized;

    // ── 인자 검증 ──
    const safeArgs = Array.isArray(args) ? args.map(String) : [];

    // ── 벤더별 자격증명 환경변수 추출 ──
    // 우선순위: safeStorage(credentials.enc) → 환경변수(COUPANG_ID_/PW_{VENDOR}) 폴백.
    // Python 스크립트에는 항상 env 변수 형태로 주입 (기존 인터페이스 유지).
    const vendorEnv = {};
    const vendorIdx = safeArgs.indexOf('--vendor');
    if (vendorIdx !== -1 && vendorIdx + 1 < safeArgs.length) {
      const vendorIdRaw = safeArgs[vendorIdx + 1];
      const vid = vendorIdRaw.toUpperCase();
      const idKey = `COUPANG_ID_${vid}`;
      const pwKey = `COUPANG_PW_${vid}`;

      const stored = getCredentialFor(vendorIdRaw);
      const idVal = stored.id || process.env[idKey];
      const pwVal = stored.password || process.env[pwKey];
      if (idVal) vendorEnv[idKey] = idVal;
      if (pwVal) vendorEnv[pwKey] = pwVal;
      vendorEnv.COUPANG_VENDOR_ID = vendorIdRaw;
    }

    // ── subprocess 실행 ──
    const runId = ++activeProcessId;

    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(pythonPath, ['-u', scriptPath, ...safeArgs], {
          cwd: SCRIPTS_DIR,
          env: {
            ...process.env,
            ...vendorEnv,
            PYTHONUNBUFFERED: '1',
            COUPANG_DATA_DIR: dataDir,
            CDP_ENDPOINT: `http://127.0.0.1:${_cdpPort}`,
            CDP_PORT: String(_cdpPort),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          // Windows에서 shell 사용하지 않음 (보안)
          shell: false,
        });
      } catch (err) {
        return resolve({
          success: false,
          error: `Failed to spawn Python: ${err.message}`,
        });
      }

      activeProcess = child;

      sendToRenderer('python:log', {
        line: `[system] Python process started (pid=${child.pid}, script=${baseName})`,
        pid: child.pid,
        scriptName: baseName,
      });

      // ── stdout 라인 파싱 ──
      let stdoutBuffer = '';
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString('utf-8');
        const lines = stdoutBuffer.split(/\r?\n/);
        // 마지막 불완전 라인은 버퍼에 보관
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          // JSON-line 프로토콜 시도
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === 'object' && parsed.type) {
              const channel = parsed.type === 'error' ? 'python:error' : 'python:log';
              sendToRenderer(channel, {
                line: parsed.data ?? line,
                pid: child.pid,
                scriptName: baseName,
                parsed,
              });
              continue;
            }
          } catch {
            // JSON 파싱 실패 → raw 라인으로 전송
          }
          sendToRenderer('python:log', {
            line,
            pid: child.pid,
            scriptName: baseName,
          });
        }
      });

      // ── stderr 라인 파싱 ──
      let stderrBuffer = '';
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString('utf-8');
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          sendToRenderer('python:error', {
            line,
            pid: child.pid,
            scriptName: baseName,
          });
        }
      });

      // ── 프로세스 종료 ──
      child.on('close', (code, signal) => {
        // 남은 버퍼 플러시
        if (stdoutBuffer.trim()) {
          sendToRenderer('python:log', {
            line: stdoutBuffer.trim(),
            pid: child.pid,
            scriptName: baseName,
          });
        }
        if (stderrBuffer.trim()) {
          sendToRenderer('python:error', {
            line: stderrBuffer.trim(),
            pid: child.pid,
            scriptName: baseName,
          });
        }

        // 이 프로세스가 여전히 active인 경우만 정리
        if (activeProcessId === runId) {
          activeProcess = null;
        }

        const wasKilled = signal === 'SIGTERM' || signal === 'SIGKILL';
        sendToRenderer('python:done', {
          pid: child.pid,
          scriptName: baseName,
          exitCode: code,
          signal,
          killed: wasKilled,
        });
      });

      // ── spawn 에러 (예: ENOENT) ──
      // 주의: 일부 에지케이스(ENOENT 등)에서는 'error'만 발생하고 'close'가
      // 오지 않을 수 있다. 그래서 error 핸들러에서도 activeProcess를 정리하고
      // python:done을 전송하여 Renderer가 실행 상태를 복구할 수 있게 한다.
      let spawnErrorFired = false;
      child.on('error', (err) => {
        spawnErrorFired = true;
        if (activeProcessId === runId) {
          activeProcess = null;
        }
        sendToRenderer('python:error', {
          line: `[system] Process error: ${err.message}`,
          pid: child.pid,
          scriptName: baseName,
        });
        // close 이벤트가 오지 않을 수 있으므로 done을 여기서도 보낸다.
        // close 핸들러에서 중복 전송되더라도 Renderer는 멱등 처리한다.
        sendToRenderer('python:done', {
          pid: child.pid,
          scriptName: baseName,
          exitCode: null,
          signal: null,
          killed: false,
          error: err.message,
        });
      });

      // spawn 성공 → 즉시 응답 (프로세스 완료를 기다리지 않음)
      resolve({
        success: true,
        pid: child.pid,
        scriptName: baseName,
        pythonPath,
      });
    });
  });

  // ── python:cancel — 실행 중인 Python 프로세스 취소 ──
  ipcMain.handle('python:cancel', async () => {
    if (!activeProcess) {
      return { success: false, error: 'No active Python process' };
    }

    const pid = activeProcess.pid;
    try {
      // graceful termination 시도
      const killed = activeProcess.kill('SIGTERM');
      if (!killed) {
        // SIGTERM 실패 시 강제 종료
        activeProcess.kill('SIGKILL');
      }
    } catch (err) {
      return { success: false, error: `Failed to kill process: ${err.message}` };
    }

    // 강제 종료 타임아웃: 3초 후에도 살아있으면 SIGKILL
    const proc = activeProcess;
    setTimeout(() => {
      try {
        if (proc && !proc.killed) {
          proc.kill('SIGKILL');
        }
      } catch {
        // 이미 종료됨
      }
    }, 3000);

    return { success: true, pid, message: 'Kill signal sent' };
  });

  // ── python:status — 현재 Python 프로세스 상태 조회 ──
  ipcMain.handle('python:status', async () => {
    if (!activeProcess) {
      return { running: false };
    }
    return {
      running: true,
      pid: activeProcess.pid,
    };
  });

  // ── python:detectPath — Python 인터프리터 경로 조회 ──
  ipcMain.handle('python:detectPath', async () => {
    const pythonPath = detectPython();
    return {
      found: !!pythonPath,
      path: pythonPath || null,
    };
  });

  // ── 자격증명 관리 ──────────────────────────────────────────────

  /**
   * credentials:check — 벤더별 자격증명 저장 상태 확인
   *
   * 우선순위: safeStorage(credentials.enc) → 환경변수(COUPANG_ID_/PW_{VENDOR}) 폴백.
   * password는 절대 반환하지 않는다. id는 사용자가 확인할 수 있도록 평문 반환.
   *
   * @param {string} vendorId
   * @returns {{
   *   hasId: boolean, hasPassword: boolean, id: string|null,
   *   source: { id: 'safeStorage'|'env'|null, password: 'safeStorage'|'env'|null },
   *   envIdKey: string, envPwKey: string, encryptionAvailable: boolean
   * }}
   */
  ipcMain.handle('credentials:check', async (_e, vendorId) => {
    if (!vendorId || typeof vendorId !== 'string') {
      return {
        hasId: false, hasPassword: false, id: null,
        source: { id: null, password: null },
        envIdKey: '', envPwKey: '',
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
        error: 'vendorId required',
      };
    }
    const upper = vendorId.toUpperCase();
    const envIdKey = `COUPANG_ID_${upper}`;
    const envPwKey = `COUPANG_PW_${upper}`;

    const stored = getCredentialFor(vendorId);
    const hasStoredId = !!stored.id;
    const hasStoredPw = !!stored.password;
    const hasEnvId = !!process.env[envIdKey];
    const hasEnvPw = !!process.env[envPwKey];

    return {
      hasId: hasStoredId || hasEnvId,
      hasPassword: hasStoredPw || hasEnvPw,
      id: stored.id || process.env[envIdKey] || null,
      source: {
        id: hasStoredId ? 'safeStorage' : (hasEnvId ? 'env' : null),
        password: hasStoredPw ? 'safeStorage' : (hasEnvPw ? 'env' : null),
      },
      envIdKey,
      envPwKey,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  });

  /**
   * credentials:save — 벤더별 ID/PW를 safeStorage로 암호화하여 저장
   * 빈 문자열/null은 "변경 없음"으로 해석 (삭제는 credentials:delete).
   */
  ipcMain.handle('credentials:save', async (_e, vendorId, id, password) => {
    if (!vendorId || typeof vendorId !== 'string') {
      return { success: false, error: 'vendorId required' };
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'OS encryption (safeStorage) not available on this system' };
    }
    try {
      const store = loadCredentialStore();
      store.entries = store.entries || {};
      const current = store.entries[vendorId] || {};
      if (typeof id === 'string' && id.length > 0) {
        current.id = encryptToBase64(id);
      }
      if (typeof password === 'string' && password.length > 0) {
        current.pw = encryptToBase64(password);
      }
      if (!current.id && !current.pw) {
        return { success: false, error: 'nothing to save: both id and password are empty' };
      }
      store.entries[vendorId] = current;
      saveCredentialStore(store);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * credentials:delete — 특정 벤더의 저장된 자격증명 전체 삭제
   */
  ipcMain.handle('credentials:delete', async (_e, vendorId) => {
    if (!vendorId || typeof vendorId !== 'string') {
      return { success: false, error: 'vendorId required' };
    }
    try {
      const store = loadCredentialStore();
      if (store.entries && store.entries[vendorId]) {
        delete store.entries[vendorId];
        saveCredentialStore(store);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 세션 유효성 검증 (CDP 기반) ─────────────────────────────────

  /**
   * session:check — CDP를 통한 현재 페이지 세션 유효 여부 확인
   *
   * CDP 디버깅 엔드포인트에 HTTP 요청을 보내 열려 있는 페이지 목록을 조회한다.
   * supplier.coupang.com이 URL에 포함된 페이지가 있으면 세션 유효.
   * BrowserView/WebContentsView 없이도 동작 — CDP /json 엔드포인트만 사용.
   *
   * @returns {{ valid: boolean, url?: string, pages: number, error?: string }}
   */
  ipcMain.handle('session:check', async () => {
    const cdpUrl = `http://127.0.0.1:${_cdpPort}/json`;

    return new Promise((resolve) => {
      const req = http.get(cdpUrl, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const pages = JSON.parse(body);
            if (!Array.isArray(pages)) {
              resolve({ valid: false, pages: 0, error: 'unexpected CDP response' });
              return;
            }
            // supplier.coupang.com 페이지 찾기
            const supplierPage = pages.find(
              (p) => p.url && p.url.includes('supplier.coupang.com')
            );
            // Keycloak 로그인 페이지 감지
            const loginPage = pages.find(
              (p) => p.url && (
                p.url.includes('login.coupang.com') ||
                p.url.includes('sso.coupang.com') ||
                p.url.includes('/auth/realms/')
              )
            );
            if (supplierPage) {
              resolve({ valid: true, url: supplierPage.url, pages: pages.length });
            } else if (loginPage) {
              resolve({ valid: false, url: loginPage.url, pages: pages.length, loginRequired: true });
            } else {
              resolve({ valid: false, pages: pages.length, url: pages[0]?.url || '' });
            }
          } catch (err) {
            resolve({ valid: false, pages: 0, error: `CDP JSON parse error: ${err.message}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ valid: false, pages: 0, error: `CDP connection failed: ${err.message}` });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ valid: false, pages: 0, error: 'CDP connection timeout (5s)' });
      });
    });
  });

  // ── 위험 동작 카운트다운 (Renderer에서 UI 표시, Main은 알림만) ──
  ipcMain.handle('action:confirmDangerous', async (_e, actionName) => {
    const win = getWindow?.();
    win?.webContents.send('action:countdown', { actionName });
    return { acknowledged: true };
  });
}

module.exports = { registerIpcHandlers, detectPython, resetPythonCache };
