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
const XLSX = require('xlsx');

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

/**
 * 바이너리 응답용 요청. 기존 request() 는 utf-8 toString 으로 xlsx 를 망가뜨리기 때문에 별도.
 * @returns {Promise<{ status: number, headers: object, body: Buffer }>}
 */
function requestBuffer(urlStr, opts = {}) {
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
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
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

/**
 * Content-Disposition 헤더에서 파일명 추출.
 * `filename*=UTF-8''...` 우선, 없으면 `filename="..."` 폴백.
 */
function parseFilenameFromCD(cd) {
  if (!cd) return null;
  const star = String(cd).match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* ignore */ }
  }
  const plain = String(cd).match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

module.exports = {
  id: 'tbnws',

  activate(registrar) {
    const disposables = [];

    /**
     * 쿠팡 PO xlsx 를 백엔드로 전송해 작업 생성 + 검증된 SKU 배열 받기.
     * 백엔드: POST /coupang/coupangList/inbound/startWork
     *
     * payload: {
     *   fileName: string,
     *   fileBuffer: ArrayBuffer | Uint8Array,
     *   inboundDate: 'YYYY-MM-DD',
     *   category: string,  // 벤더 그대로 (canon/coupang 등)
     *   round: number      // 작업 차수
     * }
     * 반환: { success: boolean, workSeq?: number, data?: any[], error?: string }
     */
    disposables.push(
      registrar.handle('po.startWork', async (_event, payload) => {
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
        if (!payload?.inboundDate) {
          return { success: false, error: 'inboundDate 가 비어있습니다.' };
        }
        const fields = [
          { name: 'inbound_date', value: String(payload.inboundDate) },
          { name: 'category', value: String(payload.category || '') },
          { name: 'round', value: String(payload.round ?? 1) },
          {
            name: 'file',
            value: buffer,
            filename: payload?.fileName || 'po.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ];
        const { body, contentType } = buildMultipart(fields);
        const url = apiUrl(settings, '/coupang/coupangList/inbound/startWork');
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
            const body2 = res.data ?? {};
            // 응답: { work_seq: number, data: CoupangOrderFormCheck[] }
            return {
              success: true,
              workSeq: body2.work_seq ?? null,
              data: Array.isArray(body2.data) ? body2.data : [],
            };
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

    /**
     * 이플렉스 출고 요청 — POST /api/coupang/coupangList/inbound/eflexOutbound
     *
     * 백엔드 CoupangEflexOutboundRequest DTO:
     *   { work_seq: int, orders: [Order...] }
     *   Order { receiverName, phone, zipCode, address, remark, refOrdNo?, items: [Item...] }
     *   Item  { productCode, eflexProductCode, ea }
     *
     * admin 프론트와 동일한 포맷으로 전송:
     *   - 1개 order 로 전체 items 묶음
     *   - refOrdNo = YYYYMMDD + 벤더코드(3자리) + 차수(2자리)  (workSeq 비의존)
     *     · 벤더코드: coupang=001, canon=002, 그 외=000
     *   - receiver 정보는 설정값 사용 (default admin 프론트 값)
     *
     * 렌더러 payload: { workSeq, items: Array<{productCode, eflexProductCode, ea}>,
     *                   jobMeta?: { date, vendor, sequence } }
     */
    disposables.push(
      registrar.handle('eflex.submitOutbound', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        if (payload?.workSeq == null) {
          return { success: false, error: 'workSeq 가 비어있습니다.' };
        }
        if (!Array.isArray(payload?.items) || payload.items.length === 0) {
          return { success: false, error: 'items 가 비어있습니다.' };
        }

        const receiver = {
          receiverName: settings.eflexReceiverName || '투비네트웍스글로벌',
          phone:        settings.eflexPhone        || '010-5011-1337',
          zipCode:      settings.eflexZipCode      || '17040',
          address:      settings.eflexAddress      || '경기 용인시 처인구 포곡읍 성산로 434',
          remark:       settings.eflexRemark       || '쿠팡 입고 반출',
        };

        // refOrdNo 빌드 — workSeq 의존 제거. 날짜+벤더코드+차수만으로 유일 식별.
        //   YYYYMMDD + 벤더코드(3자리) + 차수(2자리 0패딩)
        //   벤더코드: coupang → 001, canon → 002, 그 외 → 000 (확장 가능)
        //   예) 2026-04-29 / canon / 1차 → '20260429002' + '01' = '2026042900201'
        const ymd = String(payload?.jobMeta?.date || '').replace(/-/g, '').slice(0, 8);
        const v = String(payload?.jobMeta?.vendor || '').toLowerCase();
        const vendorCode = v === 'coupang' ? '001' : v === 'canon' ? '002' : '000';
        const seq = payload?.jobMeta?.sequence;
        const roundPart = Number.isFinite(Number(seq)) ? String(Number(seq)).padStart(2, '0') : null;
        const refOrdNo = (ymd && roundPart)
          ? `${ymd}${vendorCode}${roundPart}`
          : null;

        const reqBody = {
          work_seq: Number(payload.workSeq),
          orders: [{
            refOrdNo,
            ...receiver,
            items: payload.items.map((it) => ({
              productCode:      String(it.productCode ?? '').trim(),
              eflexProductCode: String(it.eflexProductCode ?? '').trim(),
              ea:               Number(it.ea) || 0,
            })),
          }],
        };

        const url = apiUrl(settings, '/coupang/coupangList/inbound/eflexOutbound');

        // 테스트 모드 — 실요청 skip, body 만 반환. 기본값 true (설정에서 해제 시 실전송).
        // settings 에 명시적으로 false 가 저장돼야 실요청 활성.
        const testMode = settings.eflexTestMode !== false;
        if (testMode) {
          // eslint-disable-next-line no-console
          console.info('[tbnws/eflexOutbound TEST MODE] would POST', url, '\n',
            JSON.stringify(reqBody, null, 2));
          return {
            success: true,
            testMode: true,
            url,
            body: reqBody,
            message: '테스트 모드 — 실제 전송하지 않았습니다.',
          };
        }

        const body = Buffer.from(JSON.stringify(reqBody), 'utf-8');
        try {
          const res = await request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
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
     * 달력 원격 조회 — GET /coupang/coupangList/inbound/listByMonth?year=&month=&vendor=
     *
     * 백엔드 응답 규약:
     *   { works: [{
     *       seq,                    // PK = workSeq
     *       inbound_date,           // 'YYYY-MM-DD'
     *       category,               // 'coupang' | 'canon' | ...
     *       round,                  // int
     *       status,                 // 'DRAFT'|'LOGISTICS_LOCKED'|'CONFIRMED'|'COMPLETED'
     *       step_completed,
     *       eflex_requested,        // 'Y'|'N'
     *       export_schedule_seq,    // int | null
     *       relocation_seq,         // int | null
     *       milkrun_reflected_at,   // ISO string | null
     *       created_at, updated_at,
     *     }] }
     *
     * payload: { year: number, month: number, vendor?: string }
     *   vendor 주면 해당 category 만, 없으면 전체.
     *
     * 네트워크 실패는 성공한 로컬 달력 표시를 망치면 안 되므로 {success:false, works:[]} 반환.
     */
    disposables.push(
      registrar.handle('work.listByMonth', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'no api base url', works: [] };
        }
        const y = Number(payload?.year);
        const m = Number(payload?.month);
        if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
          return { success: false, error: 'invalid year/month', works: [] };
        }
        const params = new URLSearchParams({ year: String(y), month: String(m) });
        if (payload?.vendor) params.set('vendor', String(payload.vendor));
        const url = apiUrl(settings, `/coupang/coupangList/inbound/listByMonth?${params.toString()}`);
        try {
          const res = await request(url, {
            method: 'GET',
            headers: { ...authHeaders(settings) },
            timeoutMs: 15000,
          });
          if (res.status >= 200 && res.status < 300) {
            const works = Array.isArray(res.data?.works) ? res.data.works
                        : Array.isArray(res.data) ? res.data
                        : [];
            return { success: true, works };
          }
          return {
            success: false,
            status: res.status,
            error: res.data?.message || res.raw?.slice(0, 300) || `HTTP ${res.status}`,
            works: [],
          };
        } catch (err) {
          return { success: false, error: err.message || String(err), works: [] };
        }
      }),
    );

    /**
     * 작업 상세 조회 — GET /coupang/coupangList/inbound/workDetail?work_seq=X
     *
     * 응답 record (백엔드 CoupangInboundWorkDetailResponse):
     *   { work, skuList, logisticsList, logisticsCenterList, logisticsPackageList }
     *
     * skuList 에 재고조정 필드 (export_yn, requested_qty, fulfillment_export_qty,
     * stock_remarks, confirmed_qty, stock_tobe, stock_fulfillment 등) 가 전부 포함.
     * 원격 작업 import 시 이걸로 po-tbnws.xlsx 를 로컬 재구성.
     *
     * payload: { workSeq: number }
     */
    disposables.push(
      registrar.handle('work.fetchDetail', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const workSeq = Number(payload?.workSeq);
        if (!Number.isFinite(workSeq) || workSeq <= 0) {
          return { success: false, error: 'workSeq 가 유효하지 않습니다.' };
        }
        const url = apiUrl(settings, `/coupang/coupangList/inbound/workDetail?work_seq=${workSeq}`);
        try {
          const res = await request(url, {
            method: 'GET',
            headers: { ...authHeaders(settings) },
            timeoutMs: 30000,
          });
          if (res.status >= 200 && res.status < 300) {
            return {
              success: true,
              work: res.data?.work ?? null,
              skuList: Array.isArray(res.data?.skuList) ? res.data.skuList : [],
              logisticsList: Array.isArray(res.data?.logisticsList) ? res.data.logisticsList : [],
              logisticsCenterList: Array.isArray(res.data?.logisticsCenterList) ? res.data.logisticsCenterList : [],
              logisticsPackageList: Array.isArray(res.data?.logisticsPackageList) ? res.data.logisticsPackageList : [],
            };
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
     * 원본 PO 파일 다운로드 — GET /coupang/coupangList/inbound/{workSeq}/poFile
     * 원격에서 만든 작업을 로컬로 가져올 때 사용.
     *
     * payload: { workSeq: number }
     * 반환: { success: boolean, fileName?: string, data?: Buffer, error?: string }
     *       (data 는 IPC 통과 시 Uint8Array 로 렌더러에 도착)
     */
    disposables.push(
      registrar.handle('work.downloadPoFile', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const workSeq = Number(payload?.workSeq);
        if (!Number.isFinite(workSeq) || workSeq <= 0) {
          return { success: false, error: 'workSeq 가 유효하지 않습니다.' };
        }
        const url = apiUrl(settings, `/coupang/coupangList/inbound/${workSeq}/poFile`);
        try {
          const res = await requestBuffer(url, {
            method: 'GET',
            headers: { ...authHeaders(settings) },
            timeoutMs: 60000,
          });
          if (res.status >= 200 && res.status < 300) {
            const fileName = parseFilenameFromCD(res.headers['content-disposition']) || 'po.xlsx';
            let data = res.body;
            let converted = false;
            // 백엔드 startWorkFromInternal 경로는 원본을 .csv 로 저장하지만
            // 현재 컨트롤러가 Content-Type 을 xlsx MIME 으로 하드코딩해서 내려주므로
            // fileName 확장자를 신뢰해 분기. csv 는 로컬 저장 포맷(po.xlsx)에 맞춰 변환.
            if (fileName.toLowerCase().endsWith('.csv')) {
              try {
                const wb = XLSX.read(res.body, { type: 'buffer' });
                const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
                data = Buffer.isBuffer(out) ? out : Buffer.from(out);
                converted = true;
              } catch (err) {
                return {
                  success: false,
                  error: `CSV → XLSX 변환 실패: ${err.message || err}`,
                };
              }
            }
            return { success: true, fileName, data, converted };
          }
          // 에러 응답은 JSON 일 가능성 높음 — 파싱 시도
          let errorMsg = `HTTP ${res.status}`;
          try {
            const parsed = JSON.parse(res.body.toString('utf-8'));
            errorMsg = parsed?.message || errorMsg;
          } catch { /* not json */ }
          return { success: false, status: res.status, error: errorMsg };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      }),
    );

    /**
     * 재고이동(로케이션 이동) 생성 — POST /wms/operateRelocation
     *
     * payload body (어드민 프론트 NewRelocationOperationDialog 와 동일):
     *   { title, description, fromWarehouseTag, toWarehouseTag,
     *     items: [{ productCode, ea }] }
     * 반환: 성공 시 { success: true, relocationSeq }
     */
    disposables.push(
      registrar.handle('wms.operateRelocation', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        if (!payload?.items || !Array.isArray(payload.items) || payload.items.length === 0) {
          return { success: false, error: 'items 가 비어있습니다.' };
        }
        const reqBody = {
          title: String(payload.title || ''),
          description: String(payload.description || ''),
          fromWarehouseTag: String(payload.fromWarehouseTag || ''),
          toWarehouseTag: String(payload.toWarehouseTag || ''),
          items: payload.items.map((it) => ({
            productCode: String(it.productCode ?? '').trim(),
            ea: Number(it.ea) || 0,
          })),
        };
        const url = apiUrl(settings, '/wms/operateRelocation');

        // 테스트 모드 — 기본 true. 설정에서 명시적으로 false 여야 실전송.
        const testMode = settings.relocationTestMode !== false;
        if (testMode) {
          // eslint-disable-next-line no-console
          console.info('[tbnws/wms.operateRelocation TEST MODE] would POST', url, '\n',
            JSON.stringify(reqBody, null, 2));
          return {
            success: true,
            testMode: true,
            url,
            body: reqBody,
            // 가짜 seq 반환 — 이력 기록 및 FK 업데이트 흐름 확인용
            relocationSeq: -Math.floor(Date.now() / 1000),
            message: '테스트 모드 — 실제 전송하지 않았습니다.',
          };
        }

        const body = Buffer.from(JSON.stringify(reqBody), 'utf-8');
        try {
          const res = await request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': body.length,
              ...authHeaders(settings),
            },
            body,
            timeoutMs: 60000,
          });
          if (res.status >= 200 && res.status < 300) {
            // 응답은 단일 정수 (relocationSeq) 또는 객체
            let relocationSeq = null;
            if (typeof res.data === 'number') relocationSeq = res.data;
            else if (res.data && typeof res.data === 'object') {
              relocationSeq = res.data.relocationSeq ?? res.data.relocation_seq ?? res.data.seq ?? null;
            } else if (/^\d+$/.test(String(res.raw || '').trim())) {
              relocationSeq = Number(res.raw.trim());
            }
            return { success: true, relocationSeq, raw: res.data ?? res.raw };
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

    /** 재고이동 삭제 — DELETE /wms/relocation/{relocationSeq} */
    disposables.push(
      registrar.handle('wms.deleteRelocation', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const seq = Number(payload?.relocationSeq);
        if (!Number.isFinite(seq) || seq <= 0) {
          return { success: false, error: 'relocationSeq 가 유효하지 않습니다.' };
        }
        const url = apiUrl(settings, `/wms/relocation/${seq}`);
        try {
          const res = await request(url, {
            method: 'DELETE',
            headers: { ...authHeaders(settings) },
            timeoutMs: 30000,
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
     * 쿠팡 작업의 relocation_seq FK 초기화 —
     * PATCH /coupang/coupangList/inbound/relocationSeq?work_seq=X
     *   (relocation_seq 파라미터 없이 호출하면 서버에서 NULL 로 세팅)
     * 재고이동 삭제 후 호출.
     */
    disposables.push(
      registrar.handle('work.patchRelocationSeq', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const workSeq = Number(payload?.workSeq);
        if (!Number.isFinite(workSeq) || workSeq <= 0) {
          return { success: false, error: 'workSeq 가 유효하지 않습니다.' };
        }
        const params = new URLSearchParams({ work_seq: String(workSeq) });
        if (payload?.relocationSeq != null) {
          params.set('relocation_seq', String(payload.relocationSeq));
        }
        const url = apiUrl(settings, `/coupang/coupangList/inbound/relocationSeq?${params.toString()}`);
        try {
          const res = await request(url, {
            method: 'PATCH',
            headers: { ...authHeaders(settings) },
            timeoutMs: 15000,
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
     * 출고예정 Step4 등록 — POST /coupang/coupangList/inbound/applyStep4Schedule?work_seq=X
     *
     * payload: {
     *   workSeq: number,
     *   body: {
     *     export_date, export_schedule_title, export_num, send_sms, is_export_schedule,
     *     exportProducts: [{ partner_name, category_code, user_name, receiver_name,
     *                        user_contact, user_phone, user_address, user_memo,
     *                        goods_name, ea, description, product_code, option_code }]
     *   }
     * }
     * 반환: { success: true, exportScheduleSeq }
     *
     * 백엔드 swapExportSchedule 이 기존 export_schedule_seq 가 있으면 자동 삭제 + 교체 하므로
     * 클라이언트가 별도로 삭제할 필요 없음 (단일 트랜잭션, 안전).
     */
    disposables.push(
      registrar.handle('export.applyStep4Schedule', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const workSeq = Number(payload?.workSeq);
        if (!Number.isFinite(workSeq) || workSeq <= 0) {
          return { success: false, error: 'workSeq 가 유효하지 않습니다.' };
        }
        if (!payload?.body || !Array.isArray(payload.body.exportProducts) || payload.body.exportProducts.length === 0) {
          return { success: false, error: 'exportProducts 가 비어있습니다.' };
        }
        const reqBody = payload.body;
        const url = apiUrl(settings, `/coupang/coupangList/inbound/applyStep4Schedule?work_seq=${workSeq}`);

        // 테스트 모드 — 기본 true. 설정에서 명시적으로 false 여야 실전송.
        const testMode = settings.exportScheduleTestMode !== false;
        if (testMode) {
          // eslint-disable-next-line no-console
          console.info('[tbnws/export.applyStep4Schedule TEST MODE] would POST', url, '\n',
            JSON.stringify(reqBody, null, 2));
          return {
            success: true,
            testMode: true,
            url,
            body: reqBody,
            exportScheduleSeq: -Math.floor(Date.now() / 1000),
            message: '테스트 모드 — 실제 전송하지 않았습니다.',
          };
        }

        const body = Buffer.from(JSON.stringify(reqBody), 'utf-8');
        try {
          const res = await request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': body.length,
              ...authHeaders(settings),
            },
            body,
            timeoutMs: 60000,
          });
          if (res.status >= 200 && res.status < 300) {
            const exportScheduleSeq =
                 res.data?.export_schedule_seq
              ?? res.data?.exportScheduleSeq
              ?? null;
            return { success: true, exportScheduleSeq, data: res.data ?? res.raw };
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

    /** 출고예정 삭제 — DELETE /erp/exportSchedule/{exportScheduleSeq} */
    disposables.push(
      registrar.handle('export.deleteSchedule', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const seq = Number(payload?.exportScheduleSeq);
        if (!Number.isFinite(seq) || seq <= 0) {
          return { success: false, error: 'exportScheduleSeq 가 유효하지 않습니다.' };
        }
        const url = apiUrl(settings, `/erp/exportSchedule/${seq}`);
        try {
          const res = await request(url, {
            method: 'DELETE',
            headers: { ...authHeaders(settings) },
            timeoutMs: 30000,
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
     * 쿠팡 작업의 export_schedule_seq FK 초기화 —
     * PATCH /coupang/coupangList/inbound/exportScheduleSeq?work_seq=X
     *   (export_schedule_seq 파라미터 없이 호출하면 서버에서 NULL 로 세팅)
     */
    disposables.push(
      registrar.handle('work.patchExportScheduleSeq', async (_event, payload) => {
        const settings = readTbnwsSettings(registrar.dataDir);
        if (!settings.apiBaseUrl) {
          return { success: false, error: 'TBNWS API Base URL 이 설정되지 않았습니다.' };
        }
        const workSeq = Number(payload?.workSeq);
        if (!Number.isFinite(workSeq) || workSeq <= 0) {
          return { success: false, error: 'workSeq 가 유효하지 않습니다.' };
        }
        const params = new URLSearchParams({ work_seq: String(workSeq) });
        if (payload?.exportScheduleSeq != null) {
          params.set('export_schedule_seq', String(payload.exportScheduleSeq));
        }
        const url = apiUrl(settings, `/coupang/coupangList/inbound/exportScheduleSeq?${params.toString()}`);
        try {
          const res = await request(url, {
            method: 'PATCH',
            headers: { ...authHeaders(settings) },
            timeoutMs: 15000,
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

    return () => { disposables.forEach((d) => d()); };
  },
};
