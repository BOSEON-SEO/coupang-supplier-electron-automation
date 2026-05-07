// pos repository — 모든 PO 누적 풀.
// 차수에 묶인 PO 는 (job_vendor, job_date, job_seq) 채워짐. NULL = orphan.
const { getDb } = require('../index');

function makePosId(vendor_id, po_number, sku) {
  return `P-${vendor_id}-${po_number}-${sku}`;
}

function upsertMany(rows) {
  // rows: [{ vendor_id, po_number, wh, sku, barcode, name, req_qty, order_time, inbound_date,
  //          job_vendor, job_date, job_seq, is_new }]
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO pos (id, vendor_id, po_number, wh, sku, barcode, name, req_qty, order_time, inbound_date,
                     job_vendor, job_date, job_seq, is_new, imported_at)
    VALUES (@id, @vendor_id, @po_number, @wh, @sku, @barcode, @name, @req_qty, @order_time, @inbound_date,
            @job_vendor, @job_date, @job_seq, @is_new, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      wh           = excluded.wh,
      barcode      = excluded.barcode,
      name         = excluded.name,
      req_qty      = excluded.req_qty,
      order_time   = excluded.order_time,
      inbound_date = COALESCE(excluded.inbound_date, pos.inbound_date),
      job_vendor   = COALESCE(pos.job_vendor, excluded.job_vendor),
      job_date     = COALESCE(pos.job_date,   excluded.job_date),
      job_seq      = COALESCE(pos.job_seq,    excluded.job_seq)
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
        inbound_date: r.inbound_date || null,
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

/**
 * PO 갱신용 — 기존 po_number 가 이미 존재하면 SKIP, 처음 보는 po_number 의 행만 INSERT.
 * 같은 po_number 의 다른 SKU 행도 첫 행이 INSERT 되면 같이 들어옴 (po_number 단위 dedup).
 *
 * @param {string} vendor_id
 * @param {Array<Row>} rows  (id 없어도 됨 — makePosId 로 자동 생성)
 * @returns {{ added: number, skipped: number, addedPoNumbers: string[] }}
 */
function addNewOnly(vendor_id, rows) {
  const db = getDb();
  // 기존 po_number set
  const existing = new Set(
    db.prepare('SELECT DISTINCT po_number FROM pos WHERE vendor_id=?').all(vendor_id)
      .map((r) => String(r.po_number))
  );
  const newPoNumbers = new Set();
  const filtered = [];
  for (const r of rows) {
    const pn = String(r.po_number);
    if (existing.has(pn)) continue;
    filtered.push({ ...r, vendor_id, is_new: true });
    newPoNumbers.add(pn);
  }
  const added = upsertMany(filtered);
  return { added, skipped: rows.length - added, addedPoNumbers: [...newPoNumbers] };
}

/**
 * 단일 PO 행의 검토 상태 갱신.
 * action:
 *   'accept' — 확정 = 발주수량 (또는 명시 conf_qty), reviewed=1, short_reason=NULL
 *   'reject' — 확정 = 0, reviewed=1, short_reason=명시값 또는 '협력사 재고'
 *   'set'    — conf_qty 직접 지정. conf_qty=0 이면 reject 동치, >0 이면 accept 동치
 *   'unset'  — reviewed=0, conf_qty=NULL, short_reason=NULL (검토 해제)
 */
function reviewSet(posId, action, opts = {}) {
  const db = getDb();
  if (action === 'accept') {
    return db.prepare(`
      UPDATE pos SET reviewed=1, conf_qty = COALESCE(?, req_qty), short_reason=NULL WHERE id=?
    `).run(opts.confQty != null ? opts.confQty : null, posId).changes;
  }
  if (action === 'reject') {
    return db.prepare(`
      UPDATE pos SET reviewed=1, conf_qty=0, short_reason=COALESCE(?, '협력사 재고') WHERE id=?
    `).run(opts.shortReason || null, posId).changes;
  }
  if (action === 'set') {
    const q = Number(opts.confQty) || 0;
    return db.prepare(`
      UPDATE pos
      SET reviewed=1, conf_qty=?, short_reason = CASE WHEN ?=0 THEN COALESCE(?, '협력사 재고') ELSE NULL END
      WHERE id=?
    `).run(q, q, opts.shortReason || null, posId).changes;
  }
  if (action === 'unset') {
    return db.prepare(`
      UPDATE pos SET reviewed=0, conf_qty=NULL, short_reason=NULL WHERE id=?
    `).run(posId).changes;
  }
  throw new Error(`unknown review action: ${action}`);
}

/** 차수의 검토 진행률. */
function reviewSummary(vendor_id, date, sequence) {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN reviewed=1 THEN 1 ELSE 0 END) AS reviewed,
      SUM(CASE WHEN reviewed=1 AND conf_qty=0 THEN 1 ELSE 0 END) AS rejected
    FROM pos WHERE job_vendor=? AND job_date=? AND job_seq=?
  `).get(vendor_id, date, sequence);
  return {
    total: row?.total || 0,
    reviewed: row?.reviewed || 0,
    rejected: row?.rejected || 0,
    pending: (row?.total || 0) - (row?.reviewed || 0),
  };
}

module.exports = {
  makePosId, upsertMany, addNewOnly, listAll, listByJob, listOrphans,
  assignToJob, unassign, reviewSet, reviewSummary,
};
