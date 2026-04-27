import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

/**
 * TBNWS 용 재고조정 뷰 — admin 프론트 CoupangCheckModal 스타일.
 *
 * 구조:
 *   - 상단 요약 (전체 제품·행 수, 상태별 카운트)
 *   - tobe_product_code(G-xxxx) 기준 accordion 그룹 카드
 *   - 카드 헤더: 상품코드·상품명은 드래그/복사 가능 (user-select)
 *     → 토글은 우측 chevron 버튼을 눌러야만 동작
 *   - 각 그룹: 상품코드/상품명 + 주문/투비/풀필 배지 + 상태
 *   - 내부 테이블:
 *     발주번호 / 물류센터 / SKU ID / SKU Barcode / 주문수량
 *     / 출고여부(chip = toggle) / 출고수량(input) / 반출수량(input) / 비고
 *   - chip 클릭: 가능↔불가능 토글. 가능→불가능이면 출고수량=0, 반대면 주문수량.
 *
 * 데이터 소스:
 *   - po-tbnws.xlsx (19컬럼)   → 그룹핑/상태/재고/반출수량/출고여부/비고
 *   - 코어 stockAdjust:load    → rowIndex (저장용)
 *
 * 저장 흐름:
 *   - 출고수량 변경 → patches (rowIndex 기반) → onSave 로 상위 전달
 *   - 상위가 electronAPI.stockAdjust.save 호출
 *   - ※ 반출수량 저장 경로는 추후 연결 (현재는 UI 편집만)
 */

function statusClass(exportYn) {
  const v = String(exportYn ?? '').trim();
  if (v === 'N' || v === '불가' || v === '불가능') return 'danger';
  return 'ok';
}

function groupStatus(rows) {
  const statuses = rows.map((r) => statusClass(r.export_yn));
  const anyBad = statuses.includes('danger');
  const allBad = statuses.every((s) => s === 'danger');
  if (allBad) return 'danger';
  if (anyBad) return 'mixed';
  return 'ok';
}

/** 현재 출고수량에 따라 "가능"/"불가능" 판정 (입력값 0 이면 불가능) */
function qtyToStatus(confirmedQty) {
  const n = Number(confirmedQty);
  if (!Number.isFinite(n) || n <= 0) return 'danger';
  return 'ok';
}

export default function TbnwsStockAdjustView({
  groups: coreGroups, saving, onSave, onCancel,
  date, vendor, sequence,
}) {
  const [tbnwsRows, setTbnwsRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [overrides, setOverrides] = useState({});       // rowIndex → 출고수량 string
  const [fulfillOverrides, setFulfillOverrides] = useState({}); // rowIndex → 반출수량 string
  const [expanded, setExpanded] = useState({});
  const [activeFilters, setActiveFilters] = useState(() => new Set()); // Set<'ok'|'mixed'|'danger'>

  const toggleFilter = useCallback((status) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

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
            setLoadError('po-tbnws.xlsx 가 없습니다. 작업 생성 + 검증이 먼저 완료되어야 합니다.');
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
          fulfillment_export_qty: col('반출수량'),
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
            order_quantity:          Number(r[idx.order_quantity]) || 0,
            requested_qty:           Number(r[idx.requested_qty]) || 0,
            fulfillment_export_qty:  Number(r[idx.fulfillment_export_qty]) || 0,
            rtn_tobe_stock:          Number(r[idx.rtn_tobe_stock]) || 0,
            rtn_fulfillment_stock:   Number(r[idx.rtn_fulfillment_stock]) || 0,
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

  // core groups → rowIndex 조인 맵.
  // 키에 sku_id 포함 — 같은 (orderSeq, warehouse) 에 다른 SKU 가 들어있는데
  // sku_barcode 까지 동일한 데이터(예: 캐논처럼 모든 SKU 가 같은 바코드)에서
  // 키 충돌로 한 행이 다른 SKU 의 rowIndex 를 가져가던 버그 방지.
  const rowIndexMap = useMemo(() => {
    const map = new Map();
    for (const g of coreGroups || []) {
      for (const r of g.rows || []) {
        const key = `${r.coupang_order_seq}|${r.departure_warehouse}|${r.sku_id || g.sku_id}`;
        map.set(key, r.rowIndex);
      }
    }
    return map;
  }, [coreGroups]);

  const grouped = useMemo(() => {
    if (!tbnwsRows) return [];
    const byProduct = new Map();
    for (const r of tbnwsRows) {
      const key = `${r.coupang_order_seq}|${r.departure_warehouse}|${r.sku_id}`;
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

  // 초기 입력값 — 출고수량 = requested_qty (단, 출고불가 행은 0 강제).
  // po-tbnws 빌더가 출고여부를 'Y'/'N' 이 아니라 '가능'/'불가능' 으로 저장하므로
  // statusClass 와 동일 룰로 판정.
  const initialConfirmed = useMemo(() => {
    const map = {};
    for (const g of grouped) {
      for (const r of g.rows) {
        if (r.rowIndex == null) continue;
        const isUnshippable = statusClass(r.export_yn) === 'danger';
        map[r.rowIndex] = String(isUnshippable ? 0 : (r.requested_qty ?? 0));
      }
    }
    return map;
  }, [grouped]);

  const initialFulfill = useMemo(() => {
    const map = {};
    for (const g of grouped) {
      for (const r of g.rows) {
        if (r.rowIndex != null) map[r.rowIndex] = String(r.fulfillment_export_qty ?? 0);
      }
    }
    return map;
  }, [grouped]);

  const getQty = (rowIndex) => (
    rowIndex in overrides ? overrides[rowIndex] : (initialConfirmed[rowIndex] ?? '')
  );
  const setQty = (rowIndex, v) => {
    setOverrides((prev) => ({ ...prev, [rowIndex]: v }));
  };

  const getFulfill = (rowIndex) => (
    rowIndex in fulfillOverrides ? fulfillOverrides[rowIndex] : (initialFulfill[rowIndex] ?? '')
  );
  const setFulfill = (rowIndex, v) => {
    setFulfillOverrides((prev) => ({ ...prev, [rowIndex]: v }));
  };

  // chip toggle — 현재 상태에 따라 출고수량을 0 또는 주문수량으로.
  const toggleStatus = useCallback((r) => {
    if (r.rowIndex == null) return;
    const curStatus = qtyToStatus(getQty(r.rowIndex));
    const nextQty = curStatus === 'ok' ? 0 : (Number(r.order_quantity) || 0);
    setQty(r.rowIndex, String(nextQty));
  }, [overrides, initialConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (code) => {
    setExpanded((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  // 전체 펼치기/접기 — visibleGrouped 가 아닌 grouped 전체 대상.
  const expandAll = useCallback(() => {
    const next = {};
    for (const g of grouped) next[g.productCode] = true;
    setExpanded(next);
  }, [grouped]);
  const collapseAll = useCallback(() => setExpanded({}), []);

  // 요약 카운트 (현재 입력값 기준으로 재계산하면 UX 이상적이지만 초기 데이터 기반으로 일관성 유지)
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

  // 상단 chip 필터 적용 — 활성 필터 집합이 비어있으면 전체 표시
  const visibleGrouped = useMemo(() => {
    if (activeFilters.size === 0) return grouped;
    return grouped.filter((g) => activeFilters.has(g.status));
  }, [grouped, activeFilters]);

  const handleSave = async () => {
    const patches = [];          // 출고수량 (confirmed_qty) — 기존 stockAdjust.save 경로
    const fulfillPatches = [];   // 반출수량 (fulfillment_export_qty) — po-tbnws 만 patch
    for (const g of grouped) {
      for (const r of g.rows) {
        if (r.rowIndex == null) continue;
        // 출고수량
        const cur = getQty(r.rowIndex);
        const n = Number(cur);
        if (Number.isFinite(n) && n >= 0 && String(n) !== String(r.requested_qty)) {
          patches.push({ rowIndex: r.rowIndex, confirmed_qty: n });
        }
        // 반출수량 — 변경분만 po-tbnws.xlsx 에 반영
        const fulfill = getFulfill(r.rowIndex);
        const fn = Number(fulfill);
        if (Number.isFinite(fn) && fn >= 0 && String(fn) !== String(r.fulfillment_export_qty ?? 0)) {
          fulfillPatches.push({
            key: `${r.coupang_order_seq}|${r.departure_warehouse}|${r.sku_barcode}`,
            value: fn,
          });
        }
      }
    }

    // 반출수량 patch 먼저 (po-tbnws 만 영향). 실패해도 출고수량 경로는 계속.
    if (fulfillPatches.length > 0) {
      try {
        const api = window.electronAPI;
        if (api?.poTbnws?.patchFulfillExport) {
          const res = await api.poTbnws.patchFulfillExport(date, vendor, sequence, fulfillPatches);
          if (!res?.success && !res?.skipped) {
            console.warn('[tbnws] 반출수량 patch 실패:', res?.error);
          }
        }
      } catch (err) {
        console.warn('[tbnws] 반출수량 patch 예외', err);
      }
    }

    // 출고수량은 기존 경로로 (상위 StockAdjustApp → stockAdjust.save → sync)
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
        {/* 상단 요약 — 각 chip 은 필터 토글 */}
        <div className="tbnws-adjust-summary">
          <span className="tbnws-adjust-summary__counts">
            총 {counts.totalGroups}개 제품 · {counts.totalRows}건
            {activeFilters.size > 0 && (
              <span className="tbnws-adjust-summary__filtered">
                · 필터 적용 ({visibleGrouped.length} 표시)
              </span>
            )}
          </span>
          <button
            type="button"
            className={`tbnws-chip tbnws-chip--warn${activeFilters.has('mixed') ? ' is-on' : ''}`}
            onClick={() => toggleFilter('mixed')}
            title="확인 필요 카드만 보기 (다시 눌러 해제)"
          >
            ⚠ 확인 필요 {counts.mixed}
          </button>
          <button
            type="button"
            className={`tbnws-chip tbnws-chip--danger${activeFilters.has('danger') ? ' is-on' : ''}`}
            onClick={() => toggleFilter('danger')}
            title="출고 불가 카드만 보기 (다시 눌러 해제)"
          >
            ❗ 출고 불가 {counts.danger}
          </button>
          <button
            type="button"
            className={`tbnws-chip tbnws-chip--ok${activeFilters.has('ok') ? ' is-on' : ''}`}
            onClick={() => toggleFilter('ok')}
            title="출고 가능 카드만 보기 (다시 눌러 해제)"
          >
            ✓ 출고 가능 {counts.ok}
          </button>
          <span className="tbnws-adjust-summary__sep" />
          <button
            type="button"
            className="tbnws-adjust-summary__toggle"
            onClick={expandAll}
            title="모든 그룹 펼치기"
          >⌄ 전체 펼치기</button>
          <button
            type="button"
            className="tbnws-adjust-summary__toggle"
            onClick={collapseAll}
            title="모든 그룹 접기"
          >⌃ 전체 접기</button>
        </div>

        {/* 그룹 카드들 */}
        <div className="tbnws-adjust-groups">
          {visibleGrouped.map((g) => {
            const isOpen = !!expanded[g.productCode];
            return (
              <div key={g.productCode} className={`tbnws-group tbnws-group--${g.status}`}>
                {/* 헤더 — 전체 클릭으로 토글하지 않고, 텍스트는 드래그 가능.
                    chevron 버튼만이 토글 트리거. */}
                <div className="tbnws-group__header">
                  <span className={`tbnws-pill tbnws-pill--${g.status}`}>
                    {g.status === 'danger' ? '불가능' : g.status === 'mixed' ? '확인' : '가능'}
                  </span>
                  <span className="tbnws-group__code">{g.productCode}</span>
                  <span className="tbnws-group__name">{g.sku_name_summary}</span>
                  <span className="tbnws-group__spacer" />
                  <span className="tbnws-group__stat">주문 <b>{g.totalOrder}</b></span>
                  <span className="tbnws-group__stat">투비 <b>{g.totalTobe}</b></span>
                  <span className="tbnws-group__stat">풀필 <b>{g.totalFulfill}</b></span>
                  <button
                    type="button"
                    className="tbnws-group__chev-btn"
                    onClick={() => toggleGroup(g.productCode)}
                    aria-label={isOpen ? '접기' : '펼치기'}
                    title={isOpen ? '접기' : '펼치기'}
                  >
                    {isOpen ? '▲' : '▼'}
                  </button>
                </div>
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
                          <th>출고여부</th>
                          <th className="num">출고수량</th>
                          <th className="num">반출수량</th>
                          <th>비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => {
                          const curStatus = r.rowIndex != null
                            ? qtyToStatus(getQty(r.rowIndex))
                            : statusClass(r.export_yn);
                          return (
                            <tr key={`${r.coupang_order_seq}|${r.departure_warehouse}|${r.sku_barcode}`}>
                              <td>{r.coupang_order_seq}</td>
                              <td>{r.departure_warehouse}</td>
                              <td>{r.sku_id}</td>
                              <td>{r.sku_barcode}</td>
                              <td className="num">{r.order_quantity}</td>
                              <td>
                                {r.rowIndex != null ? (
                                  <button
                                    type="button"
                                    className={`tbnws-pill tbnws-pill--${curStatus} tbnws-pill--toggle`}
                                    onClick={() => toggleStatus(r)}
                                    title="클릭 시 출고수량을 0 ↔ 주문수량 으로 전환"
                                  >
                                    {curStatus === 'danger' ? '불가능' : '가능'}
                                  </button>
                                ) : (
                                  <span className={`tbnws-pill tbnws-pill--${statusClass(r.export_yn)}`}>
                                    {statusClass(r.export_yn) === 'danger' ? '불가능' : '가능'}
                                  </span>
                                )}
                              </td>
                              <td className="num">
                                {r.rowIndex != null ? (
                                  <input
                                    type="number"
                                    min="0"
                                    className="tbnws-qty-input"
                                    value={getQty(r.rowIndex)}
                                    onChange={(e) => setQty(r.rowIndex, e.target.value)}
                                  />
                                ) : (
                                  <span className="tbnws-qty-unmatched">미매칭</span>
                                )}
                              </td>
                              <td className="num">
                                {r.rowIndex != null ? (
                                  <input
                                    type="number"
                                    min="0"
                                    className="tbnws-qty-input"
                                    value={getFulfill(r.rowIndex)}
                                    onChange={(e) => setFulfill(r.rowIndex, e.target.value)}
                                  />
                                ) : null}
                              </td>
                              <td className="remark">{r.stock_remarks}</td>
                            </tr>
                          );
                        })}
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
