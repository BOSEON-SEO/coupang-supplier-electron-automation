import React, { useMemo, useState, useCallback } from 'react';

/**
 * SKU 바코드별 그룹핑된 PO 를 보여주고, 각 발주 행별 출고수량(=확정수량) 을
 * 사용자가 지정한다. "저장하고 닫기" 누르면 patches 배열을 상위로 넘긴다.
 *
 * Props:
 *   - groups: [{ sku_barcode, sku_id, sku_name, total_order_qty, rows: [{ rowIndex, coupang_order_seq, departure_warehouse, order_quantity, confirmed_qty }] }]
 *   - saving: bool
 *   - onSave: (patches) => void  patches = [{ rowIndex, confirmed_qty }]
 *   - onCancel: () => void
 */
export default function StockAdjustView({ groups, saving, onSave, onCancel }) {
  // rowIndex → 사용자 입력값 (문자열로 관리, 저장 시 숫자 변환)
  const [overrides, setOverrides] = useState({});

  // 초기값: 기존 confirmed_qty 를 그대로 입력 필드에 채운다
  const initialValues = useMemo(() => {
    const map = {};
    for (const g of groups) {
      for (const r of g.rows) {
        const v = r.confirmed_qty ?? r.order_quantity ?? 0;
        map[r.rowIndex] = String(v);
      }
    }
    return map;
  }, [groups]);

  const getValue = (rowIndex) => {
    if (rowIndex in overrides) return overrides[rowIndex];
    return initialValues[rowIndex] ?? '';
  };

  const setValue = (rowIndex, v) => {
    setOverrides((prev) => ({ ...prev, [rowIndex]: v }));
  };

  // 그룹별 합계 (현재 입력값 기준)
  const groupSum = useCallback((g) => {
    let sum = 0;
    for (const r of g.rows) {
      const n = Number(getValue(r.rowIndex));
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }, [overrides, initialValues]); // eslint-disable-line react-hooks/exhaustive-deps

  // 전체 합계
  const totalOrder = useMemo(
    () => groups.reduce((s, g) => s + Number(g.total_order_qty || 0), 0),
    [groups],
  );
  const totalShip = useMemo(() => {
    let s = 0;
    for (const g of groups) s += groupSum(g);
    return s;
  }, [groups, groupSum]);

  const handleSave = () => {
    const patches = [];
    for (const g of groups) {
      for (const r of g.rows) {
        const cur = getValue(r.rowIndex);
        const n = Number(cur);
        if (!Number.isFinite(n) || n < 0) continue;
        // 변경된 것만 patch 로 보냄
        if (String(n) !== String(r.confirmed_qty ?? r.order_quantity ?? '')) {
          patches.push({ rowIndex: r.rowIndex, confirmed_qty: n });
        }
      }
    }
    onSave?.(patches);
  };

  const applyAllOrderQty = (g) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of g.rows) next[r.rowIndex] = String(r.order_quantity ?? 0);
      return next;
    });
  };

  const applyAllZero = (g) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const r of g.rows) next[r.rowIndex] = '0';
      return next;
    });
  };

  if (!groups.length) {
    return (
      <div className="stock-adjust-empty">
        <p>PO 에 유효 행이 없습니다.</p>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>닫기</button>
      </div>
    );
  }

  return (
    <>
      <div className="stock-adjust-body">
        <table className="stock-adjust-table">
          <thead>
            <tr>
              <th className="col-barcode">바코드 / 상품</th>
              <th className="col-po">발주번호</th>
              <th className="col-wh">물류센터</th>
              <th className="col-num">주문수량</th>
              <th className="col-num">출고수량</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const sum = groupSum(g);
              const diff = sum - Number(g.total_order_qty || 0);
              return (
                <React.Fragment key={g.sku_barcode || g.sku_id}>
                  <tr className="stock-adjust-group-row">
                    <td colSpan={3}>
                      <div className="stock-adjust-group-title">
                        <span className="stock-adjust-group-title__barcode">{g.sku_barcode || '(바코드 없음)'}</span>
                        <span className="stock-adjust-group-title__name">{g.sku_name}</span>
                        {g.sku_id && <span className="stock-adjust-group-title__id">· SKU {g.sku_id}</span>}
                      </div>
                    </td>
                    <td className="col-num">{g.total_order_qty}</td>
                    <td className={`col-num${diff === 0 ? '' : diff < 0 ? ' is-short' : ' is-over'}`}>
                      {sum}
                      {diff !== 0 && <span className="stock-adjust-diff"> ({diff > 0 ? '+' : ''}{diff})</span>}
                    </td>
                    <td className="col-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--xs"
                        onClick={() => applyAllOrderQty(g)}
                        title="이 SKU 의 모든 발주행을 주문수량대로 출고"
                      >전량</button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--xs"
                        onClick={() => applyAllZero(g)}
                        title="이 SKU 전부 반려(0 처리)"
                      >0</button>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.rowIndex} className="stock-adjust-detail-row">
                      <td className="col-barcode" />
                      <td className="col-po">{r.coupang_order_seq}</td>
                      <td className="col-wh">{r.departure_warehouse}</td>
                      <td className="col-num">{r.order_quantity}</td>
                      <td className="col-num">
                        <input
                          type="number"
                          min="0"
                          className="stock-adjust-input"
                          value={getValue(r.rowIndex)}
                          onChange={(e) => setValue(r.rowIndex, e.target.value)}
                        />
                      </td>
                      <td className="col-actions" />
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>합계 · SKU {groups.length}종 · {groups.reduce((s, g) => s + g.rows.length, 0)}행</th>
              <th className="col-num">{totalOrder}</th>
              <th className={`col-num${totalShip === totalOrder ? '' : totalShip < totalOrder ? ' is-short' : ' is-over'}`}>{totalShip}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>

      <footer className="stock-adjust-footer">
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
          {saving ? '저장 중…' : '💾 저장하고 닫기'}
        </button>
      </footer>
    </>
  );
}
