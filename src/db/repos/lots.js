// lots / lot_containers / lot_allocations repository.
// 1 lot = 1 wh (목적지). lot 만들기 = lot+containers+allocations 트랜잭션 INSERT + inbox 차감.
// 취소 = 역순으로 (allocations 합계만큼 inbox 환원, 모두 삭제).
const { getDb } = require('../index');
const inboxRepo = require('./inbox');

function nextLotId(db, vendor_id, kind, date, sequence) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM lots
    WHERE vendor_id=? AND kind=? AND job_date=? AND job_seq=?
  `).get(vendor_id, kind, date, sequence);
  const n = (row?.n || 0) + 1;
  return `L-${kind}-${vendor_id}-${date}-${sequence}-${String(n).padStart(2, '0')}`;
}

function create(payload) {
  // payload: {
  //   vendor_id, kind, date, sequence, wh,
  //   containers: [{ label, preset?, tracking_no?, items: [{ inbox_item_id, sku, name, po_number, qty }] }]
  // }
  const db = getDb();

  const lotId = nextLotId(db, payload.vendor_id, payload.kind, payload.date, payload.sequence);
  const label = payload.kind === 'ship' ? `쉽먼트 lot #${lotId.split('-').pop()}`
                                        : `밀크런 lot #${lotId.split('-').pop()}`;

  const tx = db.transaction(() => {
    let totalQty = 0;
    let totalContainers = 0;

    db.prepare(`
      INSERT INTO lots (id, vendor_id, kind, job_date, job_seq, wh, label,
                        total_qty, total_containers, uploaded, uploaded_at, created_at)
      VALUES (@id, @vendor_id, @kind, @date, @sequence, @wh, @label,
              0, 0, 0, NULL, datetime('now'))
    `).run({ id: lotId, ...payload, label });

    const containerStmt = db.prepare(`
      INSERT INTO lot_containers (lot_id, label, preset, tracking_no, total, position)
      VALUES (@lot_id, @label, @preset, @tracking_no, @total, @position)
    `);
    const allocStmt = db.prepare(`
      INSERT INTO lot_allocations (container_id, inbox_item_id, sku, name, po_number, qty)
      VALUES (@container_id, @inbox_item_id, @sku, @name, @po_number, @qty)
    `);

    let position = 0;
    for (const c of payload.containers) {
      const cTotal = c.items.reduce((s, it) => s + (+it.qty || 0), 0);
      if (cTotal === 0) continue; // 빈 컨테이너 스킵

      const cRes = containerStmt.run({
        lot_id: lotId,
        label: c.label,
        preset: c.preset || null,
        tracking_no: c.tracking_no || null,
        total: cTotal,
        position: position++,
      });
      const containerId = cRes.lastInsertRowid;

      for (const it of c.items) {
        if (!it.qty) continue;
        allocStmt.run({
          container_id: containerId,
          inbox_item_id: it.inbox_item_id,
          sku: it.sku,
          name: it.name,
          po_number: String(it.po_number),
          qty: it.qty,
        });
        inboxRepo.decrementQty(it.inbox_item_id, it.qty);
      }
      totalContainers += 1;
      totalQty += cTotal;
    }

    db.prepare(`UPDATE lots SET total_qty=?, total_containers=? WHERE id=?`)
      .run(totalQty, totalContainers, lotId);

    return lotId;
  });

  return tx();
}

function listByJob(vendor_id, kind, date, sequence) {
  const db = getDb();
  const lots = db.prepare(`
    SELECT * FROM lots
    WHERE vendor_id=? AND kind=? AND job_date=? AND job_seq=?
    ORDER BY created_at
  `).all(vendor_id, kind, date, sequence);

  const containers = db.prepare(`
    SELECT * FROM lot_containers WHERE lot_id=? ORDER BY position
  `);
  const allocations = db.prepare(`
    SELECT * FROM lot_allocations WHERE container_id=?
  `);

  return lots.map((l) => {
    const cs = containers.all(l.id).map((c) => ({
      ...c,
      items: allocations.all(c.id),
    }));
    return { ...l, containers: cs };
  });
}

function get(lotId) {
  const db = getDb();
  const l = db.prepare('SELECT * FROM lots WHERE id=?').get(lotId);
  if (!l) return null;
  const cs = db.prepare('SELECT * FROM lot_containers WHERE lot_id=? ORDER BY position').all(lotId);
  const allocStmt = db.prepare('SELECT * FROM lot_allocations WHERE container_id=?');
  l.containers = cs.map((c) => ({ ...c, items: allocStmt.all(c.id) }));
  return l;
}

function cancel(lotId) {
  const db = getDb();
  const l = db.prepare('SELECT uploaded FROM lots WHERE id=?').get(lotId);
  if (!l) return false;
  if (l.uploaded) throw new Error('이미 업로드된 lot 은 취소할 수 없습니다');

  const tx = db.transaction(() => {
    // allocations 환원
    const allocs = db.prepare(`
      SELECT a.* FROM lot_allocations a
      JOIN lot_containers c ON c.id = a.container_id
      WHERE c.lot_id = ?
    `).all(lotId);
    for (const a of allocs) {
      if (a.inbox_item_id) inboxRepo.incrementQty(a.inbox_item_id, a.qty);
    }
    db.prepare('DELETE FROM lots WHERE id=?').run(lotId); // FK CASCADE 로 containers/allocations 도 삭제
  });
  tx();
  return true;
}

function markUploaded(lotIds, at) {
  if (!lotIds || lotIds.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`UPDATE lots SET uploaded=1, uploaded_at=? WHERE id=?`);
  const tx = db.transaction((ids) => {
    let n = 0;
    for (const id of ids) {
      const r = stmt.run(at || new Date().toISOString(), id);
      if (r.changes > 0) n += 1;
    }
    return n;
  });
  return tx(lotIds);
}

module.exports = { create, listByJob, get, cancel, markUploaded };
