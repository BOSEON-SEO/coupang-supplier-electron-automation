/**
 * 라이선스 검증 + 캐시 (v1).
 *
 * 데이터 모델: { id, serial, valid, expiredAt, entitlements[], lastVerifiedAt }
 *   - 합의 (memory: project_licensing_plan): JWT 서명·디바이스 바인딩·오프라인
 *     허용일수는 v1 범위 밖. 단순 캐시 + 만료 체크만.
 *   - schemaVersion 으로 후방호환 여지만 확보.
 *
 * 검증 흐름:
 *   1. 첫 실행: 사용자 시리얼 입력 → verifyOnline() → 응답 캐시 저장
 *   2. 매 실행: license.json 읽음 → 만료 체크
 *   3. 만료 임박(N일 이내): 백그라운드 재검증 시도
 *   4. 만료/없음: renderer 가 LicenseGate 띄우고 입력 받음
 *
 * Supabase 호출은 verifyOnline 안에 isolate. 환경변수 없으면 dev stub
 * (시리얼 'DEV-' 접두어면 통과). 나중에 fetch 로 교체할 때 함수 본문만 변경.
 */

const fs = require('fs');
const path = require('path');

const LICENSE_FILE = 'license.json';
const SCHEMA_VERSION = 1;
const NEAR_EXPIRY_DAYS = 7;

/**
 * @typedef {Object} LicenseRecord
 * @property {number} schemaVersion
 * @property {string} id           — 발급 식별자
 * @property {string} serial       — 사용자 입력 시리얼
 * @property {boolean} valid
 * @property {string|null} expiredAt        — ISO datetime
 * @property {string[]} entitlements
 * @property {string} lastVerifiedAt        — ISO datetime
 * @property {string|null} lastError
 */

function licensePath(dataDir) {
  return path.join(dataDir, LICENSE_FILE);
}

/** @returns {LicenseRecord | null} */
function readLicense(dataDir) {
  const p = licensePath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (err) {
    console.warn('[license] readLicense 실패', err.message);
    return null;
  }
}

function writeLicense(dataDir, rec) {
  const p = licensePath(dataDir);
  const out = {
    schemaVersion: SCHEMA_VERSION,
    ...rec,
  };
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf-8');
}

function clearLicense(dataDir) {
  const p = licensePath(dataDir);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function isExpired(rec, now = Date.now()) {
  if (!rec || !rec.expiredAt) return false;
  const t = Date.parse(rec.expiredAt);
  if (!Number.isFinite(t)) return false;
  return t < now;
}

function isNearExpiry(rec, now = Date.now(), days = NEAR_EXPIRY_DAYS) {
  if (!rec || !rec.expiredAt) return false;
  const t = Date.parse(rec.expiredAt);
  if (!Number.isFinite(t)) return false;
  const ms = days * 24 * 60 * 60 * 1000;
  return t - now < ms && t - now > 0;
}

/** 마스킹된 serial — 끝 4자리만 노출. UI 표시용. */
function maskSerial(serial) {
  if (!serial || typeof serial !== 'string') return '';
  if (serial.length <= 4) return '*'.repeat(serial.length);
  return '*'.repeat(serial.length - 4) + serial.slice(-4);
}

/**
 * 현재 라이선스 상태 + entitlements 를 renderer 에 보낼 dto.
 * serial 은 항상 마스킹.
 *
 * status:
 *   'unlicensed' — 파일 없음
 *   'valid'      — 정상 + 만료 전
 *   'near-expiry'— 만료 임박 (정상이지만 재검증 권장)
 *   'expired'    — 만료
 *   'invalid'    — valid=false 로 캐시됨 (verify 실패)
 */
function statusOf(rec, now = Date.now()) {
  if (!rec) return 'unlicensed';
  if (!rec.valid) return 'invalid';
  if (isExpired(rec, now)) return 'expired';
  if (isNearExpiry(rec, now)) return 'near-expiry';
  return 'valid';
}

function toDto(rec, now = Date.now()) {
  if (!rec) {
    return {
      status: 'unlicensed',
      id: null, serial: null,
      expiredAt: null, entitlements: [],
      lastVerifiedAt: null, lastError: null,
    };
  }
  return {
    status: statusOf(rec, now),
    id: rec.id || null,
    serial: maskSerial(rec.serial),
    expiredAt: rec.expiredAt || null,
    entitlements: Array.isArray(rec.entitlements) ? rec.entitlements.slice() : [],
    lastVerifiedAt: rec.lastVerifiedAt || null,
    lastError: rec.lastError || null,
  };
}

/**
 * 온라인 검증 — 우선 stub.
 *
 * env SUPABASE_URL + SUPABASE_ANON_KEY 가 채워지면 실 fetch 로 교체할 자리.
 * 그 전까지 dev 환경에서 시리얼 'DEV-' 접두어면 1년짜리 통과.
 *
 * 응답 shape (계약 고정):
 *   { valid: boolean, expiredAt: string|null, entitlements: string[], error?: string }
 *
 * @param {{id:string, serial:string}} args
 */
async function verifyOnline({ id, serial }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // dev stub — Supabase 미설정 환경에서 개발/테스트용.
    if (typeof serial === 'string' && serial.startsWith('DEV-')) {
      const expiredAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      return {
        valid: true,
        expiredAt,
        entitlements: ['core', 'tbnws.plugin'],
      };
    }
    return {
      valid: false,
      expiredAt: null,
      entitlements: [],
      error: 'Supabase 환경변수 미설정. DEV- 접두어 시리얼만 통과 (개발용).',
    };
  }

  // 실 Supabase Edge Function 호출.
  // 응답 shape: { valid, expiredAt, entitlements, error? } — Edge Function
  // 이 이미 같은 shape 을 그대로 돌려주므로 추가 매핑 불필요.
  // docs/license-supabase.md 참고.
  const url = `${String(supabaseUrl).replace(/\/$/, '')}/functions/v1/license-verify`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ id, serial }),
      // 네트워크 hang 회피용 timeout — AbortSignal.timeout 은 Node 18+.
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(15000)
        : undefined,
    });
    let data;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      return {
        valid: false,
        expiredAt: null,
        entitlements: [],
        error: data?.error || `HTTP ${res.status}`,
      };
    }
    return {
      valid: !!data?.valid,
      expiredAt: data?.expiredAt || null,
      entitlements: Array.isArray(data?.entitlements) ? data.entitlements : [],
      error: data?.error || null,
    };
  } catch (err) {
    return {
      valid: false,
      expiredAt: null,
      entitlements: [],
      error: `네트워크 오류: ${err.message || String(err)}`,
    };
  }
}

/**
 * activate — 사용자 시리얼 입력 받아 검증 + 저장.
 *
 * 검증 성공이면 license.json 에 저장하고 dto 반환.
 * 실패 시에도 lastError 캐시 (같은 시리얼 재시도 방지 용도는 아니고, UI 표시용).
 */
async function activate(dataDir, { id, serial }) {
  const safeId = String(id || '').trim();
  const safeSerial = String(serial || '').trim();
  if (!safeId || !safeSerial) {
    return { success: false, error: '발급 ID 와 시리얼이 모두 필요합니다.' };
  }
  let result;
  try {
    result = await verifyOnline({ id: safeId, serial: safeSerial });
  } catch (err) {
    return { success: false, error: `검증 호출 실패: ${err.message || String(err)}` };
  }

  const now = new Date().toISOString();
  const rec = {
    id: safeId,
    serial: safeSerial,
    valid: !!result.valid,
    expiredAt: result.expiredAt || null,
    entitlements: Array.isArray(result.entitlements) ? result.entitlements : [],
    lastVerifiedAt: now,
    lastError: result.error || null,
  };
  writeLicense(dataDir, rec);
  return {
    success: !!result.valid,
    error: result.valid ? null : (result.error || '검증 실패'),
    license: toDto(rec),
  };
}

/**
 * reverify — 캐시된 시리얼로 재검증. 사용자 입력 없이 진행.
 * near-expiry 시 자동 호출 또는 SettingsView 의 "재검증" 버튼.
 */
async function reverify(dataDir) {
  const rec = readLicense(dataDir);
  if (!rec || !rec.id || !rec.serial) {
    return { success: false, error: '캐시된 라이선스가 없습니다.' };
  }
  return activate(dataDir, { id: rec.id, serial: rec.serial });
}

/** main process 부팅 시 한 번 호출 — 캐시만 read + dto 생성. 온라인 호출 안 함. */
function getCachedDto(dataDir) {
  return toDto(readLicense(dataDir));
}

/**
 * IPC 등록.
 *
 *   license:get      → 현재 dto
 *   license:activate → (id, serial) 으로 검증 + 저장
 *   license:reverify → 캐시 시리얼로 재검증
 *   license:clear    → license.json 삭제 (dev/디바이스 이전용)
 *
 * 어떤 변경이 있을 때마다 'license-changed' 이벤트를 모든 BrowserWindow 에
 * 브로드캐스트해 renderer 가 entitlements 를 즉시 갱신하도록.
 */
function registerLicenseIpc({ ipcMain, dataDir, broadcast }) {
  const fire = () => {
    if (typeof broadcast === 'function') {
      try { broadcast('license-changed', getCachedDto(dataDir)); } catch (_) { /* 무시 */ }
    }
  };

  ipcMain.handle('license:get', async () => {
    return { success: true, license: getCachedDto(dataDir) };
  });

  ipcMain.handle('license:activate', async (_e, payload) => {
    const res = await activate(dataDir, payload || {});
    fire();
    return res;
  });

  ipcMain.handle('license:reverify', async () => {
    const res = await reverify(dataDir);
    fire();
    return res;
  });

  ipcMain.handle('license:clear', async () => {
    try {
      clearLicense(dataDir);
      fire();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });
}

module.exports = {
  registerLicenseIpc,
  // 다른 모듈에서 직접 호출용 (renderer 가 부팅 시 첫 dto 만 가져갈 때 등)
  readLicense,
  writeLicense,
  clearLicense,
  getCachedDto,
  isExpired,
  isNearExpiry,
  statusOf,
  maskSerial,
  toDto,
  verifyOnline,
  activate,
  reverify,
  SCHEMA_VERSION,
};
