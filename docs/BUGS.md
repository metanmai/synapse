# Known Bugs and Follow-ups

This file is the canonical "what's still broken" list for the project. It's tracked here (rather than as GitHub issues) because the repo lives on two remotes — `tanmain/synapse` (primary, where work happens) and `metanmai/synapse` (where CI runs, kept in sync by a bot) — and a markdown file in the repo gets mirrored automatically. Issues filed on one side wouldn't be visible from the other.

When closing an entry, move it to the `## Closed` section at the bottom with the commit SHA that fixed it. Keep the close note in case the bug returns later — the original symptoms + diagnostic notes are useful for "didn't we see this before?" moments.

---

## P1 — Process gaps

### Configure Supabase secrets so CI auto-migrate activates

Phase 2 added a `migrate` job to `.github/workflows/ci.yml` that runs `supabase db push` on every push-to-main. Today it's inert — the job runs but skips the actual `db push` because `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` / `SUPABASE_DB_PASSWORD` aren't configured as repo secrets on **metanmai/synapse** yet. Status: scaffolded but gated.

**Why it matters:** This is the same class of problem as P0 BUG-01 (which was about schema drift between repo migrations and prod going undetected). Until secrets are configured, migrations still require manual `supabase db push` from a CF-enabled machine — and "forgetting to push" is exactly how `merge_projects` is currently missing from prod (Phase 2 LinkPicker 5xx's because the function isn't there).

**One-time setup steps:**

1. Open https://supabase.com/dashboard → **Account → Access Tokens** → "Generate new token" (label it `synapse-ci`). Copy.
2. Open the Supabase project → **Settings → General** → copy the **Reference ID** (a short slug like `abcdefghijklmnop`).
3. The DB password is the postgres password from when the project was created. If lost: **Settings → Database → "Reset database password"** (note: this will require updating any other system using the DB password too).
4. In https://github.com/metanmai/synapse/settings/secrets/actions, add three repository secrets (NOT environment secrets — the migrate job uses `environment: prod` which inherits both repo and env-level secrets, but repo-level is simpler):
   - `SUPABASE_ACCESS_TOKEN` → the token from step 1
   - `SUPABASE_PROJECT_REF` → the slug from step 2
   - `SUPABASE_DB_PASSWORD` → the postgres password from step 3
5. Trigger a re-run of the latest CI workflow on metanmai (or push any commit) — the `migrate` job should now actually apply pending migrations instead of emitting the "secrets not configured" notice.

**Verification after setup:** the `migrate` job logs should show `Applying migration ...` lines instead of `::notice::Supabase auto-migrate skipped...`. Confirm against prod by running `select version from supabase_migrations.schema_migrations order by version desc limit 5;` in the Dashboard SQL Editor.

**Risk acknowledged:** once active, every push-to-main applies migrations. A careless `drop table` lands in prod with no manual review. Consistent with the solo-dev / merge-directly-to-main workflow per `feedback_no_prs.md`, but worth knowing.

**Code locations:**
- Job: `.github/workflows/ci.yml` (search for `migrate:` — between `verify:` and `e2e:`)
- Pending migration today: `supabase/migrations/019_merge_projects.sql` (Phase 2 D-07 RPC; needed for LinkPicker happy-path to stop 5xx-ing in prod)

---

## P2 — Coverage gaps

### 5a. Backend integration tests skip the actual handler logic for events-batch + 6 other endpoints

10+ `.skip`'d tests in `backend/test/api/` are gated on "requires valid auth token + DB". They cover the happy paths for `events-batch`, `events-batch-auto-create`, `project-status`, `project-events`, and `invites` — exactly the endpoints we'd want to regression-test against the actual reducer + DB schema. The active tests only verify auth enforcement (401 without bearer), not the handler logic itself.

**Why it matters:** The Cloudflare 1101 in P0 #1 was never caught by tests precisely because the handler-with-real-DB path is skipped. We have no signal short of production traffic.

**Fix sketch:** Either (a) stand up a test Supabase instance (free tier is enough for CI) and inject creds via repo secrets so the skipped tests run on metanmai CI, or (b) refactor the handler to take db + user as injectable args so we can mock them and test the pure logic.

**Code locations:** `backend/test/api/events-batch.test.ts:44-55`, `backend/test/api/events-batch-auto-create.test.ts:64`, `backend/test/api/project-status.test.ts:27-34`, `backend/test/api/project-events.test.ts:35-44`, `backend/test/api/invites.test.ts:43-51`

---

## P2 — Per-device CLI keys (a8ecf98 scope completion)

### 5. 409 `DEVICE_LIMIT_REACHED` has no UI in frontend

Free-tier users at the 3-device limit get a generic 500 from the wizard's "Continue as…" button, with no path to revoke an old device.

**Backend:** returns 409 with JSON body containing the device list (id, name, last_used_at, created_at) — fully implemented at `backend/src/api/auth.ts:277-293`. Endpoint that wraps the picker action: `POST /auth/cli-revoke-and-session` (also implemented, untested in production since Plus tier doesn't trigger the picker).

**Frontend gap:** `frontend/src/routes/cli-auth/+page.server.ts` `continueAs` action treats any non-OK as `fail(500, "Failed to create CLI session")`. Needs to branch on 409, parse the device list, set form state to render a picker.

**Picker UI:** new code in `cli-auth/+page.svelte` — list devices with radio buttons, show last_used relative time, on submit call a new `revokeAndContinue` action that POSTs to `/auth/cli-revoke-and-session`.

### 6. Dashboard rename UI for `cli-*` keys not built

Account page lists keys but doesn't let users rename them. Backend endpoint exists: `PATCH /api/account/keys/:id` at `backend/src/api/auth.ts:508` (strips `cli-` prefix for display, re-adds on save). Frontend account page needs inline-edit on key labels for keys whose label starts with `cli-`.

### 7. Legacy `cli`-labeled keys never get migrated to `cli-<device>` shape

Accounts that predate the per-device feature have keys labeled just `cli` (or worse, ad-hoc names like `M4 Pro` from manual creation). They show up in the dashboard as an indistinguishable pile.

**Phase 5 of original plan:** a one-shot rename script that turns legacy `cli` labels into `cli-legacy-<created_date>` so they're identifiable. Could be a SQL migration or a self-service "clean up old keys" button in the dashboard.

---

## P3 — Repo hygiene

### 8. Unmerged `worktree-agent-*` remote branches need triage

As of 2026-05-18, 8 unmerged on the remote: `worktree-agent-{a2a33b8a, a5f2f162, a8687b78, a95cfd91, a99a87ae, ada9ffce, ae176e01, ae93c2a6}`. Each is 1-385 commits ahead of main. Likely scratch from abandoned agent runs but each contains unique commits — can't bulk-delete without losing work.

Per-branch `git log origin/main..<branch>` diff needed before deletion.

### 9. `feat/oss-readiness` branch — 242 commits ahead, unmerged, status unclear

Substantial in-flight feature. Needs human triage: still active? Abandoned? Worth resurrecting or splitting up?

### 10. CF git auto-deploy can go silent without warning

Cloudflare's git-integration auto-deploy IS wired (and proved working on 2026-05-20 — commits `16a4de1` + `2eb158b` both deployed automatically), but the integration can sit idle for hours without firing on new pushes. On 2026-05-20 the integration hadn't fired in 14h; a no-op trigger commit (`2eb158b`, a comment-only change to `backend/wrangler.jsonc`) was required to wake it up.

**Consequences:** main can silently drift from what's actually serving requests. There's no in-dashboard signal that a recent push was skipped — you have to compare the CF Deployments tab tip to `git log main` manually.

**Fix sketch options:**
- Add a CF-deploy health check (cron-pinged endpoint that compares `serving SHA` to `main HEAD`).
- Switch to GitHub Actions `wrangler deploy` on push to main with CF API token in repo secrets (more explicit, removes the silent-idle failure mode).
- Document the "if no deploy fires in N minutes, push a no-op commit" workaround in the runbook.

### 13. Frontend has 12 svelte-check warnings (4 a11y, 8 unused-CSS)

Not blocking CI, but worth addressing:

**A11y (real issues):**
- `src/lib/components/layout/AppShell.svelte:60` — `<div>` with click handler missing keyboard handler + ARIA role (2 warnings against the same line)
- `src/routes/(app)/home/+page.svelte:77` — autofocus
- `src/routes/(app)/settings/+page.svelte:192` — autofocus

**Unused CSS selectors (dead styles or HTML mismatch):**
- `src/lib/components/landing/CliSetupWizard.svelte:154` — `.wizard-alt`
- `src/lib/components/landing/Hero.svelte:262, 275, 568` — `.hero-cta`, `.hero-cta:hover`, `.mockup-sidebar`
- `src/lib/components/landing/ProblemSection.svelte:86, 93, 99, 112` — `.problem-headline`, `.pain-points`, `.pain-point` (twice)

**Fix:** for each unused CSS selector, decide whether to (a) delete the rule (selector is dead), or (b) restore the missing class name to the HTML (selector targets a stale element name).

---

## P4 — Performance / correctness, no user impact yet

### 14. Orphan `handoff_sessions` and `handoff_issues` tables in production DB

Migration `015_handoff_layer.sql` created `handoff_sessions` and `handoff_issues` tables. Migration `016_drop_handoff_session_fks.sql` dropped the FK constraints but kept the tables. **No code anywhere in `backend/src` or `packages/shared/src` reads or writes either table.** They sit empty in production, accumulating only an empty schema with RLS overhead.

`016`'s comment notes this: *"The reducer materializes session and actor state purely from events — the tables were redundant in v1's design. v1.1 drops the FKs; the columns remain as loose text references … The tables themselves stay (RLS preserved) in case a future version wants to denormalize for query performance."*

**Decision needed:** Either commit to the denormalization plan and start writing to these tables, or drop them entirely. As-is, they're a constant invitation for someone to query the wrong table and get nothing back.

---

### 11. `recomputeProjectStatus` reads all events per batch

`backend/src/lib/handoff-reducer.ts:6-19` — on every `/api/events/batch` POST, for every distinct `project_id` in the batch, the full event history is fetched and reduced. O(events_per_project) cost per flush cycle (every 10 seconds via the daemon).

**Fix sketch:** Maintain `ProjectStatus` incrementally — apply only the new events to the existing materialized status. The reducer is structured as a left fold, so this is feasible.

---

## Closed

Fixed in the 2026-05-18 session:

- **CLI didn't pass `device_name` through OAuth-style auth URL** — fixed in `34de058`
- **Wizard's "Start capturing" prompt didn't actually install Claude Code hooks** — fixed in `d3cd771`
- **Launchd plist argv mangled** (single string `"node /path/to/commands.js"` instead of separate `<string>` elements) — fixed in `d3cd771`
- **Service file written but never `launchctl load`ed** — fixed in `d3cd771`
- **Service file pointed at `dist/cli/commands.js`** (a helper module with no main) **instead of `dist/index.js`** (the dispatcher entry) — fixed in `025a814`

Fixed in the 2026-05-19 to 2026-05-20 sessions (Phase 1, slice 1a-prime + 1b):

- **#1 `/api/events/batch` Cloudflare 1101** — fixed on two layers: functional (re-applied migrations 015/016/017 to restore the missing `handoff_events` table on prod Supabase — the actual root cause, *not* the Promise.all hypothesis from research D1) + defensive (`Promise.allSettled` swap in `backend/src/api/events-batch.ts:147` to isolate per-project recompute failures from now on) — `16a4de1` + `2eb158b`
- **#2 `synapse capture status` reports "stopped" under launchd** — fixed by `checkSupervisor()` platform dispatch in `mcp/src/cli/util/daemon-supervisor.ts` — `17be259`
- **#3 Wizard writes `npx synapsesync` configs blocked by Netskope** — fixed by three-tier MCP command resolver (`which synapsesync` → `node <abs-path>/dist/index.js` → `npx`) in `mcp/src/cli/util/mcp-command.ts` — `1f11b55`
- **#4 `synapse init` doesn't write `.mcp.json` for current project** — fixed by adding `editorIo.writeMcpJson(cwd, ...)` + `ensureGitignore` to the init flow — `768b139`
- **#12 Daemon flush has no retry/backoff** — fixed by `computeNextDelay` pure helper + setTimeout-chain replacing the unconditional 10s interval; jittered exponential 10s → cap 5min — `17be259`
