# Maintenance scripts — MANUAL ONLY, never auto-applied

These SQL scripts are **destructive maintenance tools**, not migrations. They
live OUTSIDE `supabase/migrations/` on purpose: `supabase db push` only reads
`migrations/`, so nothing here can ever be applied by CI or by an accidental
`db push`.

> ⚠️ Do **not** move these back into `supabase/migrations/`. The CI `migrate`
> job runs `supabase db push` against **production**. A teardown script in the
> migrations path can be dragged into a prod push (this happened once via
> `--include-all` — it began running `000_rollback_all.sql` against prod and
> only aborted on a dependency-ordering quirk).

## Scripts

- **`000_rollback_all.sql`** — drops every table/function/trigger (full schema
  teardown). Only for wiping a throwaway/local database before re-running
  `001`–`NNN` from scratch. Running this against prod destroys all data.
- **`000_delete_user.sql`** — deletes a single user and all their data by email.
  Edit `target_email` before running. Intended for manual GDPR/cleanup requests.

## Running one (deliberately, against a chosen database)

```bash
# Local/throwaway DB only unless you are ABSOLUTELY sure:
psql "$DATABASE_URL" -f supabase/maintenance/000_rollback_all.sql
```
