import React, { useMemo, useState } from 'react';

/**
 * 운송 분배 UI (v3).
 *
 *  1차: 물류센터 카드 — 쉽먼트/밀크런 토글
 *
 *  [밀크런]
 *    배송 설정 (한 줄 flex, wrap):
 *      출고지 · 총박스수 · 팔레트 목록(가로/세로/높이/수량/렌탈사, N개)
 *    SKU 테이블: 발주번호/바코드/상품명/확정수량/비고
 *
 *  [쉽먼트]
 *    배송 설정:
 *      박스 [n] 개 추가 [확인] → 전체 박스 번호 1..N 관리
 *    SKU 테이블: 발주번호/바코드/상품명/확정수량/박스배정(selector+수량)+추가/배정합
 */

export default function TransportView({
  groups, defaults, originList = [], rentalList = [],
  saving, onSave, onCancel,
}) {
  const [overrides, setOverrides] = useState({});
  const [collapsed, setCollapsed] = useState({});

  const initial = useMemo(() => {
    const m = {};
    for (const g of groups) m[g.warehouse] = { ...g.assignment };
    return m;
  }, [groups]);

  const getAssign = (wh) => ({ ...initial[wh], ...overrides[wh] });
  const patchAssign = (wh, patch) => {
    setOverrides((prev) => ({
      ...prev,
      [wh]: { ...(prev[wh] || {}), ...patch },
    }));
  };

  // ── 쉽먼트: 박스 배정 조작 ──
  // 함수형 setOverrides 기반 — 같은 틱에 연속 호출돼도 (add + update 등) 직렬로 누적.
  // 이전 버전은 getAssign 을 호출 시점에 읽어서 stale cur 로 덮어썼음.
  const mutateBoxes = (wh, rowKey, updater) => {
    setOverrides((prev) => {
      const base = { ...(initial[wh] || {}), ...(prev[wh] || {}) };
      const curSkuBoxes = base.skuBoxes || {};
      const curRows = curSkuBoxes[rowKey] || [];
      const nextRows = updater(curRows);
      return {
        ...prev,
        [wh]: {
          ...base,
          skuBoxes: { ...curSkuBoxes, [rowKey]: nextRows },
        },
      };
    });
  };
  const addBoxRow = (wh, rowKey) =>
    mutateBoxes(wh, rowKey, (rows) => [...rows, { boxNo: '', qty: '' }]);
  const updateBoxRow = (wh, rowKey, idx, patch) =>
    mutateBoxes(wh, rowKey, (rows) => rows.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  const removeBoxRow = (wh, rowKey, idx) =>
    mutateBoxes(wh, rowKey, (rows) => rows.filter((_, i) => i !== idx));

  // ── 밀크런: 팔레트 목록 조작 ──
  const getPallets = (wh) => getAssign(wh)?.pallets || [];
  const setPallets = (wh, next) => patchAssign(wh, { pallets: next });
  const addPallet = (wh) => setPallets(wh, [...getPallets(wh), {
    width: defaults.palletWidth ?? '',
    height: defaults.palletHeight ?? '',
    depth: defaults.palletDepth ?? '',
    count: defaults.palletCount ?? '',
    rentalId: defaults.rentalId ?? '',
  }]);
  const updatePallet = (wh, idx, patch) => {
    const cur = getPallets(wh);
    setPallets(wh, cur.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const removePallet = (wh, idx) => {
    const cur = getPallets(wh);
    if (cur.length <= 1) return; // 최소 1개 유지
    setPallets(wh, cur.filter((_, i) => i !== idx));
  };

  // ── 밀크런: SKU 비고 ──
  const setNote = (wh, rowKey, text) => {
    const cur = getAssign(wh);
    patchAssign(wh, { skuNotes: { ...(cur.skuNotes || {}), [rowKey]: text } });
  };

  // ── 저장 ──
  const handleSave = () => {
    const result = {};
    for (const g of groups) {
      const a = getAssign(g.warehouse);
      const type = a.transportType || '쉽먼트';
      const entry = { transportType: type };

      if (type === '쉽먼트') {
        entry.boxCount = Number(a.boxCount) || 0;
        entry.skuBoxes = {};
        for (const sku of g.skus) {
          const boxes = (a.skuBoxes?.[sku.rowKey] || [])
            .map((b) => ({ boxNo: String(b.boxNo ?? '').trim(), qty: Number(b.qty) || 0 }))
            .filter((b) => b.boxNo !== '' && b.qty > 0);
          if (boxes.length) entry.skuBoxes[sku.rowKey] = boxes;
        }
        // 박스별 송장번호 — 사용자 입력만 저장 (빈칸은 런타임에 공용설정으로 fallback).
        const userInv = Array.isArray(a.boxInvoices) ? a.boxInvoices : [];
        entry.boxInvoices = Array.from({ length: entry.boxCount }, (_, i) =>
          String(userInv[i] ?? '').trim()
        );
      } else {
        entry.originId = String(a.originId ?? '');
        entry.totalBoxes = String(a.totalBoxes ?? '');
        entry.pallets = (a.pallets || []).map((p) => ({
          width:    String(p.width    ?? ''),
          height:   String(p.height   ?? ''),
          depth:    String(p.depth    ?? ''),
          count:    String(p.count    ?? ''),
          rentalId: String(p.rentalId ?? ''),
        }));
      }

      // 비고는 쉽먼트/밀크런 공통 저장
      entry.skuNotes = {};
      for (const sku of g.skus) {
        const n = String(a.skuNotes?.[sku.rowKey] ?? '').trim();
        if (n) entry.skuNotes[sku.rowKey] = n;
      }

      result[g.warehouse] = entry;
    }
    onSave?.(result);
  };

  if (!groups.length) {
    return (
      <div className="stock-adjust-empty">
        <p>물류센터 대상 행이 없습니다.</p>
        <button type="button" className="btn btn--secondary" onClick={onCancel}>닫기</button>
      </div>
    );
  }

  const totalSkuCount = groups.reduce((s, g) => s + (g.skus?.length || 0), 0);
  const allCollapsed = groups.length > 0 && groups.every((g) => !!collapsed[g.warehouse]);
  const handleExpandAll = () => setCollapsed({});
  const handleCollapseAll = () => {
    const next = {};
    for (const g of groups) next[g.warehouse] = true;
    setCollapsed(next);
  };

  return (
    <>
      <div className="stock-adjust-body">
        <div className="transport-summary">
          <span className="transport-summary__text">
            총 <strong>{groups.length}</strong>개 창고 · <strong>{totalSkuCount}</strong>개 제품
          </span>
          <div className="transport-summary__spacer" />
          <button
            type="button"
            className="transport-summary__toggle"
            onClick={handleExpandAll}
            disabled={!allCollapsed && groups.every((g) => !collapsed[g.warehouse])}
            title="모든 창고 펼치기"
          >
            ⌄ 전체 펼치기
          </button>
          <button
            type="button"
            className="transport-summary__toggle"
            onClick={handleCollapseAll}
            disabled={allCollapsed}
            title="모든 창고 접기"
          >
            ⌃ 전체 접기
          </button>
        </div>
        <div className="transport-cards">
          {groups.map((g) => (
            <WarehouseCard
              key={g.warehouse}
              group={g}
              assignment={getAssign(g.warehouse)}
              defaults={defaults}
              collapsed={!!collapsed[g.warehouse]}
              originList={originList}
              rentalList={rentalList}
              onToggleCollapse={() => setCollapsed((p) => ({ ...p, [g.warehouse]: !p[g.warehouse] }))}
              onTypeChange={(t) => patchAssign(g.warehouse, { transportType: t })}
              onField={(k, v) => patchAssign(g.warehouse, { [k]: v })}
              // 쉽먼트
              onBoxRowAdd={(rowKey) => addBoxRow(g.warehouse, rowKey)}
              onBoxRowUpdate={(rowKey, idx, patch) => updateBoxRow(g.warehouse, rowKey, idx, patch)}
              onBoxRowRemove={(rowKey, idx) => removeBoxRow(g.warehouse, rowKey, idx)}
              // 밀크런
              onPalletAdd={() => addPallet(g.warehouse)}
              onPalletUpdate={(idx, patch) => updatePallet(g.warehouse, idx, patch)}
              onPalletRemove={(idx) => removePallet(g.warehouse, idx)}
              onNote={(rowKey, text) => setNote(g.warehouse, rowKey, text)}
            />
          ))}
        </div>
      </div>

      <footer className="stock-adjust-footer">
        <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={saving}>취소</button>
        <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중…' : '💾 저장'}
        </button>
      </footer>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
function WarehouseCard({
  group, assignment, defaults, collapsed,
  originList, rentalList,
  onToggleCollapse, onTypeChange, onField,
  onBoxRowAdd, onBoxRowUpdate, onBoxRowRemove,
  onPalletAdd, onPalletUpdate, onPalletRemove,
  onNote,
}) {
  const type = assignment.transportType || '쉽먼트';
  const isMilkrun = type === '밀크런';

  return (
    <section className={`tcard tcard--${isMilkrun ? 'milkrun' : 'shipment'}`}>
      <header className="tcard__header">
        <button type="button" className="tcard__chev" onClick={onToggleCollapse} aria-expanded={!collapsed}>
          {collapsed ? '▶' : '▼'}
        </button>
        <strong className="tcard__wh">{group.warehouse}</strong>
        <span className="tcard__qty">확정수량 {group.total_confirmed}</span>
        <span className="tcard__sku-count">SKU {group.skus.length}종</span>
        <div className="tcard__spacer" />
        <div className="tcard__type" role="radiogroup" aria-label="운송 유형">
          {['쉽먼트', '밀크런'].map((t) => (
            <label key={t} className={`tcard__type-pill${type === t ? ' is-active' : ''}`}>
              <input
                type="radio"
                name={`type-${group.warehouse}`}
                checked={type === t}
                onChange={() => onTypeChange(t)}
              />
              {t}
            </label>
          ))}
        </div>
      </header>

      {!collapsed && (
        <>
          {isMilkrun ? (
            <MilkrunSettings
              assignment={assignment}
              originList={originList}
              rentalList={rentalList}
              onField={onField}
              onPalletAdd={onPalletAdd}
              onPalletUpdate={onPalletUpdate}
              onPalletRemove={onPalletRemove}
            />
          ) : (
            <ShipmentSettings
              assignment={assignment}
              defaults={defaults}
              onField={onField}
            />
          )}

          <SkuTable
            group={group}
            assignment={assignment}
            isMilkrun={isMilkrun}
            onBoxRowAdd={onBoxRowAdd}
            onBoxRowUpdate={onBoxRowUpdate}
            onBoxRowRemove={onBoxRowRemove}
            onNote={onNote}
          />
        </>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
function MilkrunSettings({
  assignment, originList, rentalList,
  onField, onPalletAdd, onPalletUpdate, onPalletRemove,
}) {
  const pallets = assignment.pallets || [];

  return (
    <div className="tcard__settings tcard__settings--milkrun">
      <label className="tcard__field">
        <span>출고지</span>
        <select
          className="stock-adjust-input transport-input--text"
          value={assignment.originId ?? ''}
          onChange={(e) => onField('originId', e.target.value)}
        >
          <option value="">(미지정)</option>
          {originList.map((it) => (
            <option key={it.location_seq} value={it.location_seq}>
              {it.location_name || it.location_seq}
            </option>
          ))}
        </select>
      </label>

      <label className="tcard__field tcard__field--num">
        <span>총 박스수</span>
        <input
          type="number"
          min="0"
          className="stock-adjust-input"
          value={assignment.totalBoxes ?? ''}
          onChange={(e) => onField('totalBoxes', e.target.value)}
        />
      </label>

      <div className="tcard__pallet-list">
        <span className="tcard__pallet-label">팔레트</span>
        {pallets.map((p, idx) => (
          <div key={idx} className="tcard__pallet-row">
            <input
              type="number" min="0" placeholder="가로"
              className="stock-adjust-input tcard__pallet-dim"
              value={p.width ?? ''}
              onChange={(e) => onPalletUpdate(idx, { width: e.target.value })}
            />
            <span className="tcard__pallet-x">×</span>
            <input
              type="number" min="0" placeholder="세로"
              className="stock-adjust-input tcard__pallet-dim"
              value={p.height ?? ''}
              onChange={(e) => onPalletUpdate(idx, { height: e.target.value })}
            />
            <span className="tcard__pallet-x">×</span>
            <input
              type="number" min="0" placeholder="높이"
              className="stock-adjust-input tcard__pallet-dim"
              value={p.depth ?? ''}
              onChange={(e) => onPalletUpdate(idx, { depth: e.target.value })}
            />
            <span className="tcard__pallet-unit">cm</span>
            <input
              type="number" min="0" placeholder="수량"
              className="stock-adjust-input tcard__pallet-count"
              value={p.count ?? ''}
              onChange={(e) => onPalletUpdate(idx, { count: e.target.value })}
            />
            <select
              className="stock-adjust-input tcard__pallet-rental"
              value={p.rentalId ?? ''}
              onChange={(e) => onPalletUpdate(idx, { rentalId: e.target.value })}
            >
              <option value="">(렌탈사 미지정)</option>
              {rentalList.map((it) => (
                <option key={it.id} value={it.id}>{it.id}</option>
              ))}
            </select>
            {pallets.length > 1 && (
              <button
                type="button"
                className="box-cell__remove"
                onClick={() => onPalletRemove(idx)}
                title="이 팔레트 제거"
              >×</button>
            )}
          </div>
        ))}
        <button type="button" className="box-cell__add" onClick={onPalletAdd}>
          + 팔레트 추가
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
const SHIPMENT_BOX_MAX = 9;

function ShipmentSettings({ assignment, defaults, onField }) {
  const boxCount = Math.min(Number(assignment.boxCount) || 0, SHIPMENT_BOX_MAX);
  const fakeInvoices = Array.isArray(defaults?.fakeInvoices) ? defaults.fakeInvoices : [];
  const boxInvoices = Array.isArray(assignment.boxInvoices) ? assignment.boxInvoices : [];

  // 스테퍼 방식 토글 — 박스번호가 연속 1..N 을 유지해야 SKU 배정과 호환됨.
  //   활성 슬롯 클릭 → boxCount = N - 1
  //   비활성 슬롯 클릭 → boxCount = N
  const toggleBox = (n) => {
    const next = n <= boxCount ? n - 1 : n;
    onField('boxCount', next);
  };

  const updateInvoice = (idx, value) => {
    const next = Array.from({ length: SHIPMENT_BOX_MAX }, (_, i) =>
      i === idx ? value : (boxInvoices[i] ?? '')
    );
    onField('boxInvoices', next);
  };

  return (
    <div className="tcard__settings tcard__settings--shipment">
      <div className="tcard__box-slots">
        {Array.from({ length: SHIPMENT_BOX_MAX }, (_, i) => {
          const n = i + 1;
          const active = n <= boxCount;
          return (
            <div key={n} className={`tcard__box-slot${active ? ' is-active' : ''}`}>
              <button
                type="button"
                className="tcard__box-slot-toggle"
                onClick={() => toggleBox(n)}
                aria-pressed={active}
                title={active ? `박스 ${n}..${SHIPMENT_BOX_MAX} 비활성화` : `박스 1..${n} 활성화`}
              >
                #{n}
              </button>
              <input
                type="text"
                className="stock-adjust-input tcard__box-slot-input"
                value={boxInvoices[i] ?? ''}
                placeholder={fakeInvoices[i] || ''}
                onChange={(e) => updateInvoice(i, e.target.value)}
                disabled={!active}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
function SkuTable({
  group, assignment, isMilkrun,
  onBoxRowAdd, onBoxRowUpdate, onBoxRowRemove,
  onNote,
}) {
  const boxCount = Number(assignment.boxCount) || 0;
  const boxNumbers = Array.from({ length: boxCount }, (_, i) => i + 1);

  const renderAssignCell = (sku) => {
    const rows = assignment.skuBoxes?.[sku.rowKey] || [];
    // 쉽먼트 기본 1줄 — 저장된 게 없으면 빈 행 하나 보여주기
    const displayRows = rows.length > 0 ? rows : [{ boxNo: '', qty: '' }];

    return (
      <div className="box-cell">
        {displayRows.map((b, idx) => (
          <div key={idx} className="box-cell__row">
            <select
              className="box-cell__num box-cell__num--no"
              value={b.boxNo ?? ''}
              onChange={(e) => {
                // 저장된 행이 없으면 추가 시점에 rows 생성
                if (rows.length === 0) {
                  onBoxRowAdd(sku.rowKey);
                  // 다음 tick 에 update 가 적용되도록 rAF 대기 없이 바로 set
                  onBoxRowUpdate(sku.rowKey, 0, { boxNo: e.target.value });
                } else {
                  onBoxRowUpdate(sku.rowKey, idx, { boxNo: e.target.value });
                }
              }}
              disabled={boxCount === 0}
            >
              <option value="">{boxCount === 0 ? '(박스 설정 필요)' : '박스#'}</option>
              {boxNumbers.map((n) => (
                <option key={n} value={n}>박스 {n}</option>
              ))}
            </select>
            <input
              type="number" min="0" placeholder="수량"
              className="box-cell__num box-cell__num--qty"
              value={b.qty ?? ''}
              onChange={(e) => {
                if (rows.length === 0) {
                  onBoxRowAdd(sku.rowKey);
                  onBoxRowUpdate(sku.rowKey, 0, { qty: e.target.value });
                } else {
                  onBoxRowUpdate(sku.rowKey, idx, { qty: e.target.value });
                }
              }}
              disabled={boxCount === 0}
            />
            {rows.length > 0 && rows.length > 1 && (
              <button
                type="button"
                className="box-cell__remove"
                onClick={() => onBoxRowRemove(sku.rowKey, idx)}
                title="이 행 제거"
              >×</button>
            )}
          </div>
        ))}
        {boxCount > 0 && (
          <button type="button" className="box-cell__add" onClick={() => onBoxRowAdd(sku.rowKey)}>
            + 박스 행 추가
          </button>
        )}
      </div>
    );
  };

  const sumFor = (sku) => {
    const rows = assignment.skuBoxes?.[sku.rowKey] || [];
    return rows.reduce((s, b) => s + (Number(b.qty) || 0), 0);
  };

  const renderNoteCell = (sku) => (
    <input
      type="text"
      className="stock-adjust-input transport-note-input"
      placeholder="비고 (선택)"
      value={assignment.skuNotes?.[sku.rowKey] ?? ''}
      onChange={(e) => onNote(sku.rowKey, e.target.value)}
    />
  );

  return (
    <table className="tcard__sku-table">
      <thead>
        <tr>
          <th className="col-po">발주번호</th>
          <th className="col-barcode">상품바코드</th>
          <th>상품명</th>
          <th className="col-num">확정</th>
          {isMilkrun ? (
            <th className="col-note">비고</th>
          ) : (
            <>
              <th className="col-boxes">박스 배정</th>
              <th className="col-sum">배정합</th>
              <th className="col-note">비고</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {group.skus.map((sku) => {
          const sum = isMilkrun ? 0 : sumFor(sku);
          const diff = sum - sku.confirmed_qty;
          const statusClass = !isMilkrun
            ? (diff === 0 && sum > 0 ? 'is-ok' : diff > 0 ? 'is-over' : diff < 0 ? 'is-short' : 'is-none')
            : '';
          return (
            <tr key={sku.rowKey}>
              <td className="col-po">{sku.coupang_order_seq}</td>
              <td className="col-barcode">{sku.sku_barcode}</td>
              <td className="col-name" title={sku.sku_name}>{sku.sku_name}</td>
              <td className="col-num">{sku.confirmed_qty}</td>
              {isMilkrun ? (
                <td className="col-note">{renderNoteCell(sku)}</td>
              ) : (
                <>
                  <td className="col-boxes">{renderAssignCell(sku)}</td>
                  <td className={`col-sum ${statusClass}`}>
                    {sum}/{sku.confirmed_qty}
                    {sum > 0 && diff === 0 && <span className="tcard__sum-mark"> ✓</span>}
                    {sum > 0 && diff !== 0 && <span className="tcard__sum-mark"> ({diff > 0 ? '+' : ''}{diff})</span>}
                  </td>
                  <td className="col-note">{renderNoteCell(sku)}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
