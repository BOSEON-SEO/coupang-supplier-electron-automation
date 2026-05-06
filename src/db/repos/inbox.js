// inbox_items repository — 차수별 ship/milk 미배정 풀.
// qty=0 항목도 보존 (UI 에서 "완료" 표시). total 은 원본, qty 는 남은 수량.
const { getDb } = require('../index');

function add(rows) {
  // rows: [{ vendor_id, kind, job_date, job_seq, pos_id, po_number, wh, sku, name, qty, total }]
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO inbox_items
      (vendor_id, kind, job_date, job_seq, pos_id, po_number, wh, sku, name, qty, total, routed_at)
    VALUES (@vendor_id, @kind, @job_date, @job_seq, @pos_id, @po_number, @wh, @sku, @name, @qty, @total, datetime('now'))
  `);
  const tx = db.transaction((rs) => {
    for (const r of rs) {
      stmt.run({
        vendor_id: r.vendor_id,
        kind: r.kind,
        job_date: r.job_date,
        job_seq: r.job_seq,
        pos_id: r.pos_id || null,
        po_number: String(r.po_number),
        wh: r.wh,
        sku: r.sku,
        name: r.name,
        qty: r.qty,
        total: r.total != null ? r.total : r.qty,
      });
    }
  });
  tx(rows);
  return rows.length;
}

function list(vendor_id, kind, date, sequence) {
  return getDb()
    .prepare(`
      SELECT * FROM inbox_items
      WHERE vendor_id=? AND kind=? AND job_date=? AND job_seq=?
      ORDER BY wh, po_number, sku
    `)
    .all(vendor_id, kind, date, sequence);
}

function decrementQty(itemId, by) {
  // lot 만들 때 호출. qty 는 음수까지 안 가게 안전 가드.
  return getDb()
    .prepare('UPDATE inbox_items SET qty = MAX(qty - ?, 0) WHERE id=?')
    .run(by, itemId);
}

function incrementQty(itemId, by) {
  // lot 취소 시 환원
  return getDb()
    .prepare('UPDATE inbox_items SET qty = qty + ? WHERE id=?')
    .run(by, itemId);
}

function removeMany(ids) {
  if (!ids || ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`DELETE FROM inbox_items WHERE id IN (${placeholders})`).run(...ids).changes;
}

module.exports = { add, list, decrementQty, incrementQty, removeMany };
