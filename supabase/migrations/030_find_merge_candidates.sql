-- 030_find_merge_candidates.sql
--
-- Reconciler support (spec: docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md).
-- Finds same-owner project pairs whose conversations are highly similar — the
-- signal the daily reconciler uses to merge fragmented projects. Doing the
-- cross-project distance in SQL (pgvector) avoids pulling 768-dim vectors into
-- the Worker. The a.project_id < b.project_id join gives canonical pair ordering
-- (project_a < project_b), excludes self-pairs, and dedupes each pair to one row.

CREATE OR REPLACE FUNCTION find_merge_candidates(
  match_user_id uuid,
  sim_threshold float,
  max_pairs int DEFAULT 20
) RETURNS TABLE (
  project_a uuid,
  project_b uuid,
  score float
) LANGUAGE sql STABLE AS $$
  SELECT
    a.project_id AS project_a,
    b.project_id AS project_b,
    max(1 - (a.embedding <=> b.embedding)) AS score
  FROM conversations a
  JOIN conversations b
    ON a.user_id = b.user_id
   AND a.project_id < b.project_id
  WHERE a.user_id = match_user_id
    AND a.embedding IS NOT NULL
    AND b.embedding IS NOT NULL
    AND a.status = 'active'
    AND b.status = 'active'
    AND 1 - (a.embedding <=> b.embedding) > sim_threshold
  GROUP BY a.project_id, b.project_id
  ORDER BY score DESC
  LIMIT max_pairs;
$$;
