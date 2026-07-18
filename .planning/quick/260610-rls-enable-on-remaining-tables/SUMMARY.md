---
slug: rls-enable-on-remaining-tables
created: 2026-06-10
status: complete
mode: gsd-quick
commit: d146d26
references:
  - docs/LAUNCH-READINESS.md (item #1 STOP-SHIP)
  - supabase/migrations/027_rls_remaining_tables.sql
---

# SUMMARY — Enable RLS on `project_context` + `deleted_accounts`

## Outcome

Migration `027_rls_remaining_tables.sql` written and committed (`d146d26`). RLS now enabled on the last two Supabase tables that lacked it: `project_context` (012) and `deleted_accounts` (013).

## What changed (against the original LAUNCH-READINESS.md scope)

The doc said "ZERO tables have RLS enabled" and listed 22 tables to write `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for. **That was a case-sensitive-grep false positive.** A case-insensitive sweep showed 20 of 22 tables already had RLS on; only `project_context` and `deleted_accounts` were unprotected. So the migration is 2 lines, not 22.

| Item from LAUNCH-READINESS.md | Reality |
|---|---|
| "ZERO tables have RLS" | 20 of 22 already had it |
| "Write `ALTER TABLE … ENABLE …` for ~22 tables" | Wrote 2; the rest already done in migrations 001, 002, 003, 004, 006, 007, 015, 017 |
| "Audit frontend `lib/server/` for anon-key usage" | Done — only `frontend/src/lib/server/auth.ts` uses the anon key (SvelteKit SSR cookie auth → user JWT); never queries the two gap tables |
| "Service role bypasses RLS — backend continues to work" | Confirmed — `backend/src/db/queries/conversations.ts` + `deleted-accounts.ts` are the only callers, both via service-role |

## Verification

- `npm run lint` ✓ (443 files biome-clean)
- `npm run typecheck` ✓ (all 4 workspaces — backend, frontend 501 files, mcp, packages — 0 errors)
- Pre-push hook ✓ (816 tests passed, 163 e2e skipped per `test:e2e` separation)
- Push ✓ (`f824de6..d146d26 main -> main` to tanmain/synapse)

## Open follow-ups (NOT done here, listed for the next agent)

1. **Apply migration 027 to PROD Supabase** — LAUNCH-READINESS.md item #3. Either via `supabase db push` from a machine with credentials, or wait for the `migrate` CI job (currently graceful-skipping until `SUPABASE_*` secrets are configured on metanmai/synapse — `action_supabase_ci_secrets.md`).
2. **Bug-class guard against the recurrence** (NICE-TO-HAVE, deferred): a CI lint that scans every `create table` in `supabase/migrations/*.sql` for a matching `alter table … enable row level security`. Would fail CI if anyone adds a new table without RLS — the same class of bug this migration just closed by hand.
3. **Verify post-apply behavior in PROD**: `curl https://<project>.supabase.co/rest/v1/project_context -H "apikey: <anon>"` and same for `deleted_accounts` should return `[]` or 401. Backend `/api/projects` etc. must still respond normally.

## Why this is "complete" without applying to PROD

PROD apply is a deploy concern, not a code concern. The migration file is the deliverable; running `supabase db push` is owner-side dashboard / credential work. Same model as other recent migrations (018, 019, 025 were applied to PROD in a separate commit `45cde12`).

## Bug class

**Class guarded today (instance-level):** `project_context` and `deleted_accounts` are no longer anon-readable in any future scenario where the anon key leaks.

**Class NOT yet guarded at the time (recurrence-level):** A new `create table` in a future migration without RLS would still be a problem. Captured as follow-up #2 above and closed in the 2026-07-18 recurrence close-out below.

## Production close-out — 2026-07-17

The production-apply and post-apply verification follow-ups are now closed. Although migration `027_rls_remaining_tables.sql` was recorded in the remote migration history, production had drifted and both tables still had RLS disabled. The direct 2026-07-17 production repair was captured reproducibly in `20260717170215_harden_public_schema_rls.sql` (`454af70e`).

The broader repair:

- enabled RLS and revoked `anon`/`authenticated` grants on `project_context` and `deleted_accounts`;
- changed all six analytics views to security-invoker and removed browser-role access;
- fixed the search paths and restricted execution on seven privileged functions;
- preserved the dedicated Metabase read-only policies and backend service-role access; and
- reduced Supabase advisor errors to zero after production verification.

Accordingly, original follow-ups 1 (apply migration 027) and 3 (verify production behavior) are closed/superseded by the direct hardening and its catalog/advisor checks. Original follow-up 2—the recurrence-level CI guard that rejects future tables created without RLS—remains deferred and is not claimed as implemented.

Adjacent operational close-out facts: migration 031 (`api_keys.scope`) was applied and its column/default/check constraint verified in production. GitHub `prod` now contains the `SUPABASE_DB_PASSWORD` secret name (presence confirmed; value not inspected), completing the three-secret auto-migrate configuration. GitHub Actions run `29599228105` attempt 2 was successful before that password was added, so a future push/rerun remains the evidence that the migration job consumes it.

Two non-critical Supabase warnings remain: leaked-password protection is a dashboard setting, and moving `pgvector` out of `public` requires a coordinated dependency-aware migration.

## Recurrence close-out — 2026-07-18

Original follow-up 2 is now closed. `scripts/lint-migration-rls.mjs` evaluates the ordered `supabase/migrations/*.sql` chain and fails when any surviving public table ends with Row-Level Security disabled. It accounts for RLS enabled in a later migration, later disables, dropped tables, schema qualification, quoted identifiers, comments, strings, and dollar-quoted function bodies. `npm run lint:migrations` runs the repository audit plus parser regression tests; it is part of local `npm run verify` and the Linux/Windows CI verify matrix. The current chain contains 24 public tables and all pass.

This is intentionally a recurrence guard for table-level RLS enablement, not a complete SQL security analyzer: policy correctness, grants, security-definer functions, views, and destructive data transformations still require migration review and Supabase advisor checks.
