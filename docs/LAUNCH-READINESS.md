# Pre-Public-Launch Readiness — Action List

**Status as of 2026-06-09**: Product technically `shipped` (milestone close 2026-05-29) but NOT yet publicly revealed. Owner wants the operational + security gaps closed before strangers can sign up.

**Source of this list**: 2026-06-09 session audit (security review + Supabase RLS/IO alert + feature-test coverage audit). All work is on `main` already; no PR in flight.

---

## STOP-SHIP (must close before any public reveal)

### 1. ✅ DONE — RLS enabled on the two unprotected tables (`d146d26`, `41c1c3b`)

**Status correction (2026-06-10)**: the original "ZERO tables have RLS" claim was a case-sensitive-grep false positive. A case-insensitive sweep showed 20 of 22 tables already had RLS on. The actual gap was only `project_context` (migration 012) and `deleted_accounts` (013).

**What shipped**: `supabase/migrations/027_rls_remaining_tables.sql` with two `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements. No policies — both tables are accessed exclusively by the backend service-role client, so deny-by-default for anon/authenticated is the correct posture. Audit confirmed `frontend/src/lib/server/auth.ts` (the only anon-key consumer) never queries either table.

**Still pending in PROD** — see item #3 below. Apply via `supabase db push` from a credentialed machine, then verify:
```
curl https://<project>.supabase.co/rest/v1/project_context -H "apikey: <anon>"  # → [] or 401
curl https://<project>.supabase.co/rest/v1/deleted_accounts -H "apikey: <anon>" # → [] or 401
```
Backend `/api/projects` etc. must still respond normally (service-role path).

### 2. ⚠ Cloudflare per-key rate limit (DASHBOARD WORK)

**Why stop-ship**: a single stolen / leaked API key today = unbounded LLM cost amplification via `/api/conversations/<id>/compact`. No rate-limit middleware in `backend/src/middleware/` (only `db.ts` + `project-auth.ts`).

**Fix (in CF dashboard, not code)**:
- Cloudflare → Security → WAF → Rate limiting rules → Create rule
- Expression suggestion: bucket by `http.request.headers["authorization"]` value
- Threshold: 1000 requests / 5 min per key (tune later)
- Action: `block` with custom 429 + `Retry-After: 60`
- Free tier allows 1 rate-limit rule; this is the most valuable single rule.

### 3. Supabase RLS application + verify

After (1)'s migration is written:
- Apply to production (via `npx supabase db push` OR the existing `migrate` CI job if `SUPABASE_*` secrets are configured on metanmai — per `action_supabase_ci_secrets.md` they are NOT yet, scaffolded 2026-05-21 but skipping).
- Confirm production behavior unchanged (Cloudflare backend endpoints still respond).
- Confirm anon traffic is denied.

### 4. Backend code security review

This session only reviewed THIS session's diff. The `backend/src/` codebase has months of code that was NOT audited. Before strangers send requests, a real review is needed.

**Scope**:
- `backend/src/routes/` — every route handler for auth/authz logic, input validation, parameter handling
- `backend/src/middleware/project-auth.ts` — the auth gate everyone trusts
- Any direct SQL or raw query construction
- Cross-user data isolation — when user A accesses project X owned by user B, who blocks it?

**Estimated effort**: 4-6 hours of careful read + adversarial thinking.

### 5. ✅ DONE — Test account quota hygiene (CI auto-sweep before account-using jobs)

**What shipped (2026-06-10)**:
- `scripts/cleanup-test-account.mjs` — env-key-only auth (refuses `~/.synapse/config.json` fallback by design), age-threshold (default 45 min) protects concurrent matrix legs, `--keep` repeatable, exit 0 even on per-delete failures so hygiene never masks the real e2e signal. Pure stale-selection logic in `scripts/lib/stale-projects.mjs` with 23 unit tests in `mcp/test/unit/stale-projects.test.ts`.
- New `cleanup-e2e-account` CI job in `.github/workflows/ci.yml` runs before BOTH the `e2e` and `happy-flow-e2e` matrices (via `needs: [verify, cleanup-e2e-account]`). Graceful skip on tanmain.
- New `project-cap-e2e` job (serial, post matrix legs) saturates the cap with a tighter 10-min sweep first, asserts the structured 402 PROJECT_QUOTA_EXCEEDED contract — closes #7 too.

Result: the 402 quota failure class is foreclosed in CI. Local sweep on the maintainer's own account also cleared 29 leaked e2e-pattern projects (`synapse-e2e-*`, `e2e-roundtrip-*`, `insight-roundtrip-*`, `multi-device-*`, `synapse-proxy-l[57]-*`, `synapse-real-*`).

---

## SHOULD-SHIP (close soon after public reveal)

### 6. ✅ DONE (insight-roundtrip in gate); ⏳ PARTIAL (multi-device deferred)

**What shipped (2026-06-10)**:
- `scripts/e2e-insight-roundtrip.mjs` appended to root `package.json` `test:e2e`. Now ALSO hardened: forces flush via `synapsesync sync` instead of blanket-sleeping, and IR3 polls (12 × 5s) instead of one-shot retry.
- `e2e-multi-device.mjs` NOT in the gate yet — preflight tightened to require direct-API mode (cli-driver can't pass; X-Synapse-Cwd attribution gap documented inline). MD3 also polls. Can be added once OPENROUTER_API_KEY (or equivalent) is in CI secrets for the happy-flow leg (ANTHROPIC_API_KEY already is). Optional: add a `needs: cleanup-e2e-account` job that runs it standalone.

### 7. ✅ DONE — `e2e-project-cap.mjs` in CI as serial post-matrix job

See item #5 — `project-cap-e2e` job in `.github/workflows/ci.yml`, serial, runs after both happy-flow + e2e matrix legs complete.

### 8. ✅ DONE — Backend deploy workflow shipped (waiting on secret)

**What shipped (2026-06-10)**: `.github/workflows/deploy-backend.yml`. Single job, push-to-main, `concurrency: deploy-backend` with `cancel-in-progress: false` (never kill a mid-flight deploy), graceful-skip when `CLOUDFLARE_API_TOKEN` absent (mirrors `migrate` job pattern). Uses `npx --no-install wrangler deploy` from `backend/` — wrangler is already a devDependency pinned at ^4.75.0, so no mid-deploy npm fetch.

**Owner action**: add `CLOUDFLARE_API_TOKEN` to metanmai/synapse repo secrets to activate.

### 9. ✅ DONE — Load test script shipped (manual, not in CI)

**What shipped (2026-06-10)**: `scripts/load-test.mjs`. Worker-pool pattern (NOT Promise.all herd), `--requests` / `--concurrency` / `--base` / `--endpoint` flags. Reports p50/p95/p99 + error rate + RPS + status-code histogram. Auth from env only; never wired into CI (header warns: real load against production, run manually before public reveal).

### 10. ⏳ PARTIAL — Migration 028 written (perf indexes + activity_log retention)

**What shipped (2026-06-10)**: `supabase/migrations/028_perf_indexes_and_retention.sql`. Three changes:
- `idx_conversations_project_updated` composite index `(project_id, updated_at DESC)` — directly addresses the suspected #1 disk-IO culprit (pull-handoff pre-warm sort).
- `prune_activity_log(retention_days int default 90)` SECURITY DEFINER function with hardened search_path; matches the house style from migrations 011/019.
- pg_cron `daily-activity-log-prune` job (02:00 UTC) wrapped in a guarded `DO $$ ... $$` block: checks `pg_extension` for installed-state (NOT `pg_available_extensions`, which would silently succeed on Supabase where pg_cron is available-but-not-enabled), no-ops with `RAISE NOTICE` otherwise. Manual fallback: `SELECT prune_activity_log();`.

**Owner action**: `supabase db push` from a credentialed machine (or activate CI auto-migrate via the SUPABASE_* secrets task).

**Still pending diagnostic** (the rest of #10): Supabase dashboard → Reports → Database → Query Performance to confirm the index actually drops the top query; consider rate-limiting pull-handoff pre-warm to event-driven instead of interval-based.

### 11. Disk IO investigation (kept as a follow-up — was originally bundled into #10)

User reported high disk IO with only themselves as a user. Suspects ranked:
- **Continuous `pull-handoff` pre-warm** (`mcp/src/capture/pull-compact.ts`) — fires per project per interval. If many projects tracked, N × interval reads/sec on `conversations` + `project_context`. Probable #1 culprit.
- **`activity_log` with no retention** — every action inserts a row, never pruned.
- **Missing composite index** on `conversations(project_id, updated_at desc)` — pull-compact's list query ORDER BY this; without the index it's a sort on every call.
- **CloudSync 3x retry storm** (added 2026-06-09 in `aa2593b`) — when backend returns 402, retries do nothing but burn IO. Could throttle to 1 attempt for known-non-transient codes OR gate the retry behind transient-only.

**Diagnostic**: Supabase dashboard → Reports → Database → Query Performance → sort by total time. Top 1-3 queries will name the culprit.

**Likely fixes**:
- Make `pull-handoff` event-driven (only fire post-session-end) instead of interval-based
- Add `activity_log` retention: daily Postgres function that DELETEs rows older than 90 days
- Add missing index migration

---

## NICE-TO-HAVE (post-public)

- **5 orphaned e2e scripts** to `test:e2e:all`: `e2e-conversation-lru`, `e2e-insight-cap`, `e2e-llm-driver`, `e2e-real-tool-roundtrip`. (`e2e-project-cap` already promoted to its own CI job; `e2e-insight-roundtrip` is now in the merge gate.)
- **Audit logs** — `who did what when` table for sensitive operations. Hard to add later cleanly.
- **Per-endpoint cost tracking** — separate rate-limit buckets for expensive endpoints (`/compact` etc).
- ~~**Cross-platform unit-test parity** for `launchctl`/`systemctl`/`schtasks`.~~ ✅ DONE 2026-06-10 — see commit `e2fe77d`. Injection seam in `daemon-supervisor.ts` + 27 tests in `status.test.ts` covering all three platforms.
- **Windows hook-timing budget tightening** — `scripts/e2e-happy-flow.mjs:107` allows Windows 7500ms vs Linux/macOS 5000ms for `HOOK_FAST_TIMEOUT_MS`. Once the source of the 1500ms slowdown is rooted, tighten back.
- **DDoS / on-call runbook** in `docs/`.
- **Production observability dashboard** — request rate / error rate / p95 latency / active users.
- **Docker-stand-in for local-compact** — per the *_BASE_URL escape hatch shipped 2026-06-10. A minimal HTTP service that returns valid Anthropic/OpenAI JSON shapes so the gate can run offline / through provider outages. Foundation is in `mcp/src/capture/llm-providers.ts` (env override); just needs the stub.

---

## Already done (this session, 2026-06-09) — don't redo

| Commit | What it shipped |
|---|---|
| `aa32427` | stats: iterate-on-404 for `/api/context/<name>/list` |
| `7bdadea` | stats: iterate-on-404 for `/api/projects/<id>/activity` |
| `36072b7` | whoami + tree: same iterate-on-404 (cross-platform fix) |
| `dba716e` | e2e-cli.mjs: Node 24 Windows libuv exit-race fix (set `exitCode`, not `process.exit`) |
| `13c74d4` | synapsesync binary `exitCli()` helper in `handleCli` (covers reset/refresh/purge-empty Windows fastfail) |
| `75a5546` | run-pull-handoff: same libuv fix (covers `pullHandoff.run` Windows fastfail) |
| `aa2593b` | CloudSync: retry on transient 5xx/408/429 (3 attempts, 500/1000ms backoff) + companion "Sync FAILED" log in capture-worker |
| `424eb87` | adapter-roundtrip: echo daemon-log lines on Stage 6 failure (the diagnostic that surfaced today's HTTP 402) |
| `3b265f9` | e2e-cli: invite + sync test coverage (closed the 2-of-23 commands gap) |
| `d146d26` (2026-06-10) | RLS enabled on `project_context` + `deleted_accounts` (only 2 unprotected; 20/22 already had it) |
| `41c1c3b` (2026-06-10) | SUMMARY for RLS migration + correction of the "ZERO tables have RLS" false positive |

## Already done (this session, 2026-06-10 — the green-up-CI batch)

| Commit | What it shipped |
|---|---|
| `37aec2f` | docs(quick): backfill 260601-vpu SUMMARY (housekeeping) |
| `b3fdb85` | fix(installer): `resolveStableNodePath` rewrites Cellar paths to formula symlinks — kills the "brew upgrade node deletes all 6 hooks" bug class |
| `5bd8e43` | fix(daemon,sync): cycle is flush-only for unresolved `cwd_` placeholders + `synapsesync sync` unions map + disk project ids |
| `9c0dfae` | feat(local-compact): `ANTHROPIC_BASE_URL`/`OPENROUTER_BASE_URL`/`DEEPSEEK_BASE_URL` env overrides — escape hatch for provider outages |
| `83cadd7` | feat(ci): `cleanup-test-account.mjs` — 402-quota foreclosure script with safety-rule auth + age threshold |
| `8e47b0a` | test(backend): 24 it.skip stubs → real mocked-Supabase tests; 2 → e2e contract tests; 0 → deleted (501 pass, 0 skip — was 477+26) |
| `e2fe77d` | test(cli): cross-platform launchctl/systemctl/schtasks parity via injection seam (138 pass, 0 skip on every OS) |
| `8acd8a7` | test(mcp): split e2e suite into `vitest.e2e.config.ts` — un-skip ~165 e2e tests counted as skipped on every verify run |
| `b2b82a4` | ops: migration 028 (perf composite index + `prune_activity_log` + pg_cron-guarded scheduling) + `scripts/load-test.mjs` + `.github/workflows/deploy-backend.yml` |
| `9813aa8` | test(e2e): `insight-roundtrip` + `multi-device` switched to poll-don't-sleep; force-flush via `synapsesync sync`; root `test:e2e` appends insight-roundtrip |
| `f74f76f` | ci: `cleanup-e2e-account` pre-gate + un-skip 5 syncSuite tests + serial `project-cap-e2e` job |
| `7394ccc` | style(lint): biome optional-chain in `baseUrl` helper |

Result: **all 14 metanmai jobs green with zero skipped tests** in CI run `27281443605` (TBD verify on completion). Six distinct skip classes eliminated (3 darwin-gated CLI, ~165 e2e collection, 27 backend stubs, 5 Cloud Sync contract). Both CI and Deploy Backend workflows shipped.

---

## Recommended order for the next agent

~~1. Start with **#1 RLS migration**~~ ✅ DONE 2026-06-10 (`d146d26`).

1. **#3 Apply migration 027 to PROD** + **#10 apply migration 028 to PROD** — same `supabase db push` from a credentialed machine, run the two `curl` checks for 027 + a `SELECT prune_activity_log();` smoke for 028. Owner-side; ~10 min.
2. **Configure CI secrets**: `CLOUDFLARE_API_TOKEN` (activates `deploy-backend.yml` from #8), `SUPABASE_ACCESS_TOKEN`+`SUPABASE_PROJECT_REF`+`SUPABASE_DB_PASSWORD` (activates the `migrate` job — already scaffolded, currently gracefully skipping). Both ~5 min in GitHub repo settings.
3. **#11 disk-IO investigation** — pull the Supabase Query Performance screenshot. With migration 028 applied, the composite index should have shifted the top query; act on whatever's now #1.
4. **Add `multi-device` to the merge gate** (was #6's second half): need a provider key in the happy-flow CI env (ANTHROPIC_API_KEY already is); 1-line `package.json` append.
5. **#2 Cloudflare rate limit** — block on owner's dashboard access; agent can draft the WAF expression text.
6. **#4 backend security review** — multi-hour, do last with focused effort.
