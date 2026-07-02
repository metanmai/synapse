---
quick_id: 260621-hsl
slug: neutralize-ci-migrate-prod-wipe-landmine
status: complete
date: 2026-06-21
---

# Summary — Neutralize CI migrate prod-wipe landmine

## What shipped

| Change | File |
|---|---|
| Relocated destructive teardown scripts out of the auto-push path | `supabase/maintenance/000_rollback_all.sql`, `000_delete_user.sql` (was `supabase/migrations/`) |
| Added a README warning never to move them back | `supabase/maintenance/README.md` |
| `supabase db push --include-all` → `supabase db push` (forward-only) | `.github/workflows/ci.yml` |
| Skip guard now requires ACCESS_TOKEN + PROJECT_REF + **DB_PASSWORD** | `.github/workflows/ci.yml` |
| Documented the near-miss | `docs/BUGS.md` |

## Why

CI's `migrate` job ran `db push --include-all` against prod and began executing `000_rollback_all.sql` (drop-everything). It aborted only on a dependency-ordering quirk (non-CASCADE `DROP FUNCTION` vs migration 023's trigger). The fix makes it structurally impossible for a teardown/maintenance script to auto-apply, and makes a half-configured secret set skip rather than fire.

## Result

- `migrations/` contains no `000_*` files; `ci.yml` valid YAML; full verify green.
- `migrate` job: green no-op now (DB_PASSWORD unset → skips); when fully configured it applies only forward-pending migrations.

## Not fixed here (owner-side)

`cleanup-e2e-account` → `401` on stale `SYNAPSE_E2E_API_KEY`, which cascade-skips the 6 account-based e2e jobs. Rotate the secret on metanmai with a current key (e.g. from `~/.synapse/config.json`) to turn that chain green.
