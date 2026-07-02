-- 027_rls_remaining_tables.sql
--
-- Defense-in-depth: enable Row-Level Security on the two tables created
-- without it. Both are accessed exclusively by the backend, which uses
-- SUPABASE_SERVICE_KEY (service-role bypasses RLS by design), so behavior
-- is unchanged. Anon / authenticated paths now hit deny-by-default
-- (no policies = no rows returned), closing the gap that would otherwise
-- expose these tables if the anon key ever leaked.
--
-- See docs/LAUNCH-READINESS.md item #1 for context and rollback steps.

alter table project_context enable row level security;
alter table deleted_accounts enable row level security;
