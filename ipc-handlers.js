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
const { safeStorage, dialog, shell, BrowserWindow } = require('electron');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Job 폴더 헬퍼 (date/vendor/seq) ──────────────────────────
const JOB_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JOB_VENDOR_RE = /^[a-z0-9_]{2,20}$/;
const JOB_SEQ_RE = /^\d{2}$/;

function isValidDate(s) { return typeof s === 'string' && JOB_DATE_RE.test(s); }
function isValidVendor(s) { return typeof s === 'string' && JOB_VENDOR_RE.test(s); }
function isValidSeq(n) {
  return Number.isInteger(n) && n >= 1 && n <= 99;
}

function jobDir(dataDir, date, vendor, seq) {
  return path.join(dataDir, date, vendor, String(seq).padStart(2, '0'));
}
function manifestPath(dataDir, date, vendor, seq) {
  return path.join(jobDir(dataDir, date, vendor, seq), 'manifest.json');
}

function readManifest(dataDir, date, vendor, seq) {
  const p = manifestPath(dataDir, date, vendor, seq);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeManifest(dataDir, manifest) {
  const dir = jobDir(dataDir, manifest.date, manifest.vendor, manifest.sequence);
  fs.mkdirSync(dir, { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath(dataDir, manifest.date, manifest.vendor, manifest.sequence),
    JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

function listVendorSequences(dataDir, date, vendor) {
  const dir = path.join(dataDir, date, vendor);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => JOB_SEQ_RE.test(n))
    .map((n) => parseInt(n, 10))
    .sort((a, b) => a - b);
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
let activeScriptName = null; // 현재 실행 중인 script 표시 이름 (python:status 노출용)

// ── 재고조정: po.xlsx 헤더 매칭 ─────────────────────────────
// poParser.js 와 동일 의미지만 main process 는 CJS 라서 별도 상수.
const PO_HEADER_TO_KEY = {
  '발주번호': 'coupang_order_seq',
  '주문번호': 'coupang_order_seq',
  'SKU ID': 'sku_id',
  '상품번호': 'sku_id',
  'SKU 이름': 'sku_name',
  '상품이름': 'sku_name',
  '상품명': 'sku_name',
  'SKU Barcode': 'sku_barcode',
  'SKU Barcode ': 'sku_barcode',
  '상품바코드': 'sku_barcode',
  '물류센터': 'departure_warehouse',
  '입고예정일': 'expected_arrival_date',
  '발주수량': 'order_quantity',
  '확정수량': 'confirmed_qty',
};

/** aoa 기준으로 헤더 매핑 + 행별 원본 인덱스를 보존한 parse */
function parsePoAoa(aoa) {
  if (!aoa.length) return { keyByCol: {}, headerRow: [], rows: [] };
  const header = aoa[0] || [];
  const keyByCol = {};
  for (let c = 0; c < header.length; c += 1) {
    const label = String(header[c] ?? '').trim();
    const key = PO_HEADER_TO_KEY[label];
    if (key) keyByCol[c] = key;
  }
  const rows = [];
  for (let r = 1; r < aoa.length; r += 1) {
    const row = aoa[r] || [];
    const obj = { rowIndex: r }; // 0-based 데이터 배열 인덱스 (헤더 제외 x, 헤더 포함 기준)
    for (let c = 0; c < row.length; c += 1) {
      const key = keyByCol[c];
      if (!key) continue;
      obj[key] = row[c];
    }
    if (obj.coupang_order_seq || obj.sku_id || obj.sku_barcode) rows.push(obj);
  }
  return { keyByCol, headerRow: header, rows };
}

function findConfirmedQtyColIndex(headerRow) {
  for (let c = 0; c < headerRow.length; c += 1) {
    const label = String(headerRow[c] ?? '').trim();
    if (label === '확정수량') return c;
  }
  return -1;
}

function registerIpcHandlers({
  ipcMain, getWindow, dataDir, cdpPort, setPendingDownloadTarget, setPendingDownloadDir,
  openStockAdjustWindow, openTransportWindow,
  isJobLocked, getLockedJobKeys, getLockedJobsByType, closeStockAdjustWindow,
}) {
  const VENDORS_PATH = path.join(dataDir, 'vendors.json');
  const CREDENTIALS_PATH = path.join(dataDir, 'credentials.enc');
  const SETTINGS_PATH = path.join(dataDir, 'settings.json');
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

  // ── 전역 설정 (settings.json) ──
  ipcMain.handle('settings:load', async () => {
    try {
      if (!fs.existsSync(SETTINGS_PATH)) {
        return { schemaVersion: 1, settings: {} };
      }
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      return { schemaVersion: 1, settings: {}, error: err.message };
    }
  });

  ipcMain.handle('settings:save', async (_e, data) => {
    try {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 작업(Job) 관리 ───────────────────────────────────────────
  // 폴더 구조: {dataDir}/{YYYY-MM-DD}/{vendor}/{seq:02d}/{po.csv, manifest.json, ...}
  // manifest schema: { schemaVersion, vendor, date, sequence,
  //                    phase: 'po_downloaded'|'matched'|'assigned'|'uploaded',
  //                    completed: bool, createdAt, updatedAt, stats? }

  /**
   * jobs:list — 특정 날짜의 작업 목록 (manifest 배열).
   * vendor 인자 주면 해당 벤더만, 없으면 전체.
   */
  ipcMain.handle('jobs:list', async (_e, date, vendor) => {
    if (!isValidDate(date)) return { success: false, error: 'invalid date', jobs: [] };
    const dayDir = path.join(dataDir, date);
    if (!fs.existsSync(dayDir)) return { success: true, jobs: [] };

    const filter = (vendor && isValidVendor(vendor)) ? vendor : null;
    const jobs = [];
    for (const v of fs.readdirSync(dayDir)) {
      if (!isValidVendor(v)) continue;
      if (filter && v !== filter) continue;
      for (const seq of listVendorSequences(dataDir, date, v)) {
        const m = readManifest(dataDir, date, v, seq);
        if (m) jobs.push(m);
      }
    }
    return { success: true, jobs };
  });

  /**
   * jobs:listMonth — 연·월에 작업이 있는 날짜별 카운트 (달력 배지).
   * vendor 인자 주면 해당 벤더만 집계, 없으면 전체.
   */
  ipcMain.handle('jobs:listMonth', async (_e, year, month, vendor) => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return { success: false, error: 'invalid year/month', byDate: {} };
    }
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    if (!fs.existsSync(dataDir)) return { success: true, byDate: {} };

    const filter = (vendor && isValidVendor(vendor)) ? vendor : null;
    const byDate = {};
    for (const name of fs.readdirSync(dataDir)) {
      if (!name.startsWith(prefix) || !isValidDate(name)) continue;
      const dayDir = path.join(dataDir, name);
      let count = 0;
      let hasIncomplete = false;
      try {
        for (const v of fs.readdirSync(dayDir)) {
          if (!isValidVendor(v)) continue;
          if (filter && v !== filter) continue;
          for (const seq of listVendorSequences(dataDir, name, v)) {
            const m = readManifest(dataDir, name, v, seq);
            if (!m) continue;
            count += 1;
            if (!m.completed) hasIncomplete = true;
          }
        }
      } catch { /* 디렉토리 접근 실패 무시 */ }
      if (count > 0) byDate[name] = { count, hasIncomplete };
    }
    return { success: true, byDate };
  });

  /**
   * jobs:recordUpload — 쿠팡에 업로드한 시점의 confirmation.xlsx 스냅샷을
   * job/history/ 에 복사 보관하고 manifest.uploadHistory 에 엔트리 누적.
   * phase 는 'uploaded' 로 전환.
   *
   * PO/확정서 는 계속 자유롭게 편집 가능 — 이 기록은 "무엇을 언제 올렸는지"
   * 증거물 보관 용도.
   */
  ipcMain.handle('jobs:recordUpload', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const dir = jobDir(dataDir, date, vendor, sequence);
    const src = path.join(dir, 'confirmation.xlsx');
    if (!fs.existsSync(src)) {
      return { success: false, error: 'confirmation.xlsx 가 없습니다.' };
    }
    try {
      const histDir = path.join(dir, 'history');
      fs.mkdirSync(histDir, { recursive: true });

      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-04-22T14-30-45
      const destName = `${ts}-confirmation.xlsx`;
      const dest = path.join(histDir, destName);
      fs.copyFileSync(src, dest);
      const size = fs.statSync(dest).size;

      const cur = readManifest(dataDir, date, vendor, sequence) || {
        schemaVersion: 1, vendor, date, sequence,
        phase: 'po_downloaded', completed: false,
        createdAt: now.toISOString(), stats: {},
      };
      const history = Array.isArray(cur.uploadHistory) ? cur.uploadHistory : [];
      const entry = {
        timestamp: now.toISOString(),
        fileName: destName,
        path: dest,
        size,
      };
      cur.uploadHistory = [...history, entry];
      cur.phase = 'uploaded';
      cur.vendor = vendor;
      cur.date = date;
      cur.sequence = sequence;
      writeManifest(dataDir, cur);

      return { success: true, entry, manifest: cur };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * jobs:deleteUploadHistory — 업로드 이력 한 건 제거 (timestamp 로 매칭).
   * history/ 파일 삭제 + manifest.uploadHistory 에서 엔트리 제거.
   * 이력이 모두 비워지면 phase 를 'confirmed' 로 되돌림.
   */
  ipcMain.handle('jobs:deleteUploadHistory', async (_e, date, vendor, sequence, timestamp) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (typeof timestamp !== 'string' || !timestamp) {
      return { success: false, error: 'timestamp required' };
    }
    try {
      const cur = readManifest(dataDir, date, vendor, sequence);
      if (!cur) return { success: false, error: 'manifest not found' };
      const history = Array.isArray(cur.uploadHistory) ? cur.uploadHistory : [];
      const target = history.find((h) => h.timestamp === timestamp);
      if (!target) return { success: false, error: 'history entry not found' };

      // 파일 삭제 — dataDir 하위 경로만 허용 (path escape 방지)
      try {
        const resolved = path.resolve(target.path || '');
        const base = path.resolve(dataDir);
        if (resolved.startsWith(base + path.sep) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      } catch { /* 파일 삭제 실패는 무시 — manifest 는 업데이트 */ }

      cur.uploadHistory = history.filter((h) => h.timestamp !== timestamp);
      if (cur.uploadHistory.length === 0) {
        cur.phase = 'confirmed';
        delete cur.uploadHistory;
      }
      writeManifest(dataDir, cur);
      return { success: true, manifest: cur };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /** jobs:listFiles — job 폴더의 파일 목록 (name, size, mtime) */
  ipcMain.handle('jobs:listFiles', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args', files: [] };
    }
    const dir = jobDir(dataDir, date, vendor, sequence);
    if (!fs.existsSync(dir)) return { success: true, files: [] };
    try {
      const files = [];
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        try {
          const st = fs.statSync(p);
          if (st.isFile()) {
            files.push({ name, size: st.size, mtime: st.mtimeMs });
          }
        } catch { /* 접근 불가 파일 무시 */ }
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message, files: [] };
    }
  });

  /** jobs:loadManifest */
  ipcMain.handle('jobs:loadManifest', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const m = readManifest(dataDir, date, vendor, sequence);
    if (!m) return { success: false, error: 'not found' };
    return { success: true, manifest: m };
  });

  /** jobs:create — 새 작업.
   *   opts.sequence: 명시 차수. 미지정 시 (마지막+1) 자동 할당.
   *   기존 차수와 충돌 시 거부. 직전 차수 미완료 가드는 제거됨.
   */
  ipcMain.handle('jobs:create', async (_e, date, vendor, opts) => {
    if (!isValidDate(date) || !isValidVendor(vendor)) {
      return { success: false, error: 'invalid date or vendor' };
    }
    const seqs = listVendorSequences(dataDir, date, vendor);
    const lastSeq = seqs.length > 0 ? seqs[seqs.length - 1] : 0;
    const explicit = opts && opts.sequence != null ? Number(opts.sequence) : null;
    const newSeq = explicit != null ? explicit : lastSeq + 1;
    if (!isValidSeq(newSeq)) {
      return { success: false, error: `invalid sequence: ${opts?.sequence}` };
    }
    if (seqs.includes(newSeq)) {
      return { success: false, error: `이미 존재하는 차수입니다: ${newSeq}차`, conflictSequence: newSeq };
    }
    if (newSeq > 99) return { success: false, error: 'sequence overflow (>99)' };

    const now = new Date().toISOString();
    const plugin = typeof opts?.plugin === 'string' && /^[a-z0-9_-]{1,30}$/i.test(opts.plugin)
      ? opts.plugin : null;
    const manifest = {
      schemaVersion: 1,
      vendor,
      date,
      sequence: newSeq,
      phase: 'po_downloaded',
      completed: false,
      plugin,
      createdAt: now,
      updatedAt: now,
      stats: {},
    };
    writeManifest(dataDir, manifest);
    return { success: true, manifest };
  });

  /** jobs:updateManifest — patch 머지 후 저장 */
  ipcMain.handle('jobs:updateManifest', async (_e, date, vendor, sequence, patch) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const cur = readManifest(dataDir, date, vendor, sequence);
    if (!cur) return { success: false, error: 'not found' };
    const next = { ...cur, ...(patch || {}) };
    // 무결성 보호: 핵심 필드는 patch 로 못 바꿈
    next.vendor = cur.vendor;
    next.date = cur.date;
    next.sequence = cur.sequence;
    next.schemaVersion = cur.schemaVersion;
    writeManifest(dataDir, next);
    return { success: true, manifest: next };
  });

  /** jobs:complete — 작업 완료 처리 (사용자 명시 또는 phase=uploaded 자동) */
  ipcMain.handle('jobs:complete', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const cur = readManifest(dataDir, date, vendor, sequence);
    if (!cur) return { success: false, error: 'not found' };
    cur.completed = true;
    writeManifest(dataDir, cur);
    return { success: true, manifest: cur };
  });

  /**
   * jobs:delete — 작업 폴더 삭제 + 상위 폴더(벤더/날짜) 가 비었으면 같이 정리
   * dataDir 내부에 있는지 한 번 더 검증해서 디렉토리 탈출 방지.
   */
  ipcMain.handle('jobs:delete', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const target = jobDir(dataDir, date, vendor, sequence);
    const resolvedTarget = path.resolve(target);
    const resolvedData = path.resolve(dataDir);
    if (!resolvedTarget.startsWith(resolvedData + path.sep)) {
      return { success: false, error: 'path escape' };
    }
    try {
      if (!fs.existsSync(target)) {
        return { success: true, removedDay: false };
      }
      fs.rmSync(target, { recursive: true, force: true });

      // 벤더 폴더가 비었으면 삭제
      const vendorDir = path.join(dataDir, date, vendor);
      if (fs.existsSync(vendorDir) && fs.readdirSync(vendorDir).length === 0) {
        fs.rmdirSync(vendorDir);
      }
      // 날짜 폴더가 비었으면 삭제
      const dayDir = path.join(dataDir, date);
      let removedDay = false;
      if (fs.existsSync(dayDir) && fs.readdirSync(dayDir).length === 0) {
        fs.rmdirSync(dayDir);
        removedDay = true;
      }
      return { success: true, removedDay };
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

  // ── 사용자 지정 경로로 복사 (다운로드 다이얼로그) ──
  ipcMain.handle('file:saveAs', async (_e, srcPath, defaultName) => {
    try {
      if (!srcPath || !fs.existsSync(srcPath)) {
        return { success: false, error: '원본 파일이 존재하지 않습니다.' };
      }
      const win = getWindow?.();
      const result = await dialog.showSaveDialog(win || undefined, {
        title: '다른 이름으로 저장',
        defaultPath: defaultName || path.basename(srcPath),
        filters: [
          { name: 'Excel Workbook', extensions: ['xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      fs.copyFileSync(srcPath, result.filePath);
      return { success: true, path: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── OS 탐색기에서 파일/폴더 보기 (dataDir 내부만 허용) ──
  ipcMain.handle('file:showInFolder', async (_e, targetPath) => {
    try {
      if (typeof targetPath !== 'string' || !targetPath) {
        return { success: false, error: 'invalid path' };
      }
      const resolved = path.resolve(targetPath);
      const base = path.resolve(dataDir);
      if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return { success: false, error: 'path outside data dir' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: '경로가 존재하지 않습니다.' };
      }
      shell.showItemInFolder(resolved);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── OS 기본 앱으로 파일/폴더 열기 (dataDir 내부만 허용) ──
  ipcMain.handle('file:openPath', async (_e, targetPath) => {
    try {
      if (typeof targetPath !== 'string' || !targetPath) {
        return { success: false, error: 'invalid path' };
      }
      const resolved = path.resolve(targetPath);
      const base = path.resolve(dataDir);
      if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return { success: false, error: 'path outside data dir' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: '경로가 존재하지 않습니다.' };
      }
      const err = await shell.openPath(resolved);
      if (err) return { success: false, error: err };
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

  ipcMain.handle('file:resolveJobPath', async (_e, date, vendor, sequence, fileName) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (
      typeof fileName !== 'string' ||
      fileName.includes('..') ||
      fileName.includes(path.sep) ||
      fileName.includes('/')
    ) {
      return { success: false, error: 'invalid filename' };
    }
    return {
      success: true,
      path: path.join(jobDir(dataDir, date, vendor, sequence), fileName),
    };
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

    // ── PO 다운로드 경로 지정 (Electron will-download 훅이 소비) ──
    // po_download.py 호출 시 --vendor / --date-from / --sequence 로부터
    // 저장 경로를 계산해 main 의 setPendingDownloadTarget 에 넘긴다.
    if (baseName.includes('po_download') && typeof setPendingDownloadTarget === 'function') {
      const vIdx = safeArgs.indexOf('--vendor');
      const dIdx = safeArgs.indexOf('--date-from');
      const sIdx = safeArgs.indexOf('--sequence');
      if (vIdx !== -1 && dIdx !== -1 && sIdx !== -1) {
        const v = safeArgs[vIdx + 1];
        const d = safeArgs[dIdx + 1];
        const s = parseInt(safeArgs[sIdx + 1], 10);
        if (isValidVendor(v) && isValidDate(d) && isValidSeq(s)) {
          const target = path.join(dataDir, d, v, String(s).padStart(2, '0'), 'po.csv');
          try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            setPendingDownloadTarget(target);
          } catch (err) {
            sendToRenderer('python:error', { line: `[system] target dir 생성 실패: ${err.message}` });
          }
        }
      }
    }

    // ── 밀크런 / 쉽먼트 서류 일괄 다운로드 경로 지정 (폴더 모드) ──
    // 호출 시 job 폴더 하위 downloads/{kind}-{ts}/ 로 저장.
    // {KIND}_DOWNLOAD_DIR 환경변수로 스크립트에도 전달.
    const docsDownloadMap = [
      { match: 'milkrun_docs_download',  kind: 'milkrun',  envKey: 'MILKRUN_DOWNLOAD_DIR' },
      { match: 'shipment_docs_download', kind: 'shipment', envKey: 'SHIPMENT_DOWNLOAD_DIR' },
    ];
    const docsEntry = docsDownloadMap.find((e) => baseName.includes(e.match));
    if (docsEntry && typeof setPendingDownloadDir === 'function') {
      const vIdx = safeArgs.indexOf('--vendor');
      const dIdx = safeArgs.indexOf('--date');
      const sIdx = safeArgs.indexOf('--sequence');
      if (vIdx !== -1 && dIdx !== -1 && sIdx !== -1) {
        const v = safeArgs[vIdx + 1];
        const d = safeArgs[dIdx + 1];
        const s = parseInt(safeArgs[sIdx + 1], 10);
        if (isValidVendor(v) && isValidDate(d) && isValidSeq(s)) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const folderName = `${docsEntry.kind}-${ts}`;
          const absDir = path.join(
            dataDir, d, v, String(s).padStart(2, '0'), 'downloads', folderName,
          );
          try {
            fs.mkdirSync(absDir, { recursive: true });
            setPendingDownloadDir(absDir);
            vendorEnv[docsEntry.envKey] = absDir;
          } catch (err) {
            sendToRenderer('python:error', { line: `[system] download dir 생성 실패: ${err.message}` });
          }
        }
      }
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
      activeScriptName = baseName;

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
          activeScriptName = null;
        }

        // 폴더 모드 다운로드 해제 (밀크런 서류 일괄 등)
        if (typeof setPendingDownloadDir === 'function') {
          setPendingDownloadDir(null);
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
          activeScriptName = null;
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
      scriptName: activeScriptName,
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

  // ── 재고조정 서브 창 제어 ──────────────────────────────────
  ipcMain.handle('stockAdjust:open', async (_e, date, vendor, sequence, options) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (typeof openStockAdjustWindow !== 'function') {
      return { success: false, error: 'openStockAdjustWindow not wired' };
    }
    const variant = typeof options?.variant === 'string' && /^[a-z0-9-]{1,30}$/.test(options.variant)
      ? options.variant : null;
    openStockAdjustWindow({ date, vendor, sequence, variant });
    return { success: true };
  });

  ipcMain.handle('stockAdjust:close', async (e) => {
    try {
      const win = require('electron').BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) win.close();
    } catch { /* 무시 */ }
    return { success: true };
  });

  ipcMain.handle('stockAdjust:getLocks', async () => {
    return {
      lockedJobKeys: typeof getLockedJobKeys === 'function' ? getLockedJobKeys() : [],
      locks: typeof getLockedJobsByType === 'function' ? getLockedJobsByType() : {},
    };
  });

  /**
   * stockAdjust:load — po.xlsx 를 읽어 SKU 바코드별로 그룹핑한 결과를 반환.
   * 각 행에는 원본 xlsx 의 rowIndex (헤더 포함 0-based) 가 포함되어 save 에서 활용.
   */
  ipcMain.handle('stockAdjust:load', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const poPath = path.join(jobDir(dataDir, date, vendor, sequence), 'po.xlsx');
    if (!fs.existsSync(poPath)) {
      return { success: false, error: `po.xlsx 가 없습니다: ${poPath}` };
    }
    try {
      const wb = XLSX.readFile(poPath, { cellDates: false, cellStyles: false });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const { rows } = parsePoAoa(aoa);

      // sku_barcode 기준 그룹 — 없으면 sku_id 로 fallback
      const byKey = new Map();
      for (const r of rows) {
        const k = String(r.sku_barcode || r.sku_id || '');
        if (!byKey.has(k)) {
          byKey.set(k, {
            sku_barcode: r.sku_barcode || '',
            sku_id: r.sku_id || '',
            sku_name: r.sku_name || '',
            total_order_qty: 0,
            rows: [],
          });
        }
        const g = byKey.get(k);
        const orderQty = Number(r.order_quantity) || 0;
        g.total_order_qty += orderQty;
        g.rows.push({
          rowIndex: r.rowIndex,
          coupang_order_seq: String(r.coupang_order_seq ?? ''),
          departure_warehouse: String(r.departure_warehouse ?? ''),
          order_quantity: orderQty,
          confirmed_qty: r.confirmed_qty === '' || r.confirmed_qty == null
            ? orderQty
            : Number(r.confirmed_qty) || 0,
        });
      }
      // 바코드(혹은 SKU) 정렬
      const groups = Array.from(byKey.values()).sort((a, b) =>
        String(a.sku_barcode || a.sku_id).localeCompare(String(b.sku_barcode || b.sku_id))
      );
      return { success: true, groups };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * stockAdjust:save — patches 배열을 받아 po.xlsx 의 확정수량 셀을 덮어쓴다.
   * patches: [{ rowIndex, confirmed_qty }]
   * rowIndex 는 sheet_to_json({header:1}) 기준 (헤더 포함 0-based).
   */
  ipcMain.handle('stockAdjust:save', async (_e, date, vendor, sequence, patches) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (!Array.isArray(patches)) {
      return { success: false, error: 'patches must be array' };
    }
    const poPath = path.join(jobDir(dataDir, date, vendor, sequence), 'po.xlsx');
    if (!fs.existsSync(poPath)) {
      return { success: false, error: `po.xlsx 가 없습니다: ${poPath}` };
    }
    try {
      const wb = XLSX.readFile(poPath, { cellDates: false, cellStyles: true });
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!aoa.length) return { success: false, error: '빈 시트' };

      const headerRow = aoa[0] || [];
      const colIdx = findConfirmedQtyColIndex(headerRow);
      if (colIdx < 0) {
        return { success: false, error: "'확정수량' 열을 찾지 못했습니다." };
      }

      let applied = 0;
      for (const p of patches) {
        if (!p || !Number.isInteger(p.rowIndex) || p.rowIndex < 1) continue;
        const qty = Number(p.confirmed_qty);
        if (!Number.isFinite(qty) || qty < 0) continue;
        const addr = XLSX.utils.encode_cell({ r: p.rowIndex, c: colIdx });
        ws[addr] = { t: 'n', v: qty, w: String(qty) };
        applied += 1;
      }

      // ref 재계산 — row 가 늘어나진 않지만 열이 추가됐을 때 안전
      if (ws['!ref']) {
        const range = XLSX.utils.decode_range(ws['!ref']);
        if (range.e.c < colIdx) {
          range.e.c = colIdx;
          ws['!ref'] = XLSX.utils.encode_range(range);
        }
      }

      XLSX.writeFile(wb, poPath, { bookType: 'xlsx' });

      // 저장 직후 po-tbnws.xlsx / confirmation.xlsx 도 자동 동기화.
      // aoa 에서 복합키(발주번호|물류센터|SKU바코드) 와 확정수량을 뽑아서 sync.
      try {
        const headerNames = headerRow.map((h) => String(h).trim());
        const findIdx = (names) => {
          for (const n of names) {
            const i = headerNames.indexOf(n);
            if (i >= 0) return i;
          }
          return -1;
        };
        const iOrder   = findIdx(['발주번호', '주문번호']);
        const iWh      = findIdx(['물류센터']);
        const iBarcode = findIdx(['상품바코드', 'SKU Barcode', 'SKU Barcode ', 'SKU 바코드']);
        const iOrderQ  = findIdx(['발주수량']);
        if (iOrder >= 0 && iWh >= 0 && iBarcode >= 0) {
          const reason = loadDefaultShortageReason(vendor);
          const syncPatches = [];
          for (const p of patches) {
            if (!Number.isInteger(p?.rowIndex) || p.rowIndex < 1) continue;
            const row = aoa[p.rowIndex];
            if (!row) continue;
            const order    = String(row[iOrder] ?? '').trim();
            const wh       = String(row[iWh] ?? '').trim();
            const barcode  = String(row[iBarcode] ?? '').trim();
            if (!order || !wh || !barcode) continue;
            const qty = Number(p.confirmed_qty);
            const orderQ = iOrderQ >= 0 ? (Number(row[iOrderQ]) || 0) : 0;
            syncPatches.push({
              key: `${order}|${wh}|${barcode}`,
              confirmedQty: String(qty),
              shortageReason: (orderQ > 0 && qty < orderQ) ? reason : '',
            });
          }
          if (syncPatches.length > 0) {
            await syncConfirmedQtyAcrossFiles(date, vendor, sequence, syncPatches);
          }
        }
      } catch (syncErr) {
        // sync 실패는 로그만 — po.xlsx 저장 자체는 성공.
        // eslint-disable-next-line no-console
        console.warn('[stockAdjust:save] cross-sync 실패', syncErr.message);
      }

      return { success: true, applied };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── 운송 분배 서브 창 ──────────────────────────────────────
  ipcMain.handle('transport:open', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (typeof openTransportWindow !== 'function') {
      return { success: false, error: 'openTransportWindow not wired' };
    }
    openTransportWindow({ date, vendor, sequence });
    return { success: true };
  });

  ipcMain.handle('transport:close', async (e) => {
    try {
      const win = require('electron').BrowserWindow.fromWebContents(e.sender);
      if (win && !win.isDestroyed()) win.close();
    } catch { /* 무시 */ }
    return { success: true };
  });

  /**
   * transport:load — confirmation.xlsx 를 읽어 "밀크런" 행만 물류센터별로 그룹핑.
   * 각 그룹에 벤더설정 기본값 + 이미 저장된 transport.json 을 병합한 초기값을 얹어 반환.
   */
  ipcMain.handle('transport:load', async (_e, date, vendor, sequence) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    const dir = jobDir(dataDir, date, vendor, sequence);
    const confPath = path.join(dir, 'confirmation.xlsx');
    if (!fs.existsSync(confPath)) {
      return { success: false, error: '발주확정서(confirmation.xlsx) 가 아직 없습니다. 먼저 생성하세요.' };
    }
    try {
      const wb = XLSX.readFile(confPath, { cellDates: false, cellStyles: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!aoa.length) return { success: false, error: '빈 시트' };

      const header = aoa[0] || [];
      const col = {};
      header.forEach((h, i) => {
        const label = String(h ?? '').trim();
        col[label] = i;
      });
      const iOrder = col['발주번호'];
      const iWh = col['물류센터'];
      const iType = col['입고유형'];
      const iSkuId = col['상품번호'];
      const iBarcode = col['상품바코드'];
      const iName = col['상품이름'];
      const iQty = col['확정수량'];
      if (iWh == null || iType == null) {
        return { success: false, error: '필수 열(물류센터/입고유형) 을 찾지 못했습니다.' };
      }

      // 물류센터별 그룹 — 확정수량 > 0 인 SKU 만 (0 은 납품 제외 행)
      const byWh = new Map();
      for (let r = 1; r < aoa.length; r += 1) {
        const row = aoa[r] || [];
        const wh = String(row[iWh] ?? '').trim();
        if (!wh) continue;
        const confirmedQty = Number(row[iQty]) || 0;
        if (confirmedQty <= 0) continue; // 납품 제외 SKU 숨김
        const type = String(row[iType] ?? '').trim();
        if (!byWh.has(wh)) {
          byWh.set(wh, {
            warehouse: wh,
            total_confirmed: 0,
            defaultType: type,          // 첫 행의 입고유형을 default 로
            skus: [],
          });
        }
        const g = byWh.get(wh);
        g.total_confirmed += confirmedQty;
        g.skus.push({
          rowIndex: r,
          rowKey: `${String(row[iOrder] ?? '')}|${String(row[iBarcode] ?? '')}|${r}`,
          coupang_order_seq: String(row[iOrder] ?? ''),
          sku_id: String(row[iSkuId] ?? ''),
          sku_barcode: String(row[iBarcode] ?? ''),
          sku_name: String(row[iName] ?? ''),
          confirmed_qty: confirmedQty,
        });
      }

      // 기본값 병합 — 전역 settings + 벤더 override
      let defaults = {};
      try {
        if (fs.existsSync(path.join(dataDir, 'settings.json'))) {
          const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf-8'));
          defaults = s.settings || {};
        }
      } catch { /* 무시 */ }
      let vendorOverrides = {};
      try {
        if (fs.existsSync(path.join(dataDir, 'vendors.json'))) {
          const v = JSON.parse(fs.readFileSync(path.join(dataDir, 'vendors.json'), 'utf-8'));
          const entry = (v.vendors || []).find((x) => x.id === vendor);
          vendorOverrides = entry?.settings || {};
        }
      } catch { /* 무시 */ }
      const pick = (k) => {
        const ov = vendorOverrides[k];
        if (ov !== undefined && ov !== '') return ov;
        return defaults[k] ?? '';
      };
      const rawInvoices = String(pick('shipmentFakeInvoices') || '');
      const fakeInvoices = rawInvoices
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .slice(0, 9);
      const defTransport = {
        originId:     pick('transportOrigin'),
        rentalId:     pick('transportRental'),
        totalBoxes:   pick('transportBoxes'),
        palletCount:  pick('transportPallets'),
        palletWidth:  pick('transportPalletWidth'),
        palletHeight: pick('transportPalletHeight'),
        palletDepth:  pick('transportPalletDepth'),
        fakeInvoices,
      };

      const originList = Array.isArray(defaults.transportOriginList) ? defaults.transportOriginList : [];
      const rentalList = Array.isArray(defaults.transportRentalList) ? defaults.transportRentalList : [];

      // 기존 저장값 로드
      let saved = {};
      const transportPath = path.join(dir, 'transport.json');
      try {
        if (fs.existsSync(transportPath)) {
          const j = JSON.parse(fs.readFileSync(transportPath, 'utf-8'));
          saved = j.assignments || {};
        }
      } catch { /* 무시 */ }

      const defaultTypeFallback = defaults.defaultTransport || '쉽먼트';

      const defaultPallet = () => ({
        width:    defTransport.palletWidth  ?? '',
        height:   defTransport.palletHeight ?? '',
        depth:    defTransport.palletDepth  ?? '',
        count:    defTransport.palletCount  ?? '',
        rentalId: defTransport.rentalId     ?? '',
      });

      const groups = Array.from(byWh.values())
        .sort((a, b) => a.warehouse.localeCompare(b.warehouse))
        .map((g) => {
          const s = saved[g.warehouse] || {};
          const transportType = s.transportType ?? g.defaultType ?? defaultTypeFallback;
          return {
            warehouse: g.warehouse,
            total_confirmed: g.total_confirmed,
            skus: g.skus,
            assignment: {
              transportType,

              // 쉽먼트 전용
              boxCount:    s.boxCount    ?? 0,
              skuBoxes:    s.skuBoxes    || {},
              boxInvoices: Array.isArray(s.boxInvoices) ? s.boxInvoices : [],

              // 밀크런 전용
              originId:   s.originId   ?? defTransport.originId,
              totalBoxes: s.totalBoxes ?? defTransport.totalBoxes,
              pallets:    Array.isArray(s.pallets) && s.pallets.length
                ? s.pallets
                : [defaultPallet()],
              skuNotes:   s.skuNotes   || {},
            },
          };
        });

      return { success: true, groups, defaults: defTransport, originList, rentalList };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * transport:save — 물류센터별 assignment 를 transport.json 에 저장.
   * assignments: { [warehouse]: { origin, boxes, weight, pallets } }
   */
  ipcMain.handle('transport:save', async (_e, date, vendor, sequence, assignments) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (!assignments || typeof assignments !== 'object') {
      return { success: false, error: 'assignments must be object' };
    }
    try {
      const dir = jobDir(dataDir, date, vendor, sequence);
      fs.mkdirSync(dir, { recursive: true });
      const transportPath = path.join(dir, 'transport.json');
      const payload = {
        schemaVersion: 3,
        updatedAt: new Date().toISOString(),
        assignments,
      };
      fs.writeFileSync(transportPath, JSON.stringify(payload, null, 2), 'utf-8');

      // confirmation.xlsx 의 입고유형(C) 컬럼을 물류센터별 transportType 으로 in-place 패치.
      // 다른 셀(확정수량/납품부족사유 등 사용자 편집)은 보존.
      let confirmationPatched = 0;
      const confPath = path.join(dir, 'confirmation.xlsx');
      if (fs.existsSync(confPath)) {
        try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.readFile(confPath);
          const ws = wb.getWorksheet('상품목록') || wb.worksheets[0];
          if (ws) {
            let iWh = null;
            let iType = null;
            ws.getRow(1).eachCell((cell, col) => {
              const v = String(cell.value ?? '').trim();
              if (v === '물류센터') iWh = col;
              if (v === '입고유형') iType = col;
            });
            if (iWh && iType) {
              const last = ws.actualRowCount || ws.rowCount;
              for (let r = 2; r <= last; r += 1) {
                const wh = String(ws.getCell(r, iWh).value ?? '').trim();
                if (!wh) continue;
                const a = assignments[wh];
                if (a && a.transportType) {
                  ws.getCell(r, iType).value = a.transportType;
                  confirmationPatched += 1;
                }
              }
              if (confirmationPatched > 0) {
                await wb.xlsx.writeFile(confPath);
              }
            }
          }
        } catch (err) {
          // 패치 실패는 transport 저장 자체를 실패로 만들지 않음 — 로그만
          console.warn('[transport:save] confirmation 입고유형 패치 실패:', err.message);
        }
      }

      return { success: true, path: transportPath, confirmationPatched };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * 단일 xlsx 파일에서 복합키(발주번호|물류센터|SKU바코드) 매칭 후
   * 확정수량(+선택적으로 납품부족사유) 를 in-place 패치.
   *
   * 확정수량 컬럼만 있는 파일(po.xlsx / po-tbnws.xlsx) 과 납품부족사유까지 있는
   * 확정서(confirmation.xlsx) 양쪽 모두 처리. 컬럼 이름은 바리에이션 모두 수용.
   *
   * @returns {{ success: true, skipped?: true, patched?: number, unmatched?: string[] } | { success: false, error: string }}
   */
  async function patchConfirmedQtyInFile(filePath, patches, opts = {}) {
    if (!fs.existsSync(filePath)) {
      return { success: true, skipped: true, patched: 0, unmatched: [] };
    }
    const byKey = new Map();
    for (const p of patches) {
      if (p && typeof p.key === 'string') byKey.set(p.key, p);
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = opts.sheetName
      ? (wb.getWorksheet(opts.sheetName) || wb.worksheets[0])
      : wb.worksheets[0];
    if (!ws) return { success: false, error: `시트 없음: ${path.basename(filePath)}` };

    let iOrder = null;
    let iWh = null;
    let iBarcode = null;
    let iQty = null;
    let iReason = null;
    ws.getRow(1).eachCell((cell, col) => {
      const v = String(cell.value ?? '').trim();
      if (v === '발주번호' || v === '주문번호') iOrder = col;
      else if (v === '물류센터') iWh = col;
      else if (v === '상품바코드' || v === 'SKU Barcode' || v === 'SKU Barcode ' || v === 'SKU 바코드') iBarcode = col;
      else if (v === '확정수량') iQty = col;
      else if (v === '납품부족사유') iReason = col;
    });
    if (!iOrder || !iWh || !iBarcode || !iQty) {
      return { success: false, error: `필수 컬럼 없음: ${path.basename(filePath)}` };
    }

    const last = ws.actualRowCount || ws.rowCount;
    let patched = 0;
    const matchedKeys = new Set();
    for (let r = 2; r <= last; r += 1) {
      const order = String(ws.getCell(r, iOrder).value ?? '').trim();
      const wh = String(ws.getCell(r, iWh).value ?? '').trim();
      const barcode = String(ws.getCell(r, iBarcode).value ?? '').trim();
      if (!order || !wh || !barcode) continue;
      const key = `${order}|${wh}|${barcode}`;
      const p = byKey.get(key);
      if (!p) continue;
      ws.getCell(r, iQty).value = String(p.confirmedQty ?? '');
      if (iReason && p.shortageReason !== undefined) {
        ws.getCell(r, iReason).value = String(p.shortageReason ?? '');
      }
      matchedKeys.add(key);
      patched += 1;
    }

    if (patched > 0) {
      await wb.xlsx.writeFile(filePath);
    }
    const unmatched = [];
    for (const k of byKey.keys()) if (!matchedKeys.has(k)) unmatched.push(k);
    return { success: true, patched, unmatched };
  }

  /** 파일 갱신 이벤트 broadcast — main + popup 윈도우 전부에게 */
  function broadcastFileUpdated(payload) {
    try {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send('job:file-updated', payload);
    } catch {}
    for (const ch of BrowserWindow.getAllWindows()) {
      try {
        if (ch && !ch.isDestroyed()) ch.webContents.send('job:file-updated', payload);
      } catch {}
    }
  }

  /**
   * 세 파일(po.xlsx / po-tbnws.xlsx / confirmation.xlsx) 에 동시에 확정수량 patch.
   * 파일 없으면 skip, 있으면 patch + 이벤트 broadcast.
   *
   * opts.excludeFiles: 특정 파일을 skip. "방금 직접 쓴 파일" 은 제외해서
   * sheetJS ↔ ExcelJS 이중 write 로 인한 스타일 손실·구조 손상을 방지.
   */
  async function syncConfirmedQtyAcrossFiles(date, vendor, sequence, patches, opts = {}) {
    const dir = jobDir(dataDir, date, vendor, sequence);
    const exclude = new Set(Array.isArray(opts.excludeFiles) ? opts.excludeFiles : []);
    const targets = [
      { file: 'po.xlsx',           path: path.join(dir, 'po.xlsx'),           sheetName: null },
      { file: 'po-tbnws.xlsx',     path: path.join(dir, 'po-tbnws.xlsx'),     sheetName: null },
      { file: 'confirmation.xlsx', path: path.join(dir, 'confirmation.xlsx'), sheetName: '상품목록' },
    ];
    const results = {};
    for (const t of targets) {
      if (exclude.has(t.file)) {
        results[t.file] = { success: true, skipped: true, excluded: true, patched: 0 };
        continue;
      }
      try {
        const r = await patchConfirmedQtyInFile(t.path, patches, { sheetName: t.sheetName });
        results[t.file] = r;
        if (r.success && !r.skipped && (r.patched || 0) > 0) {
          broadcastFileUpdated({ date, vendor, sequence, file: t.file, patched: r.patched });
        }
      } catch (err) {
        results[t.file] = { success: false, error: err.message };
      }
    }
    return { success: true, results };
  }

  /** 벤더 > 전역 순서로 defaultShortageReason 조회 */
  function loadDefaultShortageReason(vendor) {
    const HARD_DEFAULT = '협력사 재고부족 - 수입상품 입고지연 (선적/통관지연)';
    let defaultVal = HARD_DEFAULT;
    try {
      const sp = path.join(dataDir, 'settings.json');
      if (fs.existsSync(sp)) {
        const s = JSON.parse(fs.readFileSync(sp, 'utf-8'));
        if (s?.settings?.defaultShortageReason) defaultVal = s.settings.defaultShortageReason;
      }
      const vp = path.join(dataDir, 'vendors.json');
      if (fs.existsSync(vp)) {
        const v = JSON.parse(fs.readFileSync(vp, 'utf-8'));
        const meta = (v?.vendors || []).find((x) => x.id === vendor);
        const vr = meta?.settings?.defaultShortageReason;
        if (vr) return vr;
      }
    } catch {}
    return defaultVal;
  }

  /**
   * confirmation:patchQuantities — confirmation.xlsx 만 patch (기존 호환).
   * 새 호출자는 가능하면 confirmedQty:sync 를 사용해 세 파일 동시 갱신 권장.
   *
   * 매칭 키: 발주번호|물류센터|상품바코드
   * patches: Array<{ key: string, confirmedQty: string, shortageReason: string }>
   */
  ipcMain.handle('confirmation:patchQuantities', async (_e, date, vendor, sequence, patches) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (!Array.isArray(patches)) {
      return { success: false, error: 'patches must be array' };
    }
    const dir = jobDir(dataDir, date, vendor, sequence);
    const confPath = path.join(dir, 'confirmation.xlsx');
    if (!fs.existsSync(confPath)) {
      return { success: false, error: 'confirmation.xlsx 가 없습니다.' };
    }
    try {
      const res = await patchConfirmedQtyInFile(confPath, patches, { sheetName: '상품목록' });
      if (!res.success) return res;
      broadcastFileUpdated({
        date, vendor, sequence, file: 'confirmation.xlsx', patched: res.patched,
      });
      return res;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /**
   * confirmedQty:sync — po.xlsx / po-tbnws.xlsx / confirmation.xlsx 3 파일을 동시에
   * 복합키 기반으로 확정수량(+confirmation 은 납품부족사유) patch. 파일이 없으면 skip.
   *
   * 한 저장 경로에서 한 번만 호출하면 나머지 파일들이 동기화됨.
   * 각 파일마다 'job:file-updated' 이벤트를 발송 → 렌더러가 자동 재로드.
   */
  ipcMain.handle('confirmedQty:sync', async (_e, date, vendor, sequence, patches, opts) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (!Array.isArray(patches)) {
      return { success: false, error: 'patches must be array' };
    }
    return await syncConfirmedQtyAcrossFiles(date, vendor, sequence, patches, opts || {});
  });

  /**
   * po-tbnws.xlsx 의 '반출수량' 컬럼만 복합키(발주번호|물류센터|SKU바코드) 로 patch.
   * confirmedQty 와 별도 필드라 sync 에 포함되지 않음.
   *
   * patches: Array<{ key: string, value: number }>
   */
  async function patchFulfillExportInFile(filePath, patches) {
    if (!fs.existsSync(filePath)) {
      return { success: true, skipped: true, patched: 0 };
    }
    const byKey = new Map();
    for (const p of patches) {
      if (p && typeof p.key === 'string') byKey.set(p.key, p);
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.worksheets[0];
    if (!ws) return { success: false, error: `시트 없음: ${path.basename(filePath)}` };

    let iOrder = null;
    let iWh = null;
    let iBarcode = null;
    let iExport = null;
    ws.getRow(1).eachCell((cell, col) => {
      const v = String(cell.value ?? '').trim();
      if (v === '발주번호' || v === '주문번호') iOrder = col;
      else if (v === '물류센터') iWh = col;
      else if (v === '상품바코드' || v === 'SKU Barcode' || v === 'SKU Barcode ' || v === 'SKU 바코드') iBarcode = col;
      else if (v === '반출수량') iExport = col;
    });
    if (!iOrder || !iWh || !iBarcode || !iExport) {
      return { success: false, error: `반출수량 관련 컬럼 못 찾음: ${path.basename(filePath)}` };
    }

    const last = ws.actualRowCount || ws.rowCount;
    let patched = 0;
    for (let r = 2; r <= last; r += 1) {
      const order = String(ws.getCell(r, iOrder).value ?? '').trim();
      const wh = String(ws.getCell(r, iWh).value ?? '').trim();
      const barcode = String(ws.getCell(r, iBarcode).value ?? '').trim();
      if (!order || !wh || !barcode) continue;
      const key = `${order}|${wh}|${barcode}`;
      const p = byKey.get(key);
      if (!p) continue;
      ws.getCell(r, iExport).value = Number(p.value) || 0;
      patched += 1;
    }
    if (patched > 0) await wb.xlsx.writeFile(filePath);
    return { success: true, patched };
  }

  ipcMain.handle('poTbnws:patchFulfillExport', async (_e, date, vendor, sequence, patches) => {
    if (!isValidDate(date) || !isValidVendor(vendor) || !isValidSeq(sequence)) {
      return { success: false, error: 'invalid args' };
    }
    if (!Array.isArray(patches)) {
      return { success: false, error: 'patches must be array' };
    }
    const target = path.join(jobDir(dataDir, date, vendor, sequence), 'po-tbnws.xlsx');
    try {
      const res = await patchFulfillExportInFile(target, patches);
      if (res.success && !res.skipped && (res.patched || 0) > 0) {
        broadcastFileUpdated({
          date, vendor, sequence, file: 'po-tbnws.xlsx', patched: res.patched,
        });
      }
      return res;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIpcHandlers, detectPython, resetPythonCache };
