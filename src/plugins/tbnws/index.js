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

import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { KNOWN_SCOPES, KNOWN_HOOKS, KNOWN_VIEW_ROLES } from '../../core/plugin-api';
import { applyPoStyle } from '../../core/poStyler';
import TbnwsStockAdjustView from './StockAdjustView';
import EflexOutboundModal from './EflexOutboundModal';

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
  const requestedQty = Number(r.requested_qty) || 0;
  const fulfillExportQty = Number(r.fulfillment_export_qty) || 0;
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
    ['확정수량',       requestedQty],
    ['반출수량',       fulfillExportQty],  // 풀필에서 반출해야 할 수량 (백엔드 fulfillment_export_qty)
    ['물류센터',       r.departure_warehouse ?? ''],
    ['매입가',         purchasePrice],
    ['총매입금',       totalPurchase],
    ['SKU 납품가',     deliveryPrice],
    ['매입-납품 차액', diff],
    ['투비재고',       tobe],
    ['풀필재고',       fulfill],
    ['투비바코드',     r.rtn_tobe_barcode ?? ''],
    ['바코드일치',     r.rtn_barcode_matched ?? ''],
    ['출고여부',       renderExportStatus(r.export_yn)],
    ['비고',           r.stock_remarks ?? ''],
  ];
}

/** 응답 배열 → AOA (header + rows) */
function buildAoa(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return [[
      '발주번호','상품코드','SKU ID','SKU 이름','SKU 바코드','발주수량','확정수량','반출수량','물류센터',
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
  // 컬럼 폭 (19컬럼)
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 32 }, { wch: 16 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 28 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TBNWS 확장');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// ═══════════════════════════════════════════════════════════════════
// NewJobModal 옵션 view — '풀필 재고 동기화' 체크박스
// ═══════════════════════════════════════════════════════════════════

const OPT_KEY_REFETCH = 'tbnws.refetchFulfillment';

function TbnwsNewJobOptions({ options, onChange, disabled }) {
  const checked = !!(options && options[OPT_KEY_REFETCH]);
  return (
    <div className="newjob-plugin-option">
      <label className="newjob-plugin-option__row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(OPT_KEY_REFETCH, e.target.checked)}
          disabled={disabled}
        />
        <div>
          <div className="newjob-plugin-option__label">
            풀필먼트 재고 동기화 진행
          </div>
          <div className="newjob-plugin-option__hint">
            체크 시, PO 다운 전에 내부 DB 의 풀필 재고를 최신화하여 발주서 검증에 정확한 반출 가능 수량이 반영됩니다.
          </div>
        </div>
      </label>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 전역 오버레이 호스트 — window event 로 모달 on/off
// ═══════════════════════════════════════════════════════════════════

const EFLEX_OPEN_EVENT = 'tbnws:open-eflex-modal';

function TbnwsOverlayHost() {
  const [eflexJob, setEflexJob] = useState(null);
  useEffect(() => {
    const open = (e) => setEflexJob(e?.detail?.job || null);
    window.addEventListener(EFLEX_OPEN_EVENT, open);
    return () => window.removeEventListener(EFLEX_OPEN_EVENT, open);
  }, []);
  if (eflexJob) {
    return <EflexOutboundModal job={eflexJob} onClose={() => setEflexJob(null)} />;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// 플러그인 manifest
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../core/plugin-api').PluginManifest} */
const manifest = {
  id: 'tbnws',
  name: 'TBNWS',
  version: '0.1.0',
  description: '투비네트웍스 전용 커스터마이즈. 작업 생성 시 풀필먼트 재고 동기화, PO → 자사 확장 파일(po-tbnws.xlsx) 생성, tobe_product_code 기준 재고조정 그룹 뷰, 확정수량 cross-sync 등을 제공. API Base URL 과 Bearer 토큰을 설정해야 동작합니다.',
  entitlement: 'tbnws.plugin',

  settingsSchema: [
    {
      key: 'apiBaseUrl',
      label: 'API Base URL',
      type: 'url',
      placeholder: 'https://api.tbnws.co.kr',
      description: 'TBNWS 사내 관리 백엔드 주소. 뒤의 /api 는 포함해도 생략해도 OK (자동 정규화). 예: https://api.tbnws.co.kr 또는 http://localhost:8080',
    },
    {
      key: 'apiToken',
      label: 'API 인증 토큰',
      type: 'password',
      description: 'Bearer 토큰 또는 세션 쿠키 값. 백엔드 관리자에게 문의.',
    },
    // 이플렉스 반출 수령 정보 (admin 프론트와 동일 default)
    { key: 'eflexReceiverName', label: '이플렉스 반출 수령자명', type: 'text', default: '투비네트웍스글로벌' },
    { key: 'eflexPhone',        label: '이플렉스 반출 연락처',   type: 'text', default: '010-5011-1337' },
    { key: 'eflexZipCode',      label: '이플렉스 반출 우편번호', type: 'text', default: '17040' },
    { key: 'eflexAddress',      label: '이플렉스 반출 주소',     type: 'text', default: '경기 용인시 처인구 포곡읍 성산로 434' },
    { key: 'eflexRemark',       label: '이플렉스 반출 비고',     type: 'text', default: '쿠팡 입고 반출' },
  ],

  activate(ctx) {
    const disposables = [];

    // NewJobModal 에 풀필 재고 동기화 체크박스 기여.
    disposables.push(
      ctx.registerView(KNOWN_VIEW_ROLES.NEWJOB_OPTIONS, {
        component: TbnwsNewJobOptions,
        priority: 10,
      }),
    );

    // 재고조정 모달 — variant='tbnws' 로 열린 경우에만 admin 스타일 그룹 뷰로 치환.
    // PO 원본 탭에서 여는 기본 variant 는 코어 StockAdjustView 유지.
    disposables.push(
      ctx.registerView(KNOWN_VIEW_ROLES.STOCK_ADJUST_MAIN, {
        component: TbnwsStockAdjustView,
        priority: 10,
        when: (whenCtx) => whenCtx.variant === 'tbnws',
      }),
    );

    // 전역 오버레이 호스트 — 이플렉스 출고 모달 등 tbnws 관련 전역 모달을 이 안에서 렌더.
    disposables.push(
      ctx.registerView(KNOWN_VIEW_ROLES.APP_OVERLAY, {
        component: TbnwsOverlayHost,
        priority: 10,
      }),
    );

    // 이플렉스 출고 버튼 — 투비 재고조정 탭에서만 노출 (scope 가 tabVariant 기반).
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.eflex.outbound',
        title: '이플렉스 출고',
        icon: '🚚',
        variant: 'primary',
        scope: 'work.tab.tbnws.actions',
        order: 50,
        handler: (args) => {
          if (!args?.job) {
            alert('활성 작업이 없습니다.');
            return;
          }
          window.dispatchEvent(new CustomEvent(EFLEX_OPEN_EVENT, {
            detail: { job: args.job },
          }));
        },
      }),
    );

    // job.pre-create 훅 — options.tbnws.refetchFulfillment 가 true 면
    // 풀필 재고 동기화 API 를 호출하고 완료 대기.
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.JOB_PRE_CREATE, async (payload, hookCtx, next) => {
        const refetch = payload?.options && payload.options[OPT_KEY_REFETCH];
        if (!refetch) return next();
        console.info('[tbnws] 풀필 재고 동기화 요청 시작');
        const res = await ctx.ipcInvoke('fulfillment.refetch');
        if (!res?.success) {
          // 실패를 throw 하면 CalendarView 가 alert 로 표시.
          throw new Error(`풀필 재고 동기화 실패: ${res?.error || 'unknown'}`);
        }
        console.info('[tbnws] 풀필 재고 동기화 완료');
        return next();
      }),
    );

    // WorkView 에 "검증·확정" 탭 기여 (PO ↔ 확정서 사이).
    //
    // scope=work.tab.extra 의 command 규약:
    //   - fileName: 탭이 로드할 파일 (po-tbnws.xlsx)
    //   - after: 'po' → PO 탭 뒤에 배치
    //   - onSave: 사용자가 확정수량 편집 후 저장 누를 때 호출.
    //             편집된 buffer 에서 확정수량 추출 → confirmation.xlsx 에 patch.
    disposables.push(
      ctx.registerCommand({
        id: 'tbnws.poExtended',
        title: '투비 재고조정',
        icon: '🏢',
        scope: KNOWN_SCOPES.WORK_TAB_EXTRA,
        order: 50,
        fileName: 'po-tbnws.xlsx',
        after: 'po',
        readOnly: false,
        hasPoActions: true,
        tabVariant: 'tbnws',
        handler: () => {},
        onSave: async (buffer, { job, electronAPI }) => {
          // 1) 편집된 po-tbnws.xlsx 자체를 먼저 디스크에 저장 (탭 닫아도 편집 보존)
          const tbnwsResolved = await electronAPI.resolveJobPath(
            job.date, job.vendor, job.sequence, 'po-tbnws.xlsx',
          );
          if (tbnwsResolved?.success) {
            await electronAPI.writeFile(tbnwsResolved.path, buffer);
          }

          // 2) 편집된 buffer 에서 patches 추출
          const wb = XLSX.read(buffer, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) throw new Error('시트를 찾을 수 없습니다.');
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (aoa.length < 2) throw new Error('데이터 행이 없습니다.');
          const header = aoa[0].map((h) => String(h).trim());
          const col = (name) => header.indexOf(name);
          const iOrder = col('발주번호');
          const iWh = col('물류센터');
          const iBarcode = col('SKU 바코드');
          const iOrderQty = col('발주수량');
          const iConfirmedQty = col('확정수량');
          if (iOrder < 0 || iWh < 0 || iBarcode < 0 || iConfirmedQty < 0) {
            throw new Error('필수 컬럼을 찾을 수 없습니다.');
          }

          const [vRes, sRes] = await Promise.all([
            electronAPI.loadVendors(),
            electronAPI.loadSettings(),
          ]);
          const defaults = sRes?.settings || {};
          const vendorMeta = vRes?.vendors?.find?.((v) => v.id === job.vendor) || {};
          const override = vendorMeta.settings || {};
          const pick = (k) =>
            (override[k] !== undefined && override[k] !== '') ? override[k] : (defaults[k] ?? '');
          const defaultReason = pick('defaultShortageReason')
            || '협력사 재고부족 - 수입상품 입고지연 (선적/통관지연)';

          const patches = [];
          for (let i = 1; i < aoa.length; i += 1) {
            const row = aoa[i];
            const orderSeq = String(row[iOrder] ?? '').trim();
            const warehouse = String(row[iWh] ?? '').trim();
            const barcode = String(row[iBarcode] ?? '').trim();
            if (!orderSeq || !barcode) continue;
            const confirmedQty = String(row[iConfirmedQty] ?? 0);
            const confirmedNum = Number(confirmedQty) || 0;
            const orderNum = Number(row[iOrderQty] ?? 0) || 0;
            patches.push({
              key: `${orderSeq}|${warehouse}|${barcode}`,
              confirmedQty,
              shortageReason: confirmedNum < orderNum ? defaultReason : '',
            });
          }

          // 3) 세 파일 동시 sync (po.xlsx / po-tbnws.xlsx / confirmation.xlsx)
          const res = await electronAPI.confirmedQty.sync(
            job.date, job.vendor, job.sequence, patches,
          );
          if (!res?.success) {
            throw new Error(res?.error || '확정수량 sync 실패');
          }
          const r = res.results || {};
          const parts = Object.entries(r)
            .filter(([, v]) => v?.success && !v.skipped && (v.patched || 0) > 0)
            .map(([f, v]) => `${f} ${v.patched}건`);
          if (parts.length === 0) {
            alert('반영된 파일이 없습니다. 복합키 매칭을 확인하세요.');
          } else {
            alert(`확정수량 반영 완료: ${parts.join(' · ')}`);
          }
        },
      }),
    );

    /**
     * po.postprocess 훅 — 원본 PO 를 startWork 로 전송해 작업 생성 + 검증.
     * 결과를 17컬럼 xlsx (어드민 프론트 CoupangCheckModal 와 동일 구조) 로 저장하고,
     * 백엔드의 work_seq 를 manifest.pluginData.tbnws.workSeq 에 영속화.
     *
     * 저장 위치: {job-folder}/po-tbnws.xlsx  (원본 po.xlsx 는 보존)
     * work_seq 는 이후 saveStep1/2/3·eFlexs 반출 등 후속 API 에서 사용됨.
     */
    disposables.push(
      ctx.registerHook(KNOWN_HOOKS.PO_POSTPROCESS, async (payload, hookCtx, next) => {
        try {
          const job = payload?.job;
          if (!job) {
            console.warn('[tbnws] payload.job 없어서 startWork 스킵');
            return next();
          }
          const res = await ctx.ipcInvoke('po.startWork', {
            fileName: payload?.fileName,
            fileBuffer: payload?.buffer,
            inboundDate: job.date,
            category: job.vendor || '',
            round: job.sequence,
          });
          if (!res?.success) {
            console.warn('[tbnws] startWork 실패:', res?.error);
            return next();
          }
          const data = Array.isArray(res.data) ? res.data : [];
          console.info('[tbnws] startWork 응답 수신:', {
            workSeq: res.workSeq,
            rowCount: data.length,
            sample: data[0],
          });

          // work_seq 를 manifest 에 영속화 (후속 API 호출에 사용)
          if (res.workSeq != null) {
            try {
              const existing = (job.pluginData && job.pluginData.tbnws) || {};
              await ctx.electronAPI.jobs.updateManifest(job.date, job.vendor, job.sequence, {
                pluginData: {
                  ...(job.pluginData || {}),
                  tbnws: { ...existing, workSeq: res.workSeq },
                },
              });
            } catch (err) {
              console.warn('[tbnws] manifest workSeq 저장 실패', err);
            }
          }

          // 응답 → 18컬럼 엑셀 빌드 → PO 원본과 동일 스타일 적용
          const aoa = buildAoa(data);
          const raw = buildWorkbookBuffer(aoa);
          // XLSX.write('array') → Uint8Array | ArrayBuffer. applyPoStyle 은 ArrayBuffer 전제.
          const ab = raw.buffer
            ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
            : raw;
          const outBuffer = await applyPoStyle(ab);
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
