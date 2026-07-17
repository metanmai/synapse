-- Repair production drift and close Data API exposure reported by the
-- Supabase security advisor.
--
-- project_context and deleted_accounts are backend-only. The Worker uses the
-- service role, so deny-by-default RLS and revoked browser-role grants do not
-- change application behavior.
--
-- The analytics views are intentionally available to the dedicated Metabase
-- login. SECURITY INVOKER makes the views respect the underlying tables' RLS;
-- role-specific policies preserve Metabase reads without granting access to
-- anon or authenticated Data API callers.

alter table public.project_context enable row level security;
alter table public.deleted_accounts enable row level security;

revoke all privileges on table public.project_context from anon, authenticated;
revoke all privileges on table public.deleted_accounts from anon, authenticated;

alter view public.analytics_signups_daily set (security_invoker = true);
alter view public.analytics_tier_breakdown set (security_invoker = true);
alter view public.analytics_dau set (security_invoker = true);
alter view public.analytics_feature_usage set (security_invoker = true);
alter view public.analytics_top_users set (security_invoker = true);
alter view public.analytics_revenue set (security_invoker = true);

revoke all privileges on table public.analytics_signups_daily from anon, authenticated;
revoke all privileges on table public.analytics_tier_breakdown from anon, authenticated;
revoke all privileges on table public.analytics_dau from anon, authenticated;
revoke all privileges on table public.analytics_feature_usage from anon, authenticated;
revoke all privileges on table public.analytics_top_users from anon, authenticated;
revoke all privileges on table public.analytics_revenue from anon, authenticated;

drop policy if exists metabase_read_users on public.users;
create policy metabase_read_users
on public.users for select
to metabase_readonly
using (true);

drop policy if exists metabase_read_subscriptions on public.subscriptions;
create policy metabase_read_subscriptions
on public.subscriptions for select
to metabase_readonly
using (true);

drop policy if exists metabase_read_activity_log on public.activity_log;
create policy metabase_read_activity_log
on public.activity_log for select
to metabase_readonly
using (true);

-- These functions are called only by backend service-role RPCs or database
-- triggers. PostgreSQL grants EXECUTE to PUBLIC by default, which exposed the
-- SECURITY DEFINER functions directly through PostgREST RPC endpoints.
-- Pinning search_path also prevents callers from changing name resolution.

alter function public.reset_user_data(uuid)
  set search_path = pg_catalog, public;
alter function public.delete_user_data(uuid)
  set search_path = pg_catalog, public;
alter function public.merge_projects(uuid, uuid, uuid)
  set search_path = pg_catalog, public;
alter function public.handle_new_auth_user()
  set search_path = pg_catalog, public;
alter function public.update_updated_at()
  set search_path = pg_catalog, public;
alter function public.match_conversations(public.vector, uuid, double precision, integer)
  set search_path = pg_catalog, public;
alter function public.find_merge_candidates(uuid, double precision, integer)
  set search_path = pg_catalog, public;

revoke execute on function public.reset_user_data(uuid) from public, anon, authenticated;
revoke execute on function public.delete_user_data(uuid) from public, anon, authenticated;
revoke execute on function public.merge_projects(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.update_updated_at() from public, anon, authenticated;
revoke execute on function public.match_conversations(public.vector, uuid, double precision, integer)
  from public, anon, authenticated;
revoke execute on function public.find_merge_candidates(uuid, double precision, integer)
  from public, anon, authenticated;

grant execute on function public.reset_user_data(uuid) to service_role;
grant execute on function public.delete_user_data(uuid) to service_role;
grant execute on function public.merge_projects(uuid, uuid, uuid) to service_role;
grant execute on function public.handle_new_auth_user() to service_role;
grant execute on function public.update_updated_at() to service_role;
grant execute on function public.match_conversations(public.vector, uuid, double precision, integer)
  to service_role;
grant execute on function public.find_merge_candidates(uuid, double precision, integer)
  to service_role;
