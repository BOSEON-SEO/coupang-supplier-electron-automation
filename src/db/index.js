// better-sqlite3 connection singleton — Main process only.
// 부팅 시 openDb({ dataDir }) 호출하면:
//   1. {dataDir}/data.db 열거나 생성
//   2. PRAGMA journal_mode=WAL, foreign_keys=ON
//   3. migrations/index.js 가 schema_meta.version 보고 미적용 SQL 적용
// renderer 는 직접 못 닿음 — 모든 접근은 ipc/* 컨트롤러 경유.
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { applyMigrations } = require('./migrations');

let dbInstance = null;

function openDb({ dataDir }) {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'data.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);

  dbInstance = db;
  console.log('[db] opened', dbPath, '— schema version', getSchemaVersion(db));
  return db;
}

function getDb() {
  if (!dbInstance) throw new Error('db not opened — call openDb({dataDir}) at app boot');
  return dbInstance;
}

function getSchemaVersion(db = dbInstance) {
  try {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key='version'").get();
    return row?.value || '0';
  } catch (_) {
    return '0';
  }
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { openDb, getDb, getSchemaVersion, closeDb };
