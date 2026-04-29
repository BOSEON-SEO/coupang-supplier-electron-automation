/**
 * 비밀값 저장소 — Electron `safeStorage` (Windows DPAPI) 로 암호화하여
 * `secrets.enc` (JSON of base64) 에 보관. 같은 OS 사용자만 복호화 가능.
 *
 * 키 컨벤션: 점 표기 dotted path. 예: 'plugins.tbnws.apiToken'.
 *
 * 호출 시점: app.whenReady 이후. 그 전엔 safeStorage 가 동작 안 함.
 */

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

let storePath = null;
let cache = null;

function init(dataDir) {
  storePath = path.join(dataDir, 'secrets.enc');
  cache = null; // lazy

  // 부팅 직후 settings.json 의 평문 비밀값을 자동 마이그레이션.
  // 설정 화면을 안 열어도 안전하게 이전됨.
  try {
    const settingsPath = path.join(dataDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.settings) data.settings = {};
    if (migrateSettings(data.settings)) {
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log('[secrets] settings.json 의 평문 비밀값을 secrets.enc 로 이전');
    }
  } catch (err) {
    console.warn('[secrets] 부팅 마이그레이션 실패:', err.message);
  }
}

function load() {
  if (cache !== null) return cache;
  if (!storePath || !fs.existsSync(storePath)) { cache = {}; return cache; }
  try {
    cache = JSON.parse(fs.readFileSync(storePath, 'utf-8')) || {};
  } catch { cache = {}; }
  return cache;
}

function persist() {
  if (!storePath) return;
  fs.writeFileSync(storePath, JSON.stringify(cache, null, 2), 'utf-8');
}

function getSecret(key) {
  if (!safeStorage.isEncryptionAvailable()) return '';
  const store = load();
  const b64 = store[key];
  if (!b64) return '';
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch { return ''; }
}

function setSecret(key, value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage 사용 불가 — OS 키체인 접근 실패');
  }
  const store = load();
  if (!value) delete store[key];
  else store[key] = safeStorage.encryptString(value).toString('base64');
  persist();
}

function hasSecret(key) {
  const store = load();
  return !!store[key];
}

/**
 * 키 목록 — 어디가 비밀이고 어디가 평문인지 한 곳에서 관리.
 * settings.json 의 dotted path 와 정확히 매칭. 신규 비밀 추가 시 여기만 갱신.
 */
const SECRET_KEYS = [
  'plugins.tbnws.apiToken',
];

const SECRET_PLACEHOLDER = '__SECRET_SET__';

function getNested(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function setNested(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function deleteNested(obj, dotted) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return;
    cur = cur[parts[i]];
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
}

/**
 * settings.json 의 비밀 필드를 암호화된 secrets.enc 로 이전 + settings 객체에서
 * 제거. settings:load 의 첫 호출 시 한 번 동작 (이미 평문이 있는 사용자 대비).
 * @returns true 면 settings.json 다시 써야 함
 */
function migrateSettings(settings) {
  let migrated = false;
  for (const k of SECRET_KEYS) {
    const cur = getNested(settings, k);
    if (typeof cur === 'string' && cur && cur !== SECRET_PLACEHOLDER) {
      setSecret(k, cur);
      deleteNested(settings, k);
      migrated = true;
    }
  }
  return migrated;
}

/**
 * settings 객체에서 비밀 필드를 빈 문자열로 마스킹 (renderer 노출용).
 * 이전엔 placeholder 문자열을 넣었으나 password 필드에서 사용자가 추가 입력 시
 * 합쳐지는 UX 버그가 있어 빈 문자열로 통일. UI 는 별도로 hasSecret 정보를 받아
 * "저장됨" 표시.
 */
function maskSettings(settings) {
  for (const k of SECRET_KEYS) {
    if (hasSecret(k)) setNested(settings, k, '');
  }
}

/**
 * renderer 가 settings:save 로 보낸 값에서 비밀 필드 추출 → secrets.enc 갱신.
 * 빈/undefined → 변경 없음 (사용자가 안 건드린 경우. 명시적 삭제는 별도 IPC 로).
 * 비어있지 않은 새 값 → setSecret. legacy placeholder 값도 변경 없음으로 처리.
 */
function applyAndStripSecrets(settings) {
  for (const k of SECRET_KEYS) {
    const val = getNested(settings, k);
    if (val === undefined || val === null || val === '' || val === SECRET_PLACEHOLDER) {
      deleteNested(settings, k); // 변경 없음
    } else if (typeof val === 'string') {
      setSecret(k, val);
      deleteNested(settings, k);
    }
  }
}

/**
 * settings:load 응답에 어느 키가 저장됐는지 알려주는 부가 정보 — UI 에서
 * "저장됨" 배지 표시용.
 */
function getSecretFlags() {
  const out = {};
  for (const k of SECRET_KEYS) out[k] = hasSecret(k);
  return out;
}

module.exports = {
  init,
  getSecret,
  setSecret,
  hasSecret,
  SECRET_KEYS,
  SECRET_PLACEHOLDER,
  migrateSettings,
  maskSettings,
  applyAndStripSecrets,
  getSecretFlags,
};
