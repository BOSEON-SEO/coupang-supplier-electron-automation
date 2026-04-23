/**
 * TBNWS 플러그인 — 투비네트웍스 전용 커스터마이즈.
 *
 * 계획된 기능:
 *   1. ✅ po.postprocess: coupangCheckForm 응답으로 17컬럼 확장 파일 생성
 *   2. 재고조정 자동 채움 (stock-adjust.autofill)
 *   3. 제품 그룹핑 (product.group-key)
 *   4. 재고 반영 phase (registerPhase)
 *   5. job.completed 라이프사이클 (커스텀 파일 생성)
 *
 * 백엔드 HTTP 는 main-half(main.js) 에서 처리. renderer 는 ctx.ipcInvoke 로 호출.
 */

import * as XLSX from 'xlsx';
import { KNOWN_SCOPES, KNOWN_HOOKS } from '../../core/plugin-api';

// ═══════════════════════════════════════════════════════════════════
// 17컬럼 정의 — 어드민 프론트의 CoupangCheckModal 과 동일 순서·라벨
// ═══════════════════════════════════════════════════════════════════

/**
 * 백엔드 export_yn → 표시용 '가능' / '불가능'.
 * ERPService 의 UNORDERABLE_STATUSES = {N, 불가, 불가능} 과 동일 판정.
 */
function renderExportStatus(exportYn) {
  const v = String(exportYn ?? '').trim();
  if (!v) return '';
  return (v === 'N' || v === '불가' || v === '불가능') ? '불가능' : '가능';
}

/**
 * @param {object} r  CoupangOrderFormCheck 한 행 (백엔드 enrichStep2Defaults 적용 후)
 * @returns {[string, any][]}
 */
function toExtendedRow(r) {
  const orderQty = Number(r.order_quantity) || 0;
  const purchasePrice = Number(r.purchase_price) || 0;
  const deliveryPrice = Number(r.rtn_sku_delivery_price) || 0;
  const tobe = Number(r.rtn_tobe_stock) || 0;
  const fulfill = Number(r.rtn_fulfillment_stock) || 0;

  const totalPurchase = orderQty * purchasePrice;
  const diff = purchasePrice - deliveryPrice;

  return [
    ['발주번호',       r.coupang_order_seq ?? ''],
    ['상품코드',       r.tobe_product_code ?? ''],
    ['SKU ID',         r.sku_id ?? ''],
    ['SKU 이름',       r.sku_name ?? ''],
    ['SKU 바코드',     r.sku_barcode ?? ''],
    ['발주수량',       orderQty],
    ['물류센터',       r.departure_warehouse ?? ''],
    ['매입가',         purchasePrice],
    ['총매입금',       totalPurchase],
    ['SKU 납품가',     deliveryPrice],
    ['매입-납품 차액', diff],
    ['투비재고',       tobe],
    ['풀필재고',       fulfill],
    ['투비바코드',     r.rtn_tobe_barcode ?? ''],
    ['바코드일치',     r.rtn_barcode_matched ?? ''],
    // 이하 백엔드 enrichStep2Defaults 가 채운 필드들 (로컬 재계산 없음)
    ['출고여부',       renderExportStatus(r.export_yn)],
    ['비고',           r.stock_remarks ?? ''],
  ];
}

/** 응답 배열 → AOA (header + rows) */
function buildAoa(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return [[
      '발주번호','상품코드','SKU ID','SKU 이름','SKU 바코드','발주수량','물류센터',
      '매입가','총매입금','SKU 납품가','매입-납품 차액','투비재고','풀필재고',
      '투비바코드','바코드일치','출고여부','비고',
    ]];
  }
  const first = toExtendedRow(data[0]);
  const header = first.map(([label]) => label);
  const rows = data.map((r) => toExtendedRow(r).map(([, v]) => v));
  return [header, ...rows];
}

/** AOA → xlsx ArrayBuffer */
function buildWorkbookBuffer(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 컬럼 폭 대충
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 32 }, { wch: 16 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
    { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 10 },
    { wch: 10 }, { wch: 28 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TBNWS 확장');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// ═══════════════════════════════════════════════════════════════════
// 플러그인 manifest
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'tbnws',
  name: 'TBNWS',
  version: '0.1.0',
  entitlement: 'tbnws.plugin',

  settingsSchema: [
    {
      key: 'apiBaseUrl',
      label: 'API Base URL',
      type: 'url',
      placeholder: 'https://tbnws-admin.internal/api',
      description: 'TBNWS 사내 관리 백엔드 주소. 예) http://10.0.0.5:8080',
    },
    {
      key: 'apiToken',
      label: 'API 인증 토큰',
      type: 'password',
      description: 'Bearer 토큰 또는 세션 쿠키 값. 백엔드 관리자에게 문의.',
    },
  ],

  activate(ctx) {
    const disposables = [];

    // 스모크 테스트용 — work.toolbar 에 플러그인 식별 버튼.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.menu',
        title: 'TBNWS',
        icon: '🏢',
        scope: KNOWN_SCOPES.WORK_TOOLBAR,
        order: 50,
        variant: 'secondary',
        handler: (args) => {
          alert(
            `[TBNWS 플러그인]\n` +
            `- 작업: ${args?.job ? `${args.job.vendor}/${args.job.sequence}차` : '(없음)'}\n` +
            `- 탭: ${args?.activeTab || '-'}\n\n` +
            `5개 기능 구현 예정 — 스켈레톤 상태.`,
          );
        },
      }),
    );

    /**
     * po.postprocess 훅 — 원본 PO 를 coupangCheckForm 으로 검증 + 재고 조회,
     * 결과를 17컬럼 xlsx (어드민 프론트 CoupangCheckModal 와 동일 구조) 로 저장.
     *
     * 저장 위치: {job-folder}/po-tbnws.xlsx  (원본 po.xlsx 는 보존)
     */
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.PO_POSTPROCESS, async (payload, hookCtx, next) => {
        try {
          const res = await ctx.ipcInvoke('po.checkForm', {
            fileName: payload?.fileName,
            fileBuffer: payload?.buffer,
          });
          if (!res?.success) {
            console.warn('[tbnws] po.checkForm 실패:', res?.error);
            return next();
          }
          const data = Array.isArray(res.data) ? res.data : [];
          console.info('[tbnws] coupangCheckForm 응답 수신:', {
            rowCount: data.length,
            sample: data[0],
          });

          // 응답 → 17컬럼 엑셀 빌드
          const aoa = buildAoa(data);
          const outBuffer = buildWorkbookBuffer(aoa);

          // job 폴더에 저장
          const job = payload?.job;
          if (!job) {
            console.warn('[tbnws] payload.job 없어서 파일 저장 스킵');
            return next();
          }
          const resolved = await ctx.electronAPI.resolveJobPath(
            job.date, job.vendor, job.sequence, 'po-tbnws.xlsx',
          );
          if (!resolved?.success) {
            console.warn('[tbnws] po-tbnws.xlsx 경로 해석 실패:', resolved?.error);
            return next();
          }
          const w = await ctx.electronAPI.writeFile(resolved.path, outBuffer);
          if (!w?.success) {
            console.warn('[tbnws] po-tbnws.xlsx 저장 실패:', w?.error);
            return next();
          }
          console.info(`[tbnws] po-tbnws.xlsx 저장됨 (${data.length}행): ${resolved.path}`);
          return next();
        } catch (err) {
          console.error('[tbnws] po.postprocess 실패', err);
          return next();
        }
      }),
    );

    // TODO: stock-adjust.autofill 훅 등록
    // TODO: product.group-key 훅 등록
    // TODO: registerPhase 로 '재고 반영' 단계 삽입
    // TODO: job.completed 라이프사이클 핸들러

    return () => { disposables.forEach((d) => d()); };
  },
};

export default manifest;
