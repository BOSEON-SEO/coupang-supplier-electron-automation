-- ============================================================================
-- Coupang Supplier Automation — Schema V3 patch
-- pos.inbound_date — 쿠팡 PO_SKU_LIST 의 '입고예정일'.
-- 이 컬럼이 없어 vendor 전체 PO 가 모든 날짜 view 에 노출되던 버그를 차단.
-- ----------------------------------------------------------------------------
-- 형식: 'YYYY-MM-DD' (NULL = 갱신 시 미파싱 또는 구 데이터)
-- ============================================================================
ALTER TABLE pos ADD COLUMN inbound_date TEXT;

-- 날짜별 PO 풀 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_pos_inbound_date
  ON pos(vendor_id, inbound_date);
