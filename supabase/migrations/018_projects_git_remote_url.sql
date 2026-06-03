-- 018_projects_git_remote_url.sql
-- Phase 2 (IDENT-02, D-06): cross-device project discovery by git remote URL.
--
-- When a user on machine A and the same user on machine B both work in clones
-- of the same git repository, the daemon's first event from each machine carries
-- a `cwd_<hash>` placeholder project_id (the cwd hash is device-local). Today's
-- matcher resolves these by `(owner_id, name)`, which collides for common repo
-- names like "scratch" or "synapse" and misses when the user later renames a
-- project. Adding `git_remote_url` gives the matcher a globally-unique signal
-- per the user's clones.
--
-- Migration is purely additive + idempotent:
--   - column is nullable; existing rows remain NULL until their first
--     post-Phase-2 event triggers opportunistic backfill in events-batch.ts
--   - partial index covers only non-null URLs (the matcher's hot path);
--     existing NULL rows pay nothing
--   - no RLS changes — Worker uses service-role; existing policies on
--     `projects` still cover this column transparently

alter table projects add column if not exists git_remote_url text;

create index if not exists projects_user_remote_url_idx
  on projects(owner_id, git_remote_url)
  where git_remote_url is not null;
