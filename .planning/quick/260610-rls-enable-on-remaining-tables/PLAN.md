---
slug: rls-enable-on-remaining-tables
created: 2026-06-10
status: in-progress
mode: gsd-quick
references:
  - docs/LAUNCH-READINESS.md (item #1 STOP-SHIP)
---

# Quick — Enable RLS on `project_context` + `deleted_accounts`

## Task

`docs/LAUNCH-READINESS.md` item #1 (STOP-SHIP): close the defense-in-depth gap by enabling Row-Level Security on the two Supabase tables that don't have it yet.

## Discovery (case-corrected)

The LAUNCH-READINESS doc said "ZERO tables have RLS enabled" — that was wrong. The original `grep` used uppercase `ENABLE ROW LEVEL SECURITY` but migrations use lowercase. A case-insensitive grep shows 20 of 22 tables already have RLS on. The actual gap:

| Table | Migration | RLS today | Read paths | Anon-key reachable? |
|---|---|---|---|---|
| `project_context` | 012 | NO | `backend/src/db/queries/conversations.ts` (only) | No |
| `deleted_accounts` | 013 | NO | `backend/src/db/queries/deleted-accounts.ts` (only) | No |

Both tables are accessed exclusively by the backend, which uses `SUPABASE_SERVICE_KEY` — service-role bypasses RLS by design. The frontend's only anon-key client lives in `frontend/src/lib/server/auth.ts` (SvelteKit SSR cookie auth → user JWT) and it never queries either table.

## Plan

1. Write `supabase/migrations/027_rls_remaining_tables.sql` — two `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements, no policies. Matches the deny-by-default pattern used by `conversations`, `insights`, etc.
2. Run `npm run lint && npm run typecheck`.
3. Commit + push. SUMMARY.md + Synapse insight.

## Why no policies

Backend uses service-role → bypasses RLS regardless. There are no anon/authenticated read paths for either table today. RLS-enabled-with-no-policies = strictest possible deny-by-default for any future non-service-role caller, which is what we want.

## Bug class guarded

**Class**: "A Supabase table created without RLS is anon-readable in production if the anon key leaks." This migration closes the two known instances. A class-level guard (CI lint that scans every `create table` for a matching `enable row level security`) is captured as a follow-up in the SUMMARY, not in scope here — the user feedback "don't add features beyond what the task requires" wins.

## Out of scope

- Granular SELECT policies for the two tables (backend-only access).
- Applying the migration to PROD Supabase (separate item #3 of LAUNCH-READINESS.md, requires owner action via `supabase db push` or the CI auto-migrate job once SUPABASE_* secrets are wired on metanmai).
- Re-validating RLS on the other 20 tables (already on).

## Rollback

If anything regresses in PROD:
```sql
alter table project_context disable row level security;
alter table deleted_accounts disable row level security;
```
But this shouldn't break anything — backend service-role bypasses RLS.

## Tests

No E2E test. The migration has no application code path; service-role behavior is unchanged. Unit / integration tests would need a live Supabase to test "anon SELECT now returns 0 rows," which is a NICE-TO-HAVE follow-up if this becomes a recurring concern.
