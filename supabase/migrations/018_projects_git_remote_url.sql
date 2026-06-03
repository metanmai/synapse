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

-- Phase 2 (IDENT-02, D-07): manual link / merge of two projects the user owns.
--
-- When the auto-match in events-batch.ts gets the cross-device link wrong, or
-- the user has already accumulated history in two separately-auto-created
-- projects that should be one, the UI (frontend LinkPicker.svelte) calls
-- POST /api/projects/:id/merge-into/:target_id which invokes this function.
--
-- Contract:
--   1. Verify p_user_id is owner of BOTH source and target (defense-in-depth
--      alongside the API-tier requireRole() check).
--   2. Reassign FIRST then delete (per RESEARCH §Pitfall 7 — FK cascade would
--      otherwise wipe the events instead of moving them).
--   3. handoff_project_status has PK = project_id; updating source's row would
--      collide with the target's row if target already has one. Delete source's
--      status row; the backend's recomputeProjectStatus(target) rebuilds the
--      target's status from the reassigned events after the RPC returns.
--   4. plpgsql function = implicit transaction = atomic.
--
-- security definer: function runs with the migration owner's privileges, so
-- the per-table policies don't fight the owner-check inside the function.

create or replace function merge_projects(
  p_source_id uuid,
  p_target_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer as $$
begin
  perform 1 from project_members
    where project_id = p_source_id and user_id = p_user_id and role = 'owner';
  if not found then raise exception 'not owner of source project'; end if;
  perform 1 from project_members
    where project_id = p_target_id and user_id = p_user_id and role = 'owner';
  if not found then raise exception 'not owner of target project'; end if;

  update handoff_events set project_id = p_target_id where project_id = p_source_id;
  delete from handoff_project_status where project_id = p_source_id;
  update conversations set project_id = p_target_id where project_id = p_source_id;
  update entries set project_id = p_target_id where project_id = p_source_id;
  update activity_log set project_id = p_target_id where project_id = p_source_id;

  delete from projects where id = p_source_id;
end;
$$;
