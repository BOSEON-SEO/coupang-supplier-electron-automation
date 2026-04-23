/**
 * TBNWS 플러그인 main-half — 사내 관리 백엔드 HTTP 호출.
 *
 * 설정값(apiBaseUrl, apiToken, category) 은 글로벌 settings.json 의
 * plugins.tbnws.* 경로에서 로드. 설정 변경은 renderer 의 'settings-changed'
 * 이벤트와 동기화되지 않으므로, 매 호출마다 settings.json 을 다시 읽음
 * (호출 빈도가 낮아 성능 이슈 없음).
 *
 * 외부 API 요청은 CommonJS 환경 + Electron Node 런타임에서 동작해야 하므로
 * `node-fetch` 대신 내장 `http(s)` 모듈 + FormData 는 직접 조립.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// settings.json 경로 — ipc-handlers 가 쓰는 것과 동일 위치 (registrar.dataDir).
function settingsPath(dataDir) {
  return path.join(dataDir, 'settings.json');
}

function readTbnwsSettings(dataDir) {
  try {
    const p = settingsPath(dataDir);
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    const all = parsed?.settings || {};
    return (all.plugins && all.plugins.tbnws) || {};
  } catch (err) {
    console.warn('[tbnws/main] settings 로드 실패', err.message);
    return {};
  }
}

/**
 * 엔드포인트 절대 URL 생성.
 * apiBaseUrl 이 host 만(https://api.tbnws.co.kr) 이든, host+/api(https://api.tbnws.co.kr/api)
 * 든, 어느 쪽이든 /api 가 정확히 한 번 포함된 URL 을 반환.
 *
 * @param {object} settings
 * @param {string} relPath  '/coupang/...' 처럼 /api 뒤에 올 상대 경로
 */
function apiUrl(settings, relPath) {
  const base = String(settings.apiBaseUrl || '')
    .replace(/\/+$/, '')      // 끝 슬래시 제거
    .replace(/\/api$/, '');   // 끝 /api 제거 (이미 포함 입력했어도 흡수)
  return `${base}/api${relPath}`;
}

/**
 * multipart/form-data 바디 생성.
 * @param {Array<{name: string, value: string | Buffer, filename?: string, contentType?: string}>} fields
 * @returns {{ body: Buffer, contentType: string }}
 */
function buildMultipart(fields) {
  const boundary = '----tbnws-' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  const CRLF = '\r\n';
  for (const f of fields) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}`));
    if (f.filename) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"${CRLF}` +
        `Content-Type: ${f.contentType || 'application/octet-stream'}${CRLF}${CRLF}`,
      ));
      chunks.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(String(f.value)));
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${f.name}"${CRLF}${CRLF}${f.value}`,
      ));
    }
    chunks.push(Buffer.from(CRLF));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * HTTP 요청. JSON 응답을 가정하고 파싱 시도, 실패 시 raw text 반환.
 * @param {string} urlStr
 * @param {object} opts  { method, headers, body, timeoutMs }
 * @returns {Promise<{ status: number, data: any, raw: string }>}
 */
function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const buf = [];
      res.on('data', (c) => buf.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(buf).toString('utf-8');
        let data = null;
        try { data = JSON.parse(raw); } catch { /* leave as null */ }
        resolve({ status: res.statusCode, data, raw });
      });
    });
    req.on('error', reject);
    if (opts.timeoutMs) req.setTimeout(opts.timeoutMs, () => {
      req.destroy(new Error(`request timeout ${opts.timeoutMs}ms`));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function authHeaders(settings) {
  const headers = {};
  if (settings.apiToken) headers.Authorization = `Bearer ${settings.apiToken}`;
  return headers;
}

module.exports = {
  id: 'tbnws',

  activate(registrar) {
    const disposables = [];

    /**
     * 쿠팡 PO xlsx 를 백엔드로 전송해 검증된 SKU 배열 받기.
     * 백엔드: POST /coupang/coupangList/coupangCheckForm (FormData: file + category)
     *
     * payload: { fileName: string, fileBuffer: ArrayBuffer | Uint8Array, category?: string }
     * 반환: { success: boolean, data?: any[], error?: string }
     */
    disposables.push(
      registrar.handle('po.checkForm', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const buffer = payload?.fileBuffer instanceof ArrayBuffer
          ? Buffer.from(payload.fileBuffer)
          : Buffer.from(payload?.fileBuffer || []);
        if (buffer.length === 0) {
          return { success: false, error: 'fileBuffer 가 비어있습니다.' };
        }
        // 백엔드 coupangCheckForm 은 file 만 받는다 (벤더 판정은 SKU 마스터에서 자동).
        const { body, contentType } = buildMultipart([
          {
            name: 'file',
            value: buffer,
            filename: payload?.fileName || 'po.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ]);
        const url = apiUrl(settings, '/coupang/coupangList/coupangCheckForm');
        try {
          const res = await request(url, {
            method: 'POST',
            headers: {
              'Content-Type': contentType,
              'Content-Length': body.length,
              ...authHeaders(settings),
            },
            body,
            timeoutMs: 60000,
          });
          if (res.status >= 200 && res.status < 300) {
            return { success: true, data: res.data ?? res.raw };
          }
          return {
            success: false,
            status: res.status,
            error: res.data?.message || res.raw?.slice(0, 300) || `HTTP ${res.status}`,
          };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      }),
    );

    /**
     * 풀필먼트 재고 동기화 — POST /api/fulfillment/product/refetch
     * Jenkins 배치 트리거 성격이라 응답 시간이 긴 편. timeout 5분.
     *
     * payload: 없음 (현재)
     * 반환: { success: boolean, data?: any, status?: number, error?: string }
     */
    disposables.push(
      registrar.handle('fulfillment.refetch', async () => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const url = apiUrl(settings, '/v1/fulfillment/product/refetch');
        try {
          const res = await request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': 0,
              ...authHeaders(settings),
            },
            timeoutMs: 5 * 60 * 1000,
          });
          if (res.status >= 200 && res.status < 300) {
            return { success: true, data: res.data ?? res.raw };
          }
          return {
            success: false,
            status: res.status,
            error: res.data?.message || res.raw?.slice(0, 300) || `HTTP ${res.status}`,
          };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      }),
    );

    // TODO: po.confirmSubmit (발주확정 업로드)
    // TODO: inbound.startWork / saveStep1 / saveStep2 / saveStep3
    // TODO: inbound.registerTempSchedule (출고예정)
    // TODO: inbound.eflexOutbound (eFlexs 반출)

    return () => { disposables.forEach((d) => d()); };
  },
};
