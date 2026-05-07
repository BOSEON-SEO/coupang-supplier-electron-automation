-- ============================================================================
-- Coupang Supplier Automation — Schema V2 patch
-- 차수 검토 단계: 행별 OK/반려 상태 + 확정 수량 + 부족 사유
-- ----------------------------------------------------------------------------
--   pos.conf_qty     INTEGER NULL  — 사용자가 검토에서 확정한 수량 (NULL=미검토)
--   pos.short_reason TEXT    NULL  — 부족/반려 사유 ('협력사 재고' 등)
--   pos.reviewed     INTEGER NOT NULL DEFAULT 0  — 1=검토 확정 (OK or 반려)
-- ============================================================================
ALTER TABLE pos ADD COLUMN conf_qty     INTEGER;
ALTER TABLE pos ADD COLUMN short_reason TEXT;
ALTER TABLE pos ADD COLUMN reviewed     INTEGER NOT NULL DEFAULT 0;

-- 차수별 미검토 인덱스 (검토 step 진입 시 진행률 빠른 조회)
CREATE INDEX IF NOT EXISTS idx_pos_review_pending
  ON pos(job_vendor, job_date, job_seq, reviewed)
  WHERE job_vendor IS NOT NULL AND reviewed = 0;
