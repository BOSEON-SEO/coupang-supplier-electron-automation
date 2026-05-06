// 스키마 마이그레이션 — 부팅 시 자동 적용.
// 각 .sql 파일 = 한 번만 적용. schema_meta.applied_<filename>='1' 으로 idempotent.
// 새 마이그레이션 추가 시: 002_xxx.sql 처럼 prefix 숫자 증가.
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = __dirname;

function applyMigrations(db) {
  // schema_meta 가 없을 수도 있으니 먼저 안전하게 만든다.
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const isApplied = db.prepare("SELECT value FROM schema_meta WHERE key=?");
  const markApplied = db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES(?, ?)");

  for (const file of files) {
    const key = `applied_${file}`;
    if (isApplied.get(key)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      markApplied.run(key, new Date().toISOString());
    });
    tx();
    console.log('[db] migration applied:', file);
  }
}

module.exports = { applyMigrations };
