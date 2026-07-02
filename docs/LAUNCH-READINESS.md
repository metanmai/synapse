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

### 5. Test account quota hygiene (so CI signal is trustable)

Today (2026-06-09) the test account on the backend hit HTTP 402 (tier-quota exhausted) due to ~15 organic CI runs. CI is now red-on-half-of-runs with a pattern that LOOKS like adapter-roundtrip flake but is really quota gating. Until this is fixed, we can't tell real regressions from quota noise.

**Fix options (pick one)**:
- (a) Bump `SYNAPSE_E2E_API_KEY`'s account to a higher tier on the backend / mark it test-exempt
- (b) Write `scripts/cleanup-test-account.mjs` that runs `purge-empty --yes` + drops old test conversations; add to CI as a pre-step or daily cron
- (c) Have backend not enforce quota for any API key with a known test-token prefix

**Recommendation**: (a) is the cleanest. (b) is the most defensive (covers future heavy CI days regardless of tier).

---

## SHOULD-SHIP (close soon after public reveal)

### 6. Add `e2e-multi-device.mjs` + `e2e-insight-roundtrip.mjs` to merge gate

**Why**: Both are launched features with ZERO continuous regression coverage. Multi-device key support shipped in `46bdabb` (per `project_per_device_keys_status.md`); insights are the central Synapse value prop. Today's merge gate (`test:e2e` in `package.json`) runs 6 scripts; these 7 are in `test:e2e:all` but not gated.

**Fix**: Edit `package.json` `test:e2e` line to append `&& node scripts/e2e-multi-device.mjs && node scripts/e2e-insight-roundtrip.mjs`. Estimated added wall time: ~3-5 min per CI run.

### 7. Add `e2e-project-cap.mjs` to merge gate

Specifically because this script tests the structured 402 quota response — exactly what bit us in CI today. Would have prevented the multi-hour debugging session.

### 8. Backend deploy automation (GitHub Action)

**Why**: Per `learning_cf_auto_deploy.md` and BUGS.md #10, current state is "wrangler deploy is manual from one machine." Real risk of fixing a bug locally and forgetting to ship it.

**Fix**: New `.github/workflows/deploy-backend.yml` that runs `wrangler deploy backend/` on push to main, gated on `verify` job passing. Needs `CLOUDFLARE_API_TOKEN` secret added to repo settings (hands-on).

**Constraint**: per `project_split_machine_wrangler.md` wrangler is unusable on owner's primary device — the workflow IS the only path forward.

### 9. Load test (`scripts/load-test.mjs`)

**Why**: zero evidence the backend tolerates even modest concurrent load. Today's CI account-quota accident is the closest thing to a load test, and it was accidental.

**Shape**: simple `Promise.all` of N concurrent fetches against `/api/projects` and `/api/conversations`, report p50/p95/p99 + error rate. Run manually before public reveal.

### 10. Disk IO investigation (Supabase dashboard work + targeted fixes)

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

- **5 orphaned e2e scripts** to `test:e2e:all`: `e2e-conversation-lru`, `e2e-insight-cap`, `e2e-llm-driver`, `e2e-real-tool-roundtrip`. (`e2e-project-cap` already promoted in item #7.)
- **Audit logs** — `who did what when` table for sensitive operations. Hard to add later cleanly.
- **Per-endpoint cost tracking** — separate rate-limit buckets for expensive endpoints (`/compact` etc).
- **Cross-platform unit-test parity** — currently 4 darwin-only tests for `launchctl` (`mcp/test/cli/status.test.ts`, `mcp/test/cli/hook-dispatch.test.ts`). No equivalent tests for `systemctl` (Linux) or `schtasks` (Windows). Write them so Linux/Windows daemon-supervisor logic has coverage too.
- **Windows hook-timing budget tightening** — `scripts/e2e-happy-flow.mjs:107` allows Windows 7500ms vs Linux/macOS 5000ms for `HOOK_FAST_TIMEOUT_MS`. Once the source of the 1500ms slowdown is rooted, tighten back.
- **DDoS / on-call runbook** in `docs/`.
- **Production observability dashboard** — request rate / error rate / p95 latency / active users.

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

Result: **1:1:1 macOS/Linux/Windows parity proven** in metanmai CI run `27132064970` (Windows e2e-cli 66/66 PASS, 0 SKIP). All test-suite Windows-skip guards removed. Five distinct Windows-specific bug classes rooted and fixed.

---

## Recommended order for the next agent

~~1. Start with **#1 RLS migration**~~ ✅ DONE 2026-06-10 (`d146d26`).

1. **#3 Apply migration 027 to PROD** — `supabase db push` from a credentialed machine, then run the two `curl` checks above. Owner-side; ~10 min.
2. **#5 test-account quota** (option a OR b) — fastest way back to trustable CI. Currently both Ubuntu + Windows happy-flow-e2e were flaking on HTTP 402 quota exhaustion.
3. **#10 disk-IO investigation** — get the Supabase Query Performance screenshot/data from owner, then act on top finding (likely throttling `pull-handoff` pre-warm).
4. **#6 + #7 merge-gate additions** — 5-minute `package.json` edit that adds real continuous-validation coverage of launched features.
5. **#8 backend deploy workflow** — write the YAML; owner adds the secret.
6. **#9 load test** — write the script; owner runs it.
7. **#2 Cloudflare rate limit** — block on owner's dashboard access; agent can draft the WAF expression text.
8. **#4 backend security review** — multi-hour, do last with focused effort.
