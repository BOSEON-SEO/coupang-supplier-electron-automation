import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';

/**
 * 이플렉스 출고 모달 — po-tbnws.xlsx 에서 풀필 반출 대상 행만 필터해 표시.
 *
 * 필터 조건: 반출수량 > 0 (풀필재고 여부는 보지 않음 — 백엔드가 이미 할당해둠)
 *
 * submit: POST /api/coupang/coupangList/inbound/eflexOutbound
 *   body (백엔드 CoupangEflexOutboundRequest DTO 에 맞춤):
 *   {
 *     work_seq: number,
 *     orders: [{
 *       receiverName, phone, zipCode, address, remark,
 *       refOrdNo?,                        // null 이면 백엔드가 yyMMdd-NNNN 자동 채번
 *       items: [{ productCode, eflexProductCode, ea }]
 *     }]
 *   }
 */
export default function EflexOutboundModal({ job, onClose }) {
  const [rows, setRows] = useState(null);   // null=loading, [] or array
  const [loadErr, setLoadErr] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!job) throw new Error('job 없음');
        const api = window.electronAPI;
        const resolved = await api.resolveJobPath(job.date, job.vendor, job.sequence, 'po-tbnws.xlsx');
        if (!resolved?.success) throw new Error(resolved?.error || '경로 해석 실패');
        const exists = await api.fileExists(resolved.path);
        if (!exists) {
          if (!cancelled) { setRows([]); setLoadErr('po-tbnws.xlsx 가 아직 없습니다. 작업 생성 + 검증을 먼저 완료하세요.'); }
          return;
        }
        const read = await api.readFile(resolved.path);
        if (!read?.success) throw new Error(read?.error || '파일 읽기 실패');
        const wb = XLSX.read(read.data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (aoa.length < 2) { if (!cancelled) setRows([]); return; }
        const header = aoa[0].map((h) => String(h).trim());
        const col = (name) => header.indexOf(name);
        const idx = {
          orderSeq:       col('발주번호'),
          productCode:    col('상품코드'),
          skuId:          col('SKU ID'),
          skuName:        col('SKU 이름'),
          skuBarcode:     col('SKU 바코드'),
          orderQty:       col('발주수량'),
          fulfillExport:  col('반출수량'),
          warehouse:      col('물류센터'),
          fulfillStock:   col('풀필재고'),
        };

        const filtered = [];
        for (let i = 1; i < aoa.length; i += 1) {
          const r = aoa[i];
          const exportQty = Number(r[idx.fulfillExport]) || 0;
          if (exportQty <= 0) continue;
          filtered.push({
            coupangOrderSeq:   String(r[idx.orderSeq] ?? '').trim(),
            productCode:       String(r[idx.productCode] ?? '').trim(),
            skuId:             String(r[idx.skuId] ?? '').trim(),
            skuName:           String(r[idx.skuName] ?? '').trim(),
            skuBarcode:        String(r[idx.skuBarcode] ?? '').trim(),
            logisticsCenter:   String(r[idx.warehouse] ?? '').trim(),
            orderQuantity:     Number(r[idx.orderQty]) || 0,
            exportQuantity:    exportQty,
          });
        }
        if (!cancelled) setRows(filtered);
      } catch (err) {
        if (!cancelled) setLoadErr(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [job]);

  const handleSubmit = async () => {
    if (!rows || rows.length === 0) return;
    const workSeq = job?.pluginData?.tbnws?.workSeq;
    if (workSeq == null) {
      alert('이 작업에 workSeq 가 없습니다. startWork 가 수행돼야 합니다.');
      return;
    }
    setSending(true);
    try {
      // 백엔드 CoupangEflexOutboundRequest.Item 스키마:
      //   productCode     : 제조사 상품코드 (내부 추적용)
      //   eflexProductCode: eFlexs 상품코드 (G-XXXXX 또는 cj_code)
      //   ea              : 수량
      // admin 프론트와 동일하게 productCode 별 그룹핑 + ea 합산.
      // 같은 상품이 여러 발주·물류센터에 걸쳐 있어도 한 item 으로 합쳐짐.
      const itemsByCode = new Map();
      for (const r of rows) {
        const code = r.productCode;
        if (!code) continue;
        const prev = itemsByCode.get(code);
        if (prev) {
          prev.ea += r.exportQuantity;
        } else {
          itemsByCode.set(code, {
            productCode: code,
            eflexProductCode: code,
            ea: r.exportQuantity,
          });
        }
      }
      const items = Array.from(itemsByCode.values());
      const res = await window.electronAPI.invokePluginChannel(
        'tbnws', 'eflex.submitOutbound',
        {
          workSeq,
          items,
          jobMeta: { date: job.date, vendor: job.vendor, sequence: job.sequence },
        },
      );
      if (res?.testMode) {
        // eslint-disable-next-line no-console
        console.info('[tbnws/eflexOutbound TEST MODE] url:', res.url, '\nbody:', res.body);
        alert(
          `[테스트 모드] 실제 전송 안 함 — 요청 body 는 DevTools Console 에 로그됨.\n\n`
          + `URL: ${res.url}\n`
          + `items: ${items.length}건\n\n`
          + `설정에서 '이플렉스 출고 테스트 모드' 체크 해제하면 실전송으로 전환됩니다.`,
        );
        onClose();
        return;
      }
      if (res?.success) {
        const count = res.data?.count ?? rows.length;
        alert(`이플렉스 출고 요청 완료 — ${count}건`);
        onClose();
      } else {
        alert(`실패: ${res?.error || 'unknown'}`);
      }
    } catch (err) {
      alert(`전송 실패: ${err.message || err}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="eflex-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="eflex-overlay__card" onClick={(e) => e.stopPropagation()}>
        <header className="eflex-overlay__header">
          <h3 className="eflex-overlay__title">
            🚚 이플렉스 출고
            {rows && <span className="eflex-overlay__count">· {rows.length}건</span>}
          </h3>
          <button type="button" className="eflex-overlay__close" onClick={onClose}>×</button>
        </header>

        <div className="eflex-overlay__body">
          {loadErr ? (
            <p className="eflex-overlay__empty">{loadErr}</p>
          ) : rows === null ? (
            <p className="eflex-overlay__empty">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="eflex-overlay__empty">
              반출수량 &gt; 0 인 행이 없습니다.
            </p>
          ) : (
            <table className="eflex-table">
              <thead>
                <tr>
                  <th>발주번호</th>
                  <th>상품코드</th>
                  <th>SKU ID</th>
                  <th>SKU Barcode</th>
                  <th>물류센터</th>
                  <th className="num">주문수량</th>
                  <th className="num">반출수량</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.coupangOrderSeq}|${r.skuBarcode}|${r.logisticsCenter}|${i}`}>
                    <td>{r.coupangOrderSeq}</td>
                    <td><code>{r.productCode}</code></td>
                    <td>{r.skuId}</td>
                    <td>{r.skuBarcode}</td>
                    <td>{r.logisticsCenter}</td>
                    <td className="num">{r.orderQuantity}</td>
                    <td className="num eflex-table__export">{r.exportQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="eflex-overlay__footer">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={sending}
          >
            취소
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleSubmit}
            disabled={sending || !rows?.length}
            title="선택된 항목을 TBNWS 백엔드의 /coupang/coupangList/inbound/eflexOutbound 로 전송"
          >
            🚚 {sending ? '전송 중…' : `이플렉스 출고 전송 (${rows?.length || 0}건)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
