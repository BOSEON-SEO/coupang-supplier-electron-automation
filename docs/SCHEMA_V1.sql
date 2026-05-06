-- ============================================================================
-- Coupang Supplier Automation — DB Schema V1 (M0 draft)
-- Engine: SQLite (better-sqlite3)
-- File:   %LOCALAPPDATA%/CoupangAutomation/data.db
-- 적용 범위: PO 풀 / 인박스 (lot 배정 미정 항목) / lot 컨테이너 / 사이트 업로드 history.
-- 이외 (vendors.json, manifest.json, license, plugin manifest, 쿠팡/통합 xlsx) 는 파일 그대로.
-- ============================================================================

-- 공통 PRAGMA
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- 0. 메타: 스키마 버전
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_meta VALUES ('version', '1');
INSERT OR REPLACE INTO schema_meta VALUES ('created_at', datetime('now'));

-- ----------------------------------------------------------------------------
-- 1. jobs_index — manifest.json 의 빠른 조회 인덱스
--   - manifest 는 여전히 파일 source of truth
--   - DB 는 캘린더/PO 리스트의 다축 쿼리용 캐시
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs_index (
  vendor_id   TEXT NOT NULL,
  date        TEXT NOT NULL,         -- YYYY-MM-DD
  sequence    INTEGER NOT NULL,
  state       TEXT NOT NULL DEFAULT 'active', -- active | shipped | draft | completed
  label       TEXT,                  -- '5/6 1차'
  total_skus  INTEGER DEFAULT 0,
  total_qty   INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (vendor_id, date, sequence)
);
CREATE INDEX IF NOT EXISTS idx_jobs_index_date ON jobs_index(vendor_id, date);
CREATE INDEX IF NOT EXISTS idx_jobs_index_state ON jobs_index(state);

-- ----------------------------------------------------------------------------
-- 2. pos — 모든 PO 누적 풀 (ALL_POS)
--   - 새 PO 갱신 시 INSERT, 차수 배정 시 job_* 컬럼 채움
--   - 차수에 안 묶인 PO 는 job_vendor IS NULL 로 'orphan'
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos (
  id           TEXT PRIMARY KEY,     -- 'P-{vendor}-{poNumber}-{sku}'
  vendor_id    TEXT NOT NULL,
  po_number    TEXT NOT NULL,
  wh           TEXT NOT NULL,        -- 물류센터 (목적지)
  sku          TEXT NOT NULL,
  barcode      TEXT,
  name         TEXT NOT NULL,
  req_qty      INTEGER NOT NULL,
  order_time   TEXT NOT NULL,        -- '2026-05-04 20:13'
  -- 배정된 차수 (NULL = 미배정/orphan)
  job_vendor   TEXT,
  job_date     TEXT,
  job_seq      INTEGER,
  is_new       INTEGER NOT NULL DEFAULT 1, -- 신규 갱신으로 들어온 직후 1, 처리 시 0
  imported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_vendor, job_date, job_seq)
    REFERENCES jobs_index(vendor_id, date, sequence)
    ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pos_vendor       ON pos(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pos_job          ON pos(job_vendor, job_date, job_seq);
CREATE INDEX IF NOT EXISTS idx_pos_orphan       ON pos(vendor_id, job_vendor) WHERE job_vendor IS NULL;
CREATE INDEX IF NOT EXISTS idx_pos_po_sku       ON pos(po_number, sku);

-- ----------------------------------------------------------------------------
-- 3. inbox_items — lot 으로 묶이기 전의 미배정 풀
--   - 검토/확정 단계 통과 후 ship/milk routing 으로 fan-out
--   - qty 는 남은 수량 (lot 으로 빠지면 차감), total 은 원본 (불변)
--   - qty=0 항목도 유지 (UI 에서 "완료" 표시)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,        -- 'ship' | 'milk'
  job_date     TEXT NOT NULL,
  job_seq      INTEGER NOT NULL,
  pos_id       TEXT,                 -- 출처 PO (FK to pos.id, optional)
  po_number    TEXT NOT NULL,
  wh           TEXT NOT NULL,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  qty          INTEGER NOT NULL,     -- 현재 남은 수량
  total        INTEGER NOT NULL,     -- 원본 수량 (불변)
  routed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind IN ('ship','milk')),
  FOREIGN KEY (vendor_id, job_date, job_seq)
    REFERENCES jobs_index(vendor_id, date, sequence)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (pos_id) REFERENCES pos(id) ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_lookup    ON inbox_items(vendor_id, kind, job_date, job_seq);
CREATE INDEX IF NOT EXISTS idx_inbox_wh        ON inbox_items(wh);
CREATE INDEX IF NOT EXISTS idx_inbox_active    ON inbox_items(vendor_id, kind, job_date, job_seq) WHERE qty > 0;

-- ----------------------------------------------------------------------------
-- 4. lots — 만들어진 lot (박스/팔레트 묶음)
--   - 1 lot = 1 wh (목적지 단일)
--   - kind = ship | milk
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lots (
  id                TEXT PRIMARY KEY, -- 'L-{kind}-{vendor}-{date}-{seq}-{n}'
  vendor_id         TEXT NOT NULL,
  kind              TEXT NOT NULL,
  job_date          TEXT NOT NULL,
  job_seq           INTEGER NOT NULL,
  wh                TEXT NOT NULL,    -- 목적지 센터
  label             TEXT NOT NULL,    -- '쉽먼트 lot #1'
  total_qty         INTEGER NOT NULL DEFAULT 0,
  total_containers  INTEGER NOT NULL DEFAULT 0,
  uploaded          INTEGER NOT NULL DEFAULT 0,
  uploaded_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind IN ('ship','milk')),
  FOREIGN KEY (vendor_id, job_date, job_seq)
    REFERENCES jobs_index(vendor_id, date, sequence)
    ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lots_lookup   ON lots(vendor_id, kind, job_date, job_seq);
CREATE INDEX IF NOT EXISTS idx_lots_pending  ON lots(vendor_id, kind, job_date, job_seq) WHERE uploaded = 0;

-- ----------------------------------------------------------------------------
-- 5. lot_containers — lot 안의 박스/팔레트 단위
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lot_containers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id       TEXT NOT NULL,
  label        TEXT NOT NULL,        -- '박스 1' / '팔레트 1'
  preset       TEXT,                 -- 'T11' (밀크런)
  tracking_no  TEXT,                 -- 송장번호 (쉽먼트)
  total        INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0, -- 표시 순서
  FOREIGN KEY (lot_id) REFERENCES lots(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_containers_lot ON lot_containers(lot_id);

-- ----------------------------------------------------------------------------
-- 6. lot_allocations — 컨테이너 × inbox 항목 배정 (M:N)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lot_allocations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id    INTEGER NOT NULL,
  inbox_item_id   INTEGER NOT NULL,  -- 출처 inbox_items (cancel 시 환원용)
  -- snapshot 항목정보 — inbox_items 가 사라져도 lot 상세는 유지
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  po_number       TEXT NOT NULL,
  qty             INTEGER NOT NULL,
  FOREIGN KEY (container_id) REFERENCES lot_containers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (inbox_item_id) REFERENCES inbox_items(id) ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_container ON lot_allocations(container_id);
CREATE INDEX IF NOT EXISTS idx_alloc_inbox     ON lot_allocations(inbox_item_id);

-- ----------------------------------------------------------------------------
-- 7. upload_history — 사이트 업로드 1회 = 1 record (lot 일괄 단위)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,        -- 'ship' | 'milk' | 'confirm' (발주확정도 기록)
  job_date     TEXT NOT NULL,
  job_seq      INTEGER NOT NULL,
  lot_ids      TEXT NOT NULL,        -- JSON array
  total_qty    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ok', -- ok | failed
  error        TEXT,
  at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status IN ('ok','failed'))
);
CREATE INDEX IF NOT EXISTS idx_upload_lookup ON upload_history(vendor_id, kind, job_date, job_seq);
CREATE INDEX IF NOT EXISTS idx_upload_at     ON upload_history(at DESC);

-- ============================================================================
-- 트리거: lots.total_qty / total_containers 자동 갱신
--   - lot_allocations 변경 시 container.total + lot 집계 재계산
--   - lot_containers 추가/삭제 시 lot.total_containers 재계산
-- (1차 도입은 application 레이어에서 직접 갱신해도 OK — 필요 시 trigger 도입)
-- ============================================================================
