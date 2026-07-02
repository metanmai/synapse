-- 019_merge_projects.sql
-- Phase 2 (IDENT-02, D-07): manual link / merge of two projects the user owns.
--
-- Split out from 018 (where it was originally appended) so the migration system
-- sees this function as a new pending migration. 018 is already marked applied
-- on dogfood (the column add went out earlier), so appending the function to
-- 018 was invisible to `supabase db push`. This file's filename version (019)
-- is new, so the next push will apply it.
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
--
-- `create or replace`: re-running this migration is a no-op when the function
-- already exists with identical body; safe to apply repeatedly.

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
