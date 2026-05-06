// jobs_index repository — manifest.json 의 빠른 조회용 캐시.
// manifest 파일이 source of truth, DB 는 인덱스. ipc/jobs.js 가 manifest 변경 시 sync 호출.
const { getDb } = require('../index');

function upsert({ vendor_id, date, sequence, state, label, total_skus, total_qty }) {
  return getDb().prepare(`
    INSERT INTO jobs_index (vendor_id, date, sequence, state, label, total_skus, total_qty, updated_at)
    VALUES (@vendor_id, @date, @sequence, @state, @label, @total_skus, @total_qty, datetime('now'))
    ON CONFLICT(vendor_id, date, sequence) DO UPDATE SET
      state = excluded.state,
      label = excluded.label,
      total_skus = excluded.total_skus,
      total_qty = excluded.total_qty,
      updated_at = datetime('now')
  `).run({
    vendor_id, date, sequence,
    state: state || 'active',
    label: label || null,
    total_skus: total_skus || 0,
    total_qty: total_qty || 0,
  });
}

function remove(vendor_id, date, sequence) {
  return getDb()
    .prepare('DELETE FROM jobs_index WHERE vendor_id=? AND date=? AND sequence=?')
    .run(vendor_id, date, sequence);
}

function listMonth(vendor_id, year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`;
  return getDb()
    .prepare('SELECT * FROM jobs_index WHERE vendor_id=? AND date BETWEEN ? AND ? ORDER BY date, sequence')
    .all(vendor_id, start, end);
}

function listByDate(vendor_id, date) {
  return getDb()
    .prepare('SELECT * FROM jobs_index WHERE vendor_id=? AND date=? ORDER BY sequence')
    .all(vendor_id, date);
}

function get(vendor_id, date, sequence) {
  return getDb()
    .prepare('SELECT * FROM jobs_index WHERE vendor_id=? AND date=? AND sequence=?')
    .get(vendor_id, date, sequence);
}

module.exports = { upsert, remove, listMonth, listByDate, get };
