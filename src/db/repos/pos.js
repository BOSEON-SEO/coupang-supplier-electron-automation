// pos repository — 모든 PO 누적 풀.
// 차수에 묶인 PO 는 (job_vendor, job_date, job_seq) 채워짐. NULL = orphan.
const { getDb } = require('../index');

function makePosId(vendor_id, po_number, sku) {
  return `P-${vendor_id}-${po_number}-${sku}`;
}

function upsertMany(rows) {
  // rows: [{ vendor_id, po_number, wh, sku, barcode, name, req_qty, order_time, job_vendor, job_date, job_seq, is_new }]
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO pos (id, vendor_id, po_number, wh, sku, barcode, name, req_qty, order_time,
                     job_vendor, job_date, job_seq, is_new, imported_at)
    VALUES (@id, @vendor_id, @po_number, @wh, @sku, @barcode, @name, @req_qty, @order_time,
            @job_vendor, @job_date, @job_seq, @is_new, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      wh         = excluded.wh,
      barcode    = excluded.barcode,
      name       = excluded.name,
      req_qty    = excluded.req_qty,
      order_time = excluded.order_time,
      job_vendor = COALESCE(pos.job_vendor, excluded.job_vendor),
      job_date   = COALESCE(pos.job_date,   excluded.job_date),
      job_seq    = COALESCE(pos.job_seq,    excluded.job_seq)
  `);
  const tx = db.transaction((rs) => {
    for (const r of rs) {
      const id = r.id || makePosId(r.vendor_id, r.po_number, r.sku);
      stmt.run({
        id,
        vendor_id: r.vendor_id,
        po_number: String(r.po_number),
        wh: r.wh,
        sku: r.sku,
        barcode: r.barcode || null,
        name: r.name,
        req_qty: r.req_qty,
        order_time: r.order_time,
        job_vendor: r.job_vendor || null,
        job_date: r.job_date || null,
        job_seq: r.job_seq != null ? r.job_seq : null,
        is_new: r.is_new ? 1 : 0,
      });
    }
  });
  tx(rows);
  return rows.length;
}

function listAll(vendor_id) {
  return getDb()
    .prepare('SELECT * FROM pos WHERE vendor_id=? ORDER BY order_time DESC')
    .all(vendor_id);
}

function listByJob(vendor_id, date, sequence) {
  return getDb()
    .prepare(`
      SELECT * FROM pos
      WHERE job_vendor=? AND job_date=? AND job_seq=?
      ORDER BY order_time DESC
    `)
    .all(vendor_id, date, sequence);
}

function listOrphans(vendor_id) {
  return getDb()
    .prepare(`
      SELECT * FROM pos
      WHERE vendor_id=? AND job_vendor IS NULL
      ORDER BY order_time DESC
    `)
    .all(vendor_id);
}

function assignToJob(posIds, vendor_id, date, sequence) {
  if (!posIds || posIds.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE pos
    SET job_vendor=?, job_date=?, job_seq=?, is_new=0
    WHERE id=? AND job_vendor IS NULL
  `);
  const tx = db.transaction((ids) => {
    let n = 0;
    for (const id of ids) {
      const r = stmt.run(vendor_id, date, sequence, id);
      if (r.changes > 0) n += 1;
    }
    return n;
  });
  return tx(posIds);
}

function unassign(posIds) {
  if (!posIds || posIds.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE pos SET job_vendor=NULL, job_date=NULL, job_seq=NULL WHERE id=?
  `);
  const tx = db.transaction((ids) => {
    let n = 0;
    for (const id of ids) {
      const r = stmt.run(id);
      if (r.changes > 0) n += 1;
    }
    return n;
  });
  return tx(posIds);
}

module.exports = { makePosId, upsertMany, listAll, listByJob, listOrphans, assignToJob, unassign };
