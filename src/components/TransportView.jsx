import React, { useEffect, useMemo, useState } from 'react';

/**
 * 운송 분배 UI (v4 — lot 기반).
 *
 *  한 물류센터 = 여러 lot 혼재 가능:
 *    - 쉽먼트 lot: boxCount · boxInvoices[] · items[{rowKey, qty, boxNo}]
 *    - 밀크런 lot: originId · totalBoxes · pallets[] · items[{rowKey, qty, palletNo}]
 *
 *  UI 구조:
 *    WarehouseCard
 *      ├─ header (센터명 · 총확정 · 미배정 배지 · 접기)
 *      ├─ Lot 타일 리스트 (각 타일 접혀있음, 클릭 시 펼쳐 편집)
 *      ├─ + 쉽먼트 / + 밀크런 버튼 → AddLotModal
 *      └─ 미배정 SKU 섹션 (선택: 비고 입력)
 *
 *  저장: `{ [wh]: { lots, skuNotes } }` — 그대로 transport:save 에 전달.
 */

const TYPES = { SHIPMENT: '쉽먼트', MILKRUN: '밀크런' };

function makeLotId() {
  return `lot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultShipmentLot(items) {
  return {
    id: makeLotId(),
    type: TYPES.SHIPMENT,
    boxCount: 1,
    boxInvoices: [],
    items: items || [],
  };
}
function buildDefaultMilkrunLot(defaults, items) {
  const firstPreset = Array.isArray(defaults?.palletPresets) && defaults.palletPresets[0]?.name || '';
  return {
    id: makeLotId(),
    type: TYPES.MILKRUN,
    originId: defaults?.originId || '',
    totalBoxes: defaults?.totalBoxes || '',
    pallets: [{ presetName: firstPreset, boxCount: '' }],
    items: items || [],
  };
}

// ── lot 내 rowKey 별 배정합 ──
function sumLotQtyByRow(lot, rowKey) {
  return (lot.items || []).reduce(
    (s, it) => (it.rowKey === rowKey ? s + (Number(it.qty) || 0) : s),
    0,
  );
}
// ── 창고 전체에서 rowKey 별 총 배정합 ──
function sumAssignedQty(lots, rowKey) {
  return (lots || []).reduce(
    (s, lot) => s + sumLotQtyByRow(lot, rowKey),
    0,
  );
}

// ──────────────────────────────────────────────────────────────
export default function TransportView({
  groups, defaults, originList = [],
  saving, onSave, onCancel,
}) {
  // lotsByWh: { [wh]: {lots, skuNotes} }
  const [lotsByWh, setLotsByWh] = useState(() => initLotsByWh(groups, defaults));
  const [collapsedWh, setCollapsedWh] = useState({});
  const [expandedLotId, setExpandedLotId] = useState(null);
  const [addModal, setAddModal] = useState(null); // { wh, type }

  // groups 가 재갱신되면 (load 새로) 재초기화
  useEffect(() => {
    setLotsByWh(initLotsByWh(groups, defaults));
  }, [groups, defaults]);

  const getWh = (wh) => lotsByWh[wh] || { lots: [], skuNotes: {} };
  const patchWh = (wh, patch) => {
    setLotsByWh((prev) => ({
      ...prev,
      [wh]: { ...getWhFrom(prev, wh), ...patch },
    }));
  };
  const mutateLots = (wh, updater) => {
    setLotsByWh((prev) => {
      const cur = getWhFrom(prev, wh);
      return { ...prev, [wh]: { ...cur, lots: updater(cur.lots) } };
    });
  };
  const mutateLot = (wh, lotId, updater) => {
    mutateLots(wh, (lots) => lots.map((l) => (l.id === lotId ? updater(l) : l)));
  };

  const setNote = (wh, rowKey, text) => {
    setLotsByWh((prev) => {
      const cur = getWhFrom(prev, wh);
      const next = { ...cur.skuNotes };
      const trimmed = String(text ?? '').trim();
      if (trimmed === '') delete next[rowKey];
      else next[rowKey] = text;
      return { ...prev, [wh]: { ...cur, skuNotes: next } };
    });
  };

  // ── Lot 조작 ──
  const openAddLot = (wh, type) => setAddModal({ wh, type });
  const closeAddLot = () => setAddModal(null);
  const confirmAddLot = (wh, type, selections) => {
    // selections: [{rowKey, qty}]
    const items = selections
      .map((s) => ({ rowKey: s.rowKey, qty: Number(s.qty) || 0 }))
      .filter((s) => s.qty > 0);
    let newLot;
    if (type === TYPES.SHIPMENT) {
      newLot = buildDefaultShipmentLot(items.map((it) => ({ ...it, boxNo: '' })));
    } else {
      newLot = buildDefaultMilkrunLot(defaults, items.map((it) => ({ ...it, palletNo: '' })));
    }
    mutateLots(wh, (lots) => [...lots, newLot]);
    setExpandedLotId(newLot.id);
    closeAddLot();
  };
  const removeLot = (wh, lotId) => {
    if (!window.confirm('이 lot 을 삭제할까요? 해당 lot 의 모든 배정이 사라집니다.')) return;
    mutateLots(wh, (lots) => lots.filter((l) => l.id !== lotId));
    setExpandedLotId((prev) => (prev === lotId ? null : prev));
  };

  // ── Lot 내부 편집 함수 ──
  const updateLotField = (wh, lotId, patch) =>
    mutateLot(wh, lotId, (lot) => ({ ...lot, ...patch }));

  const updateLotItem = (wh, lotId, rowKey, idx, patch) =>
    mutateLot(wh, lotId, (lot) => {
      const rowItems = (lot.items || []).filter((it) => it.rowKey === rowKey);
      const others = (lot.items || []).filter((it) => it.rowKey !== rowKey);
      const nextRowItems = rowItems.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      return { ...lot, items: [...others, ...nextRowItems] };
    });
  const addLotItemRow = (wh, lotId, rowKey) =>
    mutateLot(wh, lotId, (lot) => ({
      ...lot,
      items: [...(lot.items || []), {
        rowKey, qty: 0,
        ...(lot.type === TYPES.SHIPMENT ? { boxNo: '' } : { palletNo: '' }),
      }],
    }));
  const removeLotItemRow = (wh, lotId, rowKey, idx) =>
    mutateLot(wh, lotId, (lot) => {
      const rowItems = (lot.items || []).filter((it) => it.rowKey === rowKey);
      const others = (lot.items || []).filter((it) => it.rowKey !== rowKey);
      const nextRowItems = rowItems.filter((_, i) => i !== idx);
      return { ...lot, items: [...others, ...nextRowItems] };
    });
  const removeLotSku = (wh, lotId, rowKey) => {
    mutateLot(wh, lotId, (lot) => ({
      ...lot,
      items: (lot.items || []).filter((it) => it.rowKey !== rowKey),
    }));
  };
  const addSkuToLot = (wh, lotId, rowKey, qty) => {
    mutateLot(wh, lotId, (lot) => ({
      ...lot,
      items: [...(lot.items || []), {
        rowKey,
        qty: Number(qty) || 0,
        ...(lot.type === TYPES.SHIPMENT ? { boxNo: '' } : { palletNo: '' }),
      }],
    }));
  };

  // ── 밀크런 팔레트 관리 ──
  const updateLotPallets = (wh, lotId, updater) =>
    mutateLot(wh, lotId, (lot) => ({ ...lot, pallets: updater(lot.pallets || []) }));

  // ── 저장 ──
  const handleSave = () => {
    const result = {};
    for (const g of groups) {
      const wh = g.warehouse;
      const cur = getWh(wh);
      const lotsClean = (cur.lots || [])
        .filter((l) => l && (l.type === TYPES.SHIPMENT || l.type === TYPES.MILKRUN))
        .map((l) => cleanLotForSave(l));
      const notesClean = {};
      for (const [k, v] of Object.entries(cur.skuNotes || {})) {
        const t = String(v ?? '').trim();
        if (t) notesClean[k] = v;
      }
      result[wh] = { lots: lotsClean, skuNotes: notesClean };
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
  const allCollapsed = groups.length > 0 && groups.every((g) => !!collapsedWh[g.warehouse]);
  const handleExpandAll = () => setCollapsedWh({});
  const handleCollapseAll = () => {
    const next = {};
    for (const g of groups) next[g.warehouse] = true;
    setCollapsedWh(next);
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
            disabled={!allCollapsed && groups.every((g) => !collapsedWh[g.warehouse])}
            title="모든 창고 펼치기"
          >⌄ 전체 펼치기</button>
          <button
            type="button"
            className="transport-summary__toggle"
            onClick={handleCollapseAll}
            disabled={allCollapsed}
            title="모든 창고 접기"
          >⌃ 전체 접기</button>
        </div>

        <div className="transport-cards">
          {groups.map((g) => (
            <WarehouseCard
              key={g.warehouse}
              group={g}
              data={getWh(g.warehouse)}
              defaults={defaults}
              originList={originList}
              collapsed={!!collapsedWh[g.warehouse]}
              expandedLotId={expandedLotId}
              onToggleCollapse={() =>
                setCollapsedWh((p) => ({ ...p, [g.warehouse]: !p[g.warehouse] }))
              }
              onToggleLot={(lotId) =>
                setExpandedLotId((prev) => (prev === lotId ? null : lotId))
              }
              onOpenAddLot={(type) => openAddLot(g.warehouse, type)}
              onRemoveLot={(lotId) => removeLot(g.warehouse, lotId)}
              onLotFieldChange={(lotId, patch) => updateLotField(g.warehouse, lotId, patch)}
              onLotPalletsChange={(lotId, updater) => updateLotPallets(g.warehouse, lotId, updater)}
              onAddItemRow={(lotId, rowKey) => addLotItemRow(g.warehouse, lotId, rowKey)}
              onUpdateItem={(lotId, rowKey, idx, patch) =>
                updateLotItem(g.warehouse, lotId, rowKey, idx, patch)
              }
              onRemoveItemRow={(lotId, rowKey, idx) =>
                removeLotItemRow(g.warehouse, lotId, rowKey, idx)
              }
              onRemoveSkuFromLot={(lotId, rowKey) => removeLotSku(g.warehouse, lotId, rowKey)}
              onAddSkuToLot={(lotId, rowKey, qty) =>
                addSkuToLot(g.warehouse, lotId, rowKey, qty)
              }
              onNote={(rowKey, text) => setNote(g.warehouse, rowKey, text)}
            />
          ))}
        </div>
      </div>

      {addModal && (
        <AddLotModal
          group={groups.find((g) => g.warehouse === addModal.wh)}
          data={getWh(addModal.wh)}
          type={addModal.type}
          onCancel={closeAddLot}
          onConfirm={(sel) => confirmAddLot(addModal.wh, addModal.type, sel)}
        />
      )}

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
function getWhFrom(map, wh) {
  return map[wh] || { lots: [], skuNotes: {} };
}

function initLotsByWh(groups /* , defaults */) {
  // 저장된 lot 만 normalize 해서 그대로 반환. 없으면 빈 배열 — 사용자가
  // '+ 쉽먼트' / '+ 밀크런' 버튼으로 직접 lot 을 만들도록 유도.
  const out = {};
  for (const g of groups) {
    const asn = g.assignment || {};
    const savedLots = Array.isArray(asn.lots) ? asn.lots : [];
    out[g.warehouse] = {
      lots: savedLots.map(normalizeLot).filter(Boolean),
      skuNotes: asn.skuNotes || {},
    };
  }
  return out;
}

function normalizeLot(lot) {
  if (!lot || typeof lot !== 'object') return null;
  const base = {
    id: lot.id || makeLotId(),
    type: lot.type === TYPES.MILKRUN ? TYPES.MILKRUN : TYPES.SHIPMENT,
    items: Array.isArray(lot.items) ? lot.items.slice() : [],
  };
  if (base.type === TYPES.SHIPMENT) {
    base.boxCount = Number(lot.boxCount) || 0;
    base.boxInvoices = Array.isArray(lot.boxInvoices) ? lot.boxInvoices.slice() : [];
  } else {
    base.originId = String(lot.originId ?? '');
    base.totalBoxes = String(lot.totalBoxes ?? '');
    base.pallets = Array.isArray(lot.pallets) && lot.pallets.length
      ? lot.pallets.map((p) => ({
          presetName: String(p.presetName ?? ''),
          boxCount: String(p.boxCount ?? ''),
        }))
      : [{ presetName: '', boxCount: '' }];
  }
  return base;
}

function cleanLotForSave(lot) {
  const base = { id: lot.id, type: lot.type };
  if (lot.type === TYPES.SHIPMENT) {
    base.boxCount = Number(lot.boxCount) || 0;
    base.boxInvoices = Array.from({ length: base.boxCount }, (_, i) =>
      String((lot.boxInvoices || [])[i] ?? '').trim(),
    );
    base.items = (lot.items || [])
      .map((it) => ({
        rowKey: String(it.rowKey),
        qty: Number(it.qty) || 0,
        boxNo: String(it.boxNo ?? '').trim(),
      }))
      .filter((it) => it.qty > 0);
  } else {
    base.originId = String(lot.originId ?? '');
    base.totalBoxes = String(lot.totalBoxes ?? '');
    base.pallets = (lot.pallets || []).map((p) => ({
      presetName: String(p.presetName ?? ''),
      boxCount: String(p.boxCount ?? ''),
    }));
    base.items = (lot.items || [])
      .map((it) => ({
        rowKey: String(it.rowKey),
        qty: Number(it.qty) || 0,
        palletNo: String(it.palletNo ?? '').trim(),
      }))
      .filter((it) => it.qty > 0);
  }
  return base;
}

// ──────────────────────────────────────────────────────────────
function WarehouseCard({
  group, data, defaults, originList,
  collapsed, expandedLotId,
  onToggleCollapse, onToggleLot, onOpenAddLot, onRemoveLot,
  onLotFieldChange, onLotPalletsChange,
  onAddItemRow, onUpdateItem, onRemoveItemRow,
  onRemoveSkuFromLot, onAddSkuToLot, onNote,
}) {
  const lots = data.lots || [];
  const skuNotes = data.skuNotes || {};

  // 미배정 수량 계산
  const unassigned = useMemo(() => {
    const arr = [];
    for (const sku of group.skus) {
      const assigned = sumAssignedQty(lots, sku.rowKey);
      const remain = sku.confirmed_qty - assigned;
      if (remain !== 0) arr.push({ sku, assigned, remain });
    }
    return arr;
  }, [lots, group.skus]);

  const unassignedTotal = unassigned.reduce((s, u) => s + Math.max(0, u.remain), 0);
  const overTotal = unassigned.reduce((s, u) => s + Math.max(0, -u.remain), 0);

  return (
    <section className="tcard tcard--paper">
      <header className="tcard__header">
        <button type="button" className="tcard__chev" onClick={onToggleCollapse} aria-expanded={!collapsed}>
          {collapsed ? '▶' : '▼'}
        </button>
        <strong className="tcard__wh">{group.warehouse}</strong>
        <span className="tcard__qty">확정수량 {group.total_confirmed}</span>
        <span className="tcard__sku-count">SKU {group.skus.length}종</span>
        <span className="tcard__lot-count">lot {lots.length}개</span>
        <div className="tcard__spacer" />
        {unassignedTotal > 0 && (
          <span className="tcard__badge tcard__badge--warn">미배정 {unassignedTotal}</span>
        )}
        {overTotal > 0 && (
          <span className="tcard__badge tcard__badge--danger">초과 {overTotal}</span>
        )}
        {unassignedTotal === 0 && overTotal === 0 && (
          <span className="tcard__badge tcard__badge--ok">전량 배정 완료</span>
        )}
      </header>

      {!collapsed && (
        <div className="tcard__body">
          {lots.length === 0 && (
            <div className="tcard__empty">
              아직 lot 이 없습니다. 아래 + 버튼으로 추가하세요.
            </div>
          )}

          {lots.map((lot) => (
            <LotItem
              key={lot.id}
              lot={lot}
              group={group}
              defaults={defaults}
              originList={originList}
              expanded={expandedLotId === lot.id}
              onToggle={() => onToggleLot(lot.id)}
              onRemove={() => onRemoveLot(lot.id)}
              onFieldChange={(patch) => onLotFieldChange(lot.id, patch)}
              onPalletsChange={(updater) => onLotPalletsChange(lot.id, updater)}
              onAddItemRow={(rowKey) => onAddItemRow(lot.id, rowKey)}
              onUpdateItem={(rowKey, idx, patch) => onUpdateItem(lot.id, rowKey, idx, patch)}
              onRemoveItemRow={(rowKey, idx) => onRemoveItemRow(lot.id, rowKey, idx)}
              onRemoveSku={(rowKey) => onRemoveSkuFromLot(lot.id, rowKey)}
              onAddSku={(rowKey, qty) => onAddSkuToLot(lot.id, rowKey, qty)}
              unassignedForLotAdd={unassigned.filter((u) => u.remain > 0)}
            />
          ))}

          <div className="tcard__actions">
            <button
              type="button"
              className="btn btn--sm tcard__add-lot tcard__add-lot--shipment"
              onClick={() => onOpenAddLot(TYPES.SHIPMENT)}
            >+ 쉽먼트 추가</button>
            <button
              type="button"
              className="btn btn--sm tcard__add-lot tcard__add-lot--milkrun"
              onClick={() => onOpenAddLot(TYPES.MILKRUN)}
            >+ 밀크런 추가</button>
          </div>

          <UnassignedSkuSection
            skus={group.skus}
            lots={lots}
            skuNotes={skuNotes}
            onNote={onNote}
          />
        </div>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
function LotItem({
  lot, group, defaults, originList,
  expanded, onToggle, onRemove,
  onFieldChange, onPalletsChange,
  onAddItemRow, onUpdateItem, onRemoveItemRow, onRemoveSku, onAddSku,
  unassignedForLotAdd,
}) {
  const isMilk = lot.type === TYPES.MILKRUN;
  const lotItemsByRow = useMemo(() => {
    const m = {};
    for (const it of (lot.items || [])) {
      (m[it.rowKey] ||= []).push(it);
    }
    return m;
  }, [lot.items]);

  const totalAssigned = (lot.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const skuInLot = Object.keys(lotItemsByRow).length;
  const origin = isMilk ? originList.find((o) => String(o.location_seq) === String(lot.originId)) : null;

  const summary = isMilk
    ? `출고지 ${origin?.location_name || lot.originId || '(미지정)'} · 팔레트 ${(lot.pallets || []).length}개 · ${skuInLot}종 · 합계 ${totalAssigned}`
    : `박스 ${lot.boxCount}개 · ${skuInLot}종 · 합계 ${totalAssigned}`;

  return (
    <div className={`lot-tile lot-tile--${isMilk ? 'milkrun' : 'shipment'}${expanded ? ' is-expanded' : ''}`}>
      <div className="lot-tile__summary" onClick={onToggle}>
        <span className={`lot-tile__badge lot-tile__badge--${isMilk ? 'milkrun' : 'shipment'}`}>
          {isMilk ? '🚛 밀크런' : '📦 쉽먼트'}
        </span>
        <span className="lot-tile__text">{summary}</span>
        <div className="lot-tile__spacer" />
        <button
          type="button"
          className="lot-tile__remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="이 lot 삭제"
        >🗑</button>
        <span className="lot-tile__chev">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="lot-tile__editor">
          {isMilk ? (
            <MilkrunLotEditor
              lot={lot}
              defaults={defaults}
              originList={originList}
              onFieldChange={onFieldChange}
              onPalletsChange={onPalletsChange}
            />
          ) : (
            <ShipmentLotEditor
              lot={lot}
              defaults={defaults}
              onFieldChange={onFieldChange}
            />
          )}

          <LotSkuTable
            lot={lot}
            group={group}
            lotItemsByRow={lotItemsByRow}
            onAddItemRow={onAddItemRow}
            onUpdateItem={onUpdateItem}
            onRemoveItemRow={onRemoveItemRow}
            onRemoveSku={onRemoveSku}
            onAddSku={onAddSku}
            unassignedForLotAdd={unassignedForLotAdd}
          />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
const SHIPMENT_BOX_MAX = 9;

function ShipmentLotEditor({ lot, defaults, onFieldChange }) {
  const boxCount = Math.min(Number(lot.boxCount) || 0, SHIPMENT_BOX_MAX);
  const fakeInvoices = Array.isArray(defaults?.fakeInvoices) ? defaults.fakeInvoices : [];
  const boxInvoices = Array.isArray(lot.boxInvoices) ? lot.boxInvoices : [];

  const toggleBox = (n) => {
    const next = n <= boxCount ? n - 1 : n;
    onFieldChange({ boxCount: next });
  };
  const updateInvoice = (idx, value) => {
    const next = Array.from({ length: SHIPMENT_BOX_MAX }, (_, i) =>
      i === idx ? value : (boxInvoices[i] ?? ''),
    );
    onFieldChange({ boxInvoices: next });
  };

  return (
    <div className="lot-editor__settings lot-editor__settings--shipment">
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
              >#{n}</button>
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
function MilkrunLotEditor({ lot, defaults, originList, onFieldChange, onPalletsChange }) {
  const pallets = Array.isArray(lot.pallets) ? lot.pallets : [];
  const presets = Array.isArray(defaults?.palletPresets) ? defaults.palletPresets : [];
  const hasPresets = presets.length > 0;

  const addPallet = () => {
    const firstPreset = presets[0]?.name || '';
    onPalletsChange((cur) => [...cur, { presetName: firstPreset, boxCount: '' }]);
  };
  const updatePallet = (idx, patch) => {
    onPalletsChange((cur) => cur.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const removePallet = (idx) => {
    onPalletsChange((cur) => cur.length <= 1 ? cur : cur.filter((_, i) => i !== idx));
  };

  return (
    <div className="lot-editor__settings lot-editor__settings--milkrun">
      <div className="tcard__settings-row">
        <label className="tcard__field">
          <span>출고지</span>
          <select
            className="stock-adjust-input transport-input--text"
            value={lot.originId ?? ''}
            onChange={(e) => onFieldChange({ originId: e.target.value })}
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
            type="number" min="0"
            className="stock-adjust-input"
            value={lot.totalBoxes ?? ''}
            onChange={(e) => onFieldChange({ totalBoxes: e.target.value })}
          />
        </label>
      </div>

      <div className="tcard__pallet-section">
        <div className="tcard__pallet-section-head">
          <span className="tcard__pallet-label">팔레트</span>
          {!hasPresets && (
            <span className="tcard__pallet-warn">
              ⚠ 팔레트 프리셋이 설정되지 않았습니다. 설정 → 팔레트 프리셋 관리에서 추가하세요.
            </span>
          )}
        </div>
        <div className="tcard__pallet-strip">
          {pallets.map((p, idx) => {
            const preset = presets.find((pr) => pr.name === p.presetName);
            return (
              <div key={idx} className="tcard__pallet-block">
                <div className="tcard__pallet-block-head">
                  <span className="tcard__pallet-no">#{idx + 1}</span>
                  {pallets.length > 1 && (
                    <button
                      type="button"
                      className="box-cell__remove tcard__pallet-remove"
                      onClick={() => removePallet(idx)}
                      title="이 팔레트 제거"
                    >×</button>
                  )}
                </div>
                <select
                  className="stock-adjust-input tcard__pallet-preset"
                  value={p.presetName ?? ''}
                  onChange={(e) => updatePallet(idx, { presetName: e.target.value })}
                  disabled={!hasPresets}
                >
                  <option value="">(프리셋 선택)</option>
                  {presets.map((pr) => (
                    <option key={pr.name} value={pr.name}>{pr.name}</option>
                  ))}
                </select>
                <label className="tcard__pallet-boxcount">
                  <span>박스 수량</span>
                  <input
                    type="number" min="0" placeholder="0"
                    className="stock-adjust-input"
                    value={p.boxCount ?? ''}
                    onChange={(e) => updatePallet(idx, { boxCount: e.target.value })}
                  />
                </label>
                {preset && (
                  <div className="tcard__pallet-meta">
                    <div>{preset.width} × {preset.height} × {preset.depth} cm</div>
                    {preset.rentalId && <div className="tcard__pallet-rental-label">{preset.rentalId}</div>}
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="tcard__pallet-add"
            onClick={addPallet}
            disabled={!hasPresets}
            title={hasPresets ? '팔레트 추가' : '프리셋이 설정돼야 추가할 수 있습니다'}
          >+ 팔레트 추가</button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
function LotSkuTable({
  lot, group, lotItemsByRow,
  onAddItemRow, onUpdateItem, onRemoveItemRow, onRemoveSku, onAddSku,
  unassignedForLotAdd,
}) {
  const isMilk = lot.type === TYPES.MILKRUN;
  const boxCount = Number(lot.boxCount) || 0;
  const slotNumbers = isMilk
    ? (lot.pallets || []).map((_, i) => i + 1)
    : Array.from({ length: boxCount }, (_, i) => i + 1);

  // 이 lot 에 실제 담긴 SKU rowKey 목록
  const rowKeys = Object.keys(lotItemsByRow);
  const skuMap = useMemo(() => {
    const m = {};
    for (const s of group.skus) m[s.rowKey] = s;
    return m;
  }, [group.skus]);

  const [addSkuKey, setAddSkuKey] = useState('');

  const handleAddExistingSku = () => {
    if (!addSkuKey) return;
    const unassigned = unassignedForLotAdd.find((u) => u.sku.rowKey === addSkuKey);
    const defaultQty = unassigned ? unassigned.remain : 0;
    onAddSku(addSkuKey, defaultQty);
    setAddSkuKey('');
  };

  const renderAssignCell = (sku) => {
    const rows = lotItemsByRow[sku.rowKey] || [];
    const key = isMilk ? 'palletNo' : 'boxNo';
    const label = isMilk ? '팔레트' : '박스';

    return (
      <div className="box-cell">
        {rows.map((it, idx) => (
          <div key={idx} className="box-cell__row">
            <select
              className="box-cell__num box-cell__num--no"
              value={it[key] ?? ''}
              onChange={(e) => onUpdateItem(sku.rowKey, idx, { [key]: e.target.value })}
              disabled={slotNumbers.length === 0}
            >
              <option value="">{slotNumbers.length === 0 ? `(${label} 설정 필요)` : `${label}#`}</option>
              {slotNumbers.map((n) => (
                <option key={n} value={n}>{label} {n}</option>
              ))}
            </select>
            <input
              type="number" min="0" placeholder="수량"
              className="box-cell__num box-cell__num--qty"
              value={it.qty ?? ''}
              onChange={(e) => onUpdateItem(sku.rowKey, idx, { qty: e.target.value })}
            />
            {rows.length > 1 && (
              <button
                type="button"
                className="box-cell__remove"
                onClick={() => onRemoveItemRow(sku.rowKey, idx)}
                title="이 행 제거"
              >×</button>
            )}
          </div>
        ))}
        <button type="button" className="box-cell__add" onClick={() => onAddItemRow(sku.rowKey)}>
          + {label} 행 추가
        </button>
      </div>
    );
  };

  const sumFor = (sku) =>
    (lotItemsByRow[sku.rowKey] || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);

  const addableSkus = unassignedForLotAdd.filter((u) => !lotItemsByRow[u.sku.rowKey]);

  return (
    <table className="tcard__sku-table lot-editor__table">
      <thead>
        <tr>
          <th className="col-po">발주번호</th>
          <th className="col-barcode">상품바코드</th>
          <th>상품명</th>
          <th className="col-num">이 lot 배정</th>
          <th className="col-boxes">{isMilk ? '팔레트 배정' : '박스 배정'}</th>
          <th className="col-sum">합계</th>
          <th className="col-actions" />
        </tr>
      </thead>
      <tbody>
        {rowKeys.length === 0 && (
          <tr>
            <td colSpan={7} className="lot-editor__empty">
              이 lot 에 아직 SKU 가 없습니다. 아래에서 추가하세요.
            </td>
          </tr>
        )}
        {rowKeys.map((rk) => {
          const sku = skuMap[rk];
          if (!sku) return null;
          const sum = sumFor(sku);
          return (
            <tr key={rk}>
              <td className="col-po">{sku.coupang_order_seq}</td>
              <td className="col-barcode">{sku.sku_barcode}</td>
              <td className="col-name" title={sku.sku_name}>{sku.sku_name}</td>
              <td className="col-num">{sum}</td>
              <td className="col-boxes">{renderAssignCell(sku)}</td>
              <td className="col-sum">{sum}</td>
              <td className="col-actions">
                <button
                  type="button"
                  className="box-cell__remove"
                  onClick={() => onRemoveSku(sku.rowKey)}
                  title="이 lot 에서 SKU 제거"
                >×</button>
              </td>
            </tr>
          );
        })}
      </tbody>
      {addableSkus.length > 0 && (
        <tfoot>
          <tr>
            <td colSpan={7} className="lot-editor__add-sku">
              <span>+ SKU 추가</span>
              <select
                className="stock-adjust-input"
                value={addSkuKey}
                onChange={(e) => setAddSkuKey(e.target.value)}
              >
                <option value="">(미배정 SKU 선택)</option>
                {addableSkus.map((u) => (
                  <option key={u.sku.rowKey} value={u.sku.rowKey}>
                    {u.sku.sku_barcode} · {u.sku.sku_name} · 남은 {u.remain}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={handleAddExistingSku}
                disabled={!addSkuKey}
              >추가</button>
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// ──────────────────────────────────────────────────────────────
function UnassignedSkuSection({ skus, lots, skuNotes, onNote }) {
  const rows = useMemo(() => {
    return skus.map((sku) => {
      const assigned = sumAssignedQty(lots, sku.rowKey);
      return { sku, assigned, remain: sku.confirmed_qty - assigned };
    });
  }, [skus, lots]);

  const unassigned = rows.filter((r) => r.remain > 0);
  const over = rows.filter((r) => r.remain < 0);

  return (
    <div className="unassigned-section">
      <div className="unassigned-section__head">
        <span className="unassigned-section__title">SKU 배정 현황 · 비고</span>
      </div>
      <table className="unassigned-section__table">
        <thead>
          <tr>
            <th className="col-po">발주번호</th>
            <th className="col-barcode">상품바코드</th>
            <th>상품명</th>
            <th className="col-num">확정</th>
            <th className="col-num">배정</th>
            <th className="col-num">잔여</th>
            <th className="col-note">비고</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const state =
              r.remain === 0 ? 'is-ok' :
              r.remain > 0 ? 'is-short' :
              'is-over';
            return (
              <tr key={r.sku.rowKey} className={`unassigned-row ${state}`}>
                <td className="col-po">{r.sku.coupang_order_seq}</td>
                <td className="col-barcode">{r.sku.sku_barcode}</td>
                <td className="col-name" title={r.sku.sku_name}>{r.sku.sku_name}</td>
                <td className="col-num">{r.sku.confirmed_qty}</td>
                <td className="col-num">{r.assigned}</td>
                <td className={`col-num col-sum ${state}`}>
                  {r.remain === 0 ? '✓' : (r.remain > 0 ? `-${r.remain}` : `+${-r.remain}`)}
                </td>
                <td className="col-note">
                  <input
                    type="text"
                    className="stock-adjust-input transport-note-input"
                    placeholder="비고 (선택)"
                    value={skuNotes[r.sku.rowKey] ?? ''}
                    onChange={(e) => onNote(r.sku.rowKey, e.target.value)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(unassigned.length > 0 || over.length > 0) && (
        <div className="unassigned-section__note">
          {unassigned.length > 0 && <span>⚠ 미배정 {unassigned.length}종</span>}
          {over.length > 0 && <span style={{ marginLeft: 12, color: '#b5281f' }}>⚠ 초과 {over.length}종</span>}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
function AddLotModal({ group, data, type, onCancel, onConfirm }) {
  // 창고 SKU 중 미배정 qty 가 있는 것만 후보로 (잔여 qty 만 추가 가능).
  const candidates = useMemo(() => {
    return group.skus
      .map((sku) => {
        const assigned = sumAssignedQty(data.lots || [], sku.rowKey);
        return { sku, remain: sku.confirmed_qty - assigned };
      })
      .filter((c) => c.remain > 0);
  }, [group.skus, data.lots]);

  // 초기값: 전부 체크, qty = remain
  const [selections, setSelections] = useState(() => {
    const m = {};
    for (const c of candidates) {
      m[c.sku.rowKey] = { checked: true, qty: c.remain };
    }
    return m;
  });

  const toggle = (rowKey) =>
    setSelections((p) => ({ ...p, [rowKey]: { ...p[rowKey], checked: !p[rowKey]?.checked } }));
  const setQty = (rowKey, qty) =>
    setSelections((p) => ({ ...p, [rowKey]: { ...p[rowKey], qty } }));

  const activeList = candidates
    .filter((c) => selections[c.sku.rowKey]?.checked)
    .map((c) => ({ rowKey: c.sku.rowKey, qty: Number(selections[c.sku.rowKey]?.qty) || 0 }))
    .filter((s) => s.qty > 0);

  const totalSelected = activeList.reduce((s, a) => s + a.qty, 0);

  const allChecked = candidates.length > 0 && candidates.every((c) => selections[c.sku.rowKey]?.checked);
  const toggleAll = () => {
    setSelections((p) => {
      const next = { ...p };
      const to = !allChecked;
      for (const c of candidates) {
        next[c.sku.rowKey] = { ...(next[c.sku.rowKey] || {}), checked: to, qty: next[c.sku.rowKey]?.qty ?? c.remain };
      }
      return next;
    });
  };

  return (
    <div className="eflex-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="eflex-overlay__card add-lot-modal" onClick={(e) => e.stopPropagation()}>
        <header className="eflex-overlay__header">
          <h3 className="eflex-overlay__title">
            {type === TYPES.SHIPMENT ? '📦 쉽먼트' : '🚛 밀크런'} 추가 — {group.warehouse}
          </h3>
          <button type="button" className="eflex-overlay__close" onClick={onCancel}>×</button>
        </header>

        <div className="eflex-overlay__body">
          {candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              미배정 SKU 가 없습니다. 기존 lot 의 배정을 조정한 뒤 다시 시도하세요.
            </p>
          ) : (
            <>
              <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
                이 lot 에 포함할 SKU 와 수량을 선택하세요. 기본값은 각 SKU 의 남은 수량 전부입니다.
              </p>

              <div className="add-lot-modal__toolbar">
                <label className="add-lot-modal__all">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  <span>전체 선택 ({candidates.length}종 · 남은 합계 {candidates.reduce((s, c) => s + c.remain, 0)})</span>
                </label>
                <div className="add-lot-modal__total">
                  선택 합계: <strong>{totalSelected}</strong>
                </div>
              </div>

              <table className="add-lot-modal__table">
                <thead>
                  <tr>
                    <th />
                    <th className="col-po">발주번호</th>
                    <th className="col-barcode">상품바코드</th>
                    <th>상품명</th>
                    <th className="col-num">남은</th>
                    <th className="col-num">이 lot 에 담을 수량</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const sel = selections[c.sku.rowKey] || {};
                    return (
                      <tr key={c.sku.rowKey} className={sel.checked ? '' : 'is-unchecked'}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!sel.checked}
                            onChange={() => toggle(c.sku.rowKey)}
                          />
                        </td>
                        <td className="col-po">{c.sku.coupang_order_seq}</td>
                        <td className="col-barcode">{c.sku.sku_barcode}</td>
                        <td className="col-name" title={c.sku.sku_name}>{c.sku.sku_name}</td>
                        <td className="col-num">{c.remain}</td>
                        <td className="col-num">
                          <input
                            type="number" min="0" max={c.remain}
                            className="stock-adjust-input add-lot-modal__qty"
                            value={sel.qty ?? c.remain}
                            onChange={(e) => setQty(c.sku.rowKey, e.target.value)}
                            disabled={!sel.checked}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        <footer className="eflex-overlay__footer">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel}>취소</button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => onConfirm(activeList)}
            disabled={candidates.length === 0}
          >
            {activeList.length > 0
              ? `${type} 생성 (${activeList.length}종 · ${totalSelected})`
              : `${type} 생성 (빈 lot)`}
          </button>
        </footer>
      </div>
    </div>
  );
}
