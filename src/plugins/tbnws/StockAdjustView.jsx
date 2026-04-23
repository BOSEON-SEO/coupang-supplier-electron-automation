import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

/**
 * TBNWS 용 재고조정 뷰 — admin 프론트 CoupangCheckModal 스타일.
 *
 * 구조:
 *   - 상단 요약 (전체 제품·행 수, 상태별 카운트)
 *   - tobe_product_code(G-xxxx) 기준 accordion 그룹 카드
 *   - 각 그룹: 상품코드/상품명 + 주문/투비/풀필 배지 + 상태
 *   - accordion 펼치면: 내부 테이블 (발주번호/물류센터/SKU ID/바코드/수량/출고수량 입력/출고여부/비고)
 *
 * 데이터 소스: 두 파일을 조인해서 사용
 *   - po-tbnws.xlsx (startWork 응답 18컬럼)  → 그룹핑/상태/재고/출고여부/비고
 *   - 코어의 stockAdjust:load 결과 (groups)    → rowIndex (저장용)
 *
 * 조인 키: (coupang_order_seq, departure_warehouse, sku_barcode)
 *
 * 저장 흐름:
 *   - 입력된 출고수량 → patches (rowIndex 기반) → onSave 로 상위(StockAdjustApp)에 전달
 *   - 상위가 electronAPI.stockAdjust.save 호출 (기존 경로 재사용)
 */

/** 상태 → UI 변환 */
function statusClass(exportYn) {
  const v = String(exportYn ?? '').trim();
  if (v === 'N' || v === '불가' || v === '불가능') return 'danger';
  return 'ok';
}

/** 그룹 전체 상태: 하나라도 불가면 'mixed' 또는 'danger' */
function groupStatus(rows) {
  const statuses = rows.map((r) => statusClass(r.export_yn));
  const anyBad = statuses.includes('danger');
  const allBad = statuses.every((s) => s === 'danger');
  if (allBad) return 'danger';
  if (anyBad) return 'mixed';
  return 'ok';
}

/** 배지/라벨 */
function StatusPill({ status }) {
  const label = status === 'danger' ? '불가능' : '가능';
  return <span className={`tbnws-pill tbnws-pill--${status}`}>{label}</span>;
}

export default function TbnwsStockAdjustView({
  groups: coreGroups, saving, onSave, onCancel,
  date, vendor, sequence,
}) {
  const [tbnwsRows, setTbnwsRows] = useState(null);  // 파일 없을 때 null
  const [loadError, setLoadError] = useState('');
  const [overrides, setOverrides] = useState({});    // rowIndex → 입력값(string)
  const [expanded, setExpanded] = useState({});       // tobe_product_code → bool

  // po-tbnws.xlsx 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = window.electronAPI;
        const resolved = await api.resolveJobPath(date, vendor, sequence, 'po-tbnws.xlsx');
        if (!resolved?.success) throw new Error(resolved?.error || '경로 해석 실패');
        const exists = await api.fileExists(resolved.path);
        if (!exists) {
          if (!cancelled) {
            setLoadError('po-tbnws.xlsx 가 없습니다. 작업을 먼저 생성해 검증을 완료하세요.');
            setTbnwsRows([]);
          }
          return;
        }
        const read = await api.readFile(resolved.path);
        if (!read?.success) throw new Error(read?.error || '파일 읽기 실패');
        const wb = XLSX.read(read.data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (aoa.length < 2) {
          if (!cancelled) setTbnwsRows([]);
          return;
        }
        const header = aoa[0].map((h) => String(h).trim());
        const col = (name) => header.indexOf(name);
        const idx = {
          coupang_order_seq: col('발주번호'),
          tobe_product_code: col('상품코드'),
          sku_id: col('SKU ID'),
          sku_name: col('SKU 이름'),
          sku_barcode: col('SKU 바코드'),
          order_quantity: col('발주수량'),
          requested_qty: col('확정수량'),
          departure_warehouse: col('물류센터'),
          rtn_tobe_stock: col('투비재고'),
          rtn_fulfillment_stock: col('풀필재고'),
          export_yn: col('출고여부'),
          stock_remarks: col('비고'),
        };
        const rows = [];
        for (let i = 1; i < aoa.length; i += 1) {
          const r = aoa[i];
          rows.push({
            coupang_order_seq: String(r[idx.coupang_order_seq] ?? '').trim(),
            tobe_product_code: String(r[idx.tobe_product_code] ?? '').trim(),
            sku_id:       String(r[idx.sku_id] ?? '').trim(),
            sku_name:     String(r[idx.sku_name] ?? '').trim(),
            sku_barcode:  String(r[idx.sku_barcode] ?? '').trim(),
            departure_warehouse: String(r[idx.departure_warehouse] ?? '').trim(),
            order_quantity:        Number(r[idx.order_quantity]) || 0,
            requested_qty:         Number(r[idx.requested_qty]) || 0,
            rtn_tobe_stock:        Number(r[idx.rtn_tobe_stock]) || 0,
            rtn_fulfillment_stock: Number(r[idx.rtn_fulfillment_stock]) || 0,
            export_yn:     String(r[idx.export_yn] ?? '').trim(),
            stock_remarks: String(r[idx.stock_remarks] ?? '').trim(),
          });
        }
        if (!cancelled) setTbnwsRows(rows);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [date, vendor, sequence]);

  // core groups 의 rowIndex → (order_seq, warehouse, sku_barcode) 매핑 생성
  const rowIndexMap = useMemo(() => {
    const map = new Map();
    for (const g of coreGroups || []) {
      for (const r of g.rows || []) {
        const key = `${r.coupang_order_seq}|${r.departure_warehouse}|${g.sku_barcode}`;
        map.set(key, r.rowIndex);
      }
    }
    return map;
  }, [coreGroups]);

  // tbnws 행에 rowIndex 주입 + tobe_product_code 로 그룹핑
  const grouped = useMemo(() => {
    if (!tbnwsRows) return [];
    const byProduct = new Map();
    for (const r of tbnwsRows) {
      const key = `${r.coupang_order_seq}|${r.departure_warehouse}|${r.sku_barcode}`;
      const rowIndex = rowIndexMap.get(key) ?? null;
      const productCode = r.tobe_product_code || r.sku_id || '(분류없음)';
      const entry = byProduct.get(productCode) || {
        productCode,
        skuNames: new Set(),
        rows: [],
        totalOrder: 0,
        totalTobe: 0,
        totalFulfill: 0,
      };
      entry.skuNames.add(r.sku_name);
      entry.rows.push({ ...r, rowIndex });
      entry.totalOrder   += r.order_quantity;
      // 상품코드 단위로 같은 투비/풀필 재고가 반복되어 나오므로 max 로 요약
      entry.totalTobe    = Math.max(entry.totalTobe, r.rtn_tobe_stock);
      entry.totalFulfill = Math.max(entry.totalFulfill, r.rtn_fulfillment_stock);
      byProduct.set(productCode, entry);
    }
    return Array.from(byProduct.values()).map((g) => ({
      ...g,
      sku_name_summary: Array.from(g.skuNames).filter(Boolean).join(' / '),
      status: groupStatus(g.rows),
    }));
  }, [tbnwsRows, rowIndexMap]);

  // 초기 확정수량 입력값 — po-tbnws 의 requested_qty
  const initialQty = useMemo(() => {
    const map = {};
    for (const g of grouped) {
      for (const r of g.rows) {
        if (r.rowIndex != null) map[r.rowIndex] = String(r.requested_qty ?? 0);
      }
    }
    return map;
  }, [grouped]);

  const getValue = (rowIndex) => {
    if (rowIndex in overrides) return overrides[rowIndex];
    return initialQty[rowIndex] ?? '';
  };
  const setValue = (rowIndex, v) => {
    setOverrides((prev) => ({ ...prev, [rowIndex]: v }));
  };

  const toggleGroup = (code) => {
    setExpanded((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  // 요약 카운트
  const counts = useMemo(() => {
    let ok = 0, danger = 0, mixed = 0, totalRows = 0;
    for (const g of grouped) {
      totalRows += g.rows.length;
      if (g.status === 'ok') ok += 1;
      else if (g.status === 'danger') danger += 1;
      else mixed += 1;
    }
    return { ok, danger, mixed, totalRows, totalGroups: grouped.length };
  }, [grouped]);

  const handleSave = () => {
    const patches = [];
    for (const g of grouped) {
      for (const r of g.rows) {
        if (r.rowIndex == null) continue;
        const cur = getValue(r.rowIndex);
        const n = Number(cur);
        if (!Number.isFinite(n) || n < 0) continue;
        if (String(n) !== String(r.requested_qty)) {
          patches.push({ rowIndex: r.rowIndex, confirmed_qty: n });
        }
      }
    }
    onSave?.(patches);
  };

  if (loadError) {
    return (
      <div className="tbnws-adjust-error">
        <p>{loadError}</p>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>닫기</button>
      </div>
    );
  }
  if (!tbnwsRows) {
    return <div className="tbnws-adjust-loading">po-tbnws.xlsx 로드 중…</div>;
  }
  if (grouped.length === 0) {
    return (
      <div className="tbnws-adjust-empty">
        <p>po-tbnws.xlsx 에 유효한 행이 없습니다.</p>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>닫기</button>
      </div>
    );
  }

  return (
    <>
      <div className="tbnws-adjust-body">
        {/* 상단 요약 */}
        <div className="tbnws-adjust-summary">
          <span className="tbnws-adjust-summary__counts">
            총 {counts.totalGroups}개 제품 · {counts.totalRows}건
          </span>
          {counts.mixed > 0 && (
            <span className="tbnws-chip tbnws-chip--warn">⚠ 확인 필요 {counts.mixed}</span>
          )}
          {counts.danger > 0 && (
            <span className="tbnws-chip tbnws-chip--danger">❗ 출고 불가 {counts.danger}</span>
          )}
          <span className="tbnws-chip tbnws-chip--ok">✓ 출고 가능 {counts.ok}</span>
        </div>

        {/* 그룹 카드들 */}
        <div className="tbnws-adjust-groups">
          {grouped.map((g) => {
            const isOpen = !!expanded[g.productCode];
            return (
              <div key={g.productCode} className={`tbnws-group tbnws-group--${g.status}`}>
                <button
                  type="button"
                  className="tbnws-group__header"
                  onClick={() => toggleGroup(g.productCode)}
                >
                  <StatusPill status={g.status} />
                  <span className="tbnws-group__code">{g.productCode}</span>
                  <span className="tbnws-group__name">{g.sku_name_summary}</span>
                  <span className="tbnws-group__spacer" />
                  <span className="tbnws-group__stat">주문 <b>{g.totalOrder}</b></span>
                  <span className="tbnws-group__stat">투비 <b>{g.totalTobe}</b></span>
                  <span className="tbnws-group__stat">풀필 <b>{g.totalFulfill}</b></span>
                  <span className="tbnws-group__chev">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="tbnws-group__body">
                    <table className="tbnws-group__table">
                      <thead>
                        <tr>
                          <th>발주번호</th>
                          <th>물류센터</th>
                          <th>SKU ID</th>
                          <th>SKU Barcode</th>
                          <th className="num">주문수량</th>
                          <th className="num">출고수량</th>
                          <th>출고여부</th>
                          <th>비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={`${r.coupang_order_seq}|${r.departure_warehouse}|${r.sku_barcode}`}>
                            <td>{r.coupang_order_seq}</td>
                            <td>{r.departure_warehouse}</td>
                            <td>{r.sku_id}</td>
                            <td>{r.sku_barcode}</td>
                            <td className="num">{r.order_quantity}</td>
                            <td className="num">
                              {r.rowIndex != null ? (
                                <input
                                  type="number"
                                  min="0"
                                  className="tbnws-qty-input"
                                  value={getValue(r.rowIndex)}
                                  onChange={(e) => setValue(r.rowIndex, e.target.value)}
                                />
                              ) : (
                                <span className="tbnws-qty-unmatched">미매칭</span>
                              )}
                            </td>
                            <td><StatusPill status={statusClass(r.export_yn)} /></td>
                            <td className="remark">{r.stock_remarks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="tbnws-adjust-footer">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onCancel}
          disabled={saving}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중…' : '💾 저장'}
        </button>
      </footer>
    </>
  );
}
