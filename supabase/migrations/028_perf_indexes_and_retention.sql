-- 028_perf_indexes_and_retention.sql
-- Pre-launch DB hygiene (docs/LAUNCH-READINESS.md item #10 — high disk-IO report).
--
-- Three things in one migration because they're the same investigation:
--
--   A. Composite index on conversations(project_id, updated_at desc).
--      listConversations (backend/src/db/queries/conversations.ts:90) runs
--          where project_id = ? and status != 'deleted'
--          order by updated_at desc
--      every interval-tick of the daemon's pull-handoff pre-warm
--      (mcp/src/capture/pull-compact.ts:190 "Recent conversations
--      (listConversations orders by updated_at desc)"). Today only
--      `idx_conversations_project on conversations(project_id)` from
--      migration 007 exists — Postgres uses that to filter, then sorts
--      the per-project rowset by updated_at on EVERY call. With N
--      projects pre-warming on a cadence, that sort is the #1 suspect
--      in the owner's high-disk-IO report (LAUNCH-READINESS #10's first
--      "Probable culprit" bullet). A composite index whose trailing
--      column matches the ORDER BY direction (desc) turns the sort into
--      an index scan.
--
--   B. activity_log retention. The table has been growing unbounded
--      since migration 002 (every entry_created / member_added /
--      settings_changed insert appends a row, never pruned). Adds
--      prune_activity_log(retention_days) that the user can call
--      manually OR pg_cron will call nightly (see C). 90 days is the
--      house default — long enough for any "who did what when"
--      audit-trail question a user might reasonably ask, short enough
--      to keep the table from dominating disk on a healthy account.
--
--   C. pg_cron scheduling — guarded. Supabase Cloud projects can opt
--      into the pg_cron extension via the dashboard; not every instance
--      has it (the local stack `supabase start` boots without it, and
--      historically-opted-out projects don't have it either). This
--      migration MUST NEVER fail `supabase db push` on an instance
--      without pg_cron. The DO $$ block checks the extension's
--      installed state via pg_extension and silently no-ops with a
--      RAISE NOTICE when absent. Manual fallback documented inline:
--          SELECT prune_activity_log();
--
-- Idempotency: CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- and the cron job is unscheduled-then-rescheduled by fixed job name so
-- re-running the migration is safe.

-- ── A. composite index ──────────────────────────────────────────────
-- Trailing `desc` matters: matches the ORDER BY direction so the planner
-- doesn't have to reverse-scan or sort. `IF NOT EXISTS` keeps re-runs
-- safe (the migration system applies once, but local dev / dogfood
-- replays happen).
create index if not exists conversations_project_updated_at_idx
  on conversations(project_id, updated_at desc);

-- ── B. activity_log retention function ──────────────────────────────
-- Mirrors the house style from migration 011 (delete_user_data) and
-- 019 (merge_projects): plpgsql, security definer, create or replace.
-- No `set search_path` hardening — none of the prior security-definer
-- functions in this repo set it, so we stay consistent rather than
-- introducing a one-off pattern.
--
-- Parameter default: 90 days. Caller can pass any positive int to
-- override (e.g. `select prune_activity_log(30)` to be more aggressive).
-- Returns the number of rows deleted so the caller (manual run or
-- pg_cron job-log) gets a useful audit number.
create or replace function prune_activity_log(retention_days int default 90)
returns bigint
language plpgsql
security definer
as $$
declare
  deleted_count bigint;
begin
  delete from activity_log
   where created_at < now() - make_interval(days => retention_days);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function prune_activity_log(int) is
  'Prune activity_log rows older than N days (default 90). Returns count of deleted rows. Manual fallback when pg_cron unavailable: SELECT prune_activity_log();';

-- ── C. pg_cron scheduling (guarded — extension may not exist) ───────
-- Pattern: `pg_extension` only contains rows for INSTALLED extensions
-- (pg_available_extensions lists everything the binary supports, even
-- uninstalled — that's the wrong check for "can I call cron.schedule").
-- We check `pg_extension.extname = 'pg_cron'` and bail with a RAISE
-- NOTICE on absence — `supabase db push` treats NOTICE as informational,
-- not fatal, so the migration succeeds on every instance.
--
-- Within the guarded block: `cron.unschedule` is wrapped in its own
-- nested exception handler because it throws when the job name doesn't
-- exist (first-ever run). After unschedule, `cron.schedule` re-creates
-- the job with a stable name — running this migration repeatedly
-- always leaves exactly one scheduled job named
-- 'synapse_prune_activity_log'.
--
-- Schedule: 03:17 UTC daily. Off-the-hour minute spreads load away
-- from other cron jobs that tend to cluster at :00. 03:00-04:00 UTC
-- is a low-traffic window for North-America-skewed users.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Drop any existing schedule first (idempotent re-apply).
    begin
      perform cron.unschedule('synapse_prune_activity_log');
    exception when others then
      -- First-ever run: job doesn't exist, unschedule throws — swallow it.
      null;
    end;
    perform cron.schedule(
      'synapse_prune_activity_log',
      '17 3 * * *',
      $cron$select prune_activity_log();$cron$
    );
    raise notice 'pg_cron schedule installed: synapse_prune_activity_log @ 03:17 UTC daily';
  else
    raise notice 'pg_cron not installed on this instance — prune_activity_log() must be invoked manually (e.g. via Supabase SQL Editor or psql)';
  end if;
end $$;
