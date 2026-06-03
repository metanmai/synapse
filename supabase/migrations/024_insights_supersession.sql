-- 024_insights_supersession.sql
-- Insight curation, Option A: supersession.
--
-- When the agent writes a new insight that replaces an older one, the older
-- row gets stamped with `superseded_by = <new_insight_id>` so it stops
-- appearing in default list queries / briefs while still being recoverable
-- for audit (set include_superseded=true). This is a soft-delete pattern —
-- the curation never destroys history.
--
-- ON DELETE SET NULL means if the *new* insight ever gets hard-deleted the
-- old row "un-supersedes" rather than dangling at a nonexistent id. That
-- matches our usual intent (we don't want a destroyed pointer to silently
-- hide context forever).
--
-- The partial index covers the hot path: `listInsights` defaults to filtering
-- on `superseded_by IS NULL` and orders by `updated_at DESC`. The full index
-- on (project_id, updated_at DESC) already exists indirectly via 006's
-- project + updated_at sort, but a partial index that pre-excludes the
-- superseded rows is the right shape for the default-active read path.
--
-- Migration is purely additive + idempotent (IF NOT EXISTS on both column
-- and index). No backfill needed — every existing insight stays active
-- (superseded_by defaults NULL).

ALTER TABLE insights
  ADD COLUMN IF NOT EXISTS superseded_by uuid
    REFERENCES insights(id) ON DELETE SET NULL
    DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_insights_active
  ON insights(project_id, updated_at DESC)
  WHERE superseded_by IS NULL;
