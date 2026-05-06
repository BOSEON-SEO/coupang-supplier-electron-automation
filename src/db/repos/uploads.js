// upload_history repository — 사이트 업로드 1회 = 1 record (lot 일괄 단위).
const { getDb } = require('../index');

function add({ vendor_id, kind, date, sequence, lotIds, total_qty, status, error }) {
  return getDb().prepare(`
    INSERT INTO upload_history (vendor_id, kind, job_date, job_seq, lot_ids, total_qty, status, error, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    vendor_id, kind, date, sequence,
    JSON.stringify(lotIds || []),
    total_qty || 0,
    status || 'ok',
    error || null,
  );
}

function listByJob(vendor_id, kind, date, sequence) {
  return getDb()
    .prepare(`
      SELECT * FROM upload_history
      WHERE vendor_id=? AND kind=? AND job_date=? AND job_seq=?
      ORDER BY at DESC
    `)
    .all(vendor_id, kind, date, sequence)
    .map((r) => ({ ...r, lot_ids: JSON.parse(r.lot_ids || '[]') }));
}

function lastForJob(vendor_id, kind, date, sequence) {
  const r = getDb()
    .prepare(`
      SELECT * FROM upload_history
      WHERE vendor_id=? AND kind=? AND job_date=? AND job_seq=?
      ORDER BY at DESC LIMIT 1
    `)
    .get(vendor_id, kind, date, sequence);
  return r ? { ...r, lot_ids: JSON.parse(r.lot_ids || '[]') } : null;
}

module.exports = { add, listByJob, lastForJob };
