---
quick_id: 260621-hsl
slug: neutralize-ci-migrate-prod-wipe-landmine
status: complete
date: 2026-06-21
---

# Quick Task 260621-hsl: Neutralize CI migrate prod-wipe landmine

## Problem (near-miss, found via CI failure triage)

After `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` were added to metanmai (DB password still blank), the `migrate` CI job flipped skip→run and executed `supabase db push --include-all` against **production**. `--include-all` forced the out-of-sequence `supabase/migrations/000_rollback_all.sql` — a "drop everything" teardown (21 DROPs, CASCADE on tables) — into the prod push. It only aborted at `DROP FUNCTION update_updated_at()` (no CASCADE) because migration 023's `conversations_updated_at` trigger depended on it. Prod was saved by luck, and the job retries on every push.

## Fix

1. **Relocate** `000_rollback_all.sql` + `000_delete_user.sql` from `supabase/migrations/` → `supabase/maintenance/` (+ README). They are manual-only destructive scripts; `supabase db push` only reads `migrations/`, so they can never auto-apply.
2. **Drop `--include-all`** in the `migrate` job → plain `supabase db push` (applies only migrations newer than the remote watermark; teardown scripts are below it and skipped).
3. **Harden the skip guard** to require all three secrets (`ACCESS_TOKEN` + `PROJECT_REF` + `DB_PASSWORD`) — a partial config now skips green instead of firing a half-configured prod push.
4. Document the near-miss in `docs/BUGS.md` (canonical bug record).

## Out of scope

`cleanup-e2e-account` fails `401` on a stale `SYNAPSE_E2E_API_KEY` (cascading-skip to all 6 account e2e jobs). That's owner-side secret rotation on metanmai, not a code fix.

## Verify

- `ci.yml` valid YAML; `migrations/` no longer contains any `000_*`; full `npm run` verify green; CI `migrate` job goes green (skips until DB_PASSWORD set).
