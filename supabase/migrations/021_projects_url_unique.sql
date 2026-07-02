-- 021_projects_url_unique.sql
-- Fix #2: enforce uniqueness of (owner_id, git_remote_url) so concurrent
-- Tier 3 INSERTs in findOrCreateProjectByGit cannot create duplicate
-- projects for the same repo URL.
--
-- Concrete race that this defends against:
--
--   t=0  Worker A: SELECT projects WHERE git_remote_url=X    → 0 rows
--   t=0  Worker B: SELECT projects WHERE git_remote_url=X    → 0 rows
--   t=1  Worker A: INSERT projects(... git_remote_url=X) ... → row A
--   t=1  Worker B: INSERT projects(... git_remote_url=X) ... → row B   ← duplicate
--
-- After this migration, t=1 Worker B's INSERT raises 23505 and the
-- application-level retry in findOrCreateProjectByGit re-runs Tier 1
-- and returns row A. End-state: exactly one row per (owner_id, URL).
--
-- The migration is additive + idempotent + transactional: it detects
-- pre-existing duplicates and aborts loudly rather than silently mangling
-- data. If RAISE EXCEPTION fires, an operator must dedupe by hand before
-- applying. As of 2026-05-24 the live tanmain account has no duplicates
-- (verified via SELECT count(*) GROUP BY owner_id, git_remote_url HAVING > 1).

BEGIN;

DO $$
DECLARE
  dup_groups int;
  rec record;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT owner_id, git_remote_url
    FROM projects
    WHERE git_remote_url IS NOT NULL
    GROUP BY owner_id, git_remote_url
    HAVING count(*) > 1
  ) t;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'Cannot enforce unique constraint: % duplicate (owner_id, git_remote_url) groups exist. First 10:', dup_groups;
    FOR rec IN
      SELECT owner_id, git_remote_url, count(*) AS n
      FROM projects WHERE git_remote_url IS NOT NULL
      GROUP BY owner_id, git_remote_url
      HAVING count(*) > 1
      ORDER BY n DESC
      LIMIT 10
    LOOP
      RAISE NOTICE '  owner_id=% git_remote_url=% count=%', rec.owner_id, rec.git_remote_url, rec.n;
    END LOOP;
    RAISE EXCEPTION 'Dedupe before applying — see notices above for affected rows.';
  END IF;
END $$;

-- Migration 018 created a non-unique index with the same column set; drop
-- it so we don't keep two indexes covering the same lookup. Postgres uses
-- the new unique index for both the constraint and the SELECT path.
DROP INDEX IF EXISTS projects_user_remote_url_idx;

CREATE UNIQUE INDEX IF NOT EXISTS projects_user_remote_url_uniq_idx
  ON projects(owner_id, git_remote_url)
  WHERE git_remote_url IS NOT NULL;

COMMIT;
