# Known Bugs and Follow-ups

This file is the canonical "what's still broken" list for the project. It's tracked here (rather than as GitHub issues) because the repo lives on two remotes — `tanmain/synapse` (primary, where work happens) and `metanmai/synapse` (where CI runs, kept in sync by a bot) — and a markdown file in the repo gets mirrored automatically. Issues filed on one side wouldn't be visible from the other.

When closing an entry, move it to the `## Closed` section at the bottom with the commit SHA that fixed it. Keep the close note in case the bug returns later — the original symptoms + diagnostic notes are useful for "didn't we see this before?" moments.

---

## P1 — Process gaps

### Configure SYNAPSE_E2E_API_KEY + a provider API key so `happy-flow-e2e` matrix activates

A `happy-flow-e2e` job in `.github/workflows/ci.yml` runs `npm run test:e2e` on **ubuntu-latest + windows-latest** to prove the merge gate's 5 scripts work cross-platform. Same graceful-skip pattern as `migrate` and `e2e` — the job stays GREEN until both secrets land on **metanmai/synapse**, at which point it actually exercises the universal LLM driver + curl-through-proxy + recall paths on each OS.

The driver auto-detects the best available provider based on env vars:
- `ANTHROPIC_API_KEY` → api.anthropic.com (claude-haiku-4-5)
- `OPENROUTER_API_KEY` → openrouter.ai (claude-3.5-haiku or any model)
- `DEEPSEEK_API_KEY` → api.deepseek.com (deepseek-chat, ~100× cheaper)

Only ONE provider key is needed — the driver picks the first available.

**Why it matters:** Without this job actually running, "Linux/Windows compatible" rests on macOS-only validation. The merge-gate scripts now have zero `claude not on PATH → exit 0` soft-skips (refactor in commits `a818b7e` + earlier) — they use curl (universal) and the direct-API LLM driver (universal via whichever API key is configured) — but no CI machine is currently *running* them on Linux or Windows.

**One-time setup steps:**

1. Pick or create a SYNAPSE_E2E_API_KEY value. Two options:
   - **Reuse the maintainer's personal key** (lives in `~/.synapse/config.json` on the dev machine). The merge gate's cleanup phase deletes test projects/conversations created during the run, so dashboard pollution is bounded.
   - **Create a CI-specific Synapse account** (sign up via the website with a CI-only email) and use that key. Cleaner separation but more setup.
2. Pick at least one LLM provider and get its API key:
   - **Anthropic** — https://console.anthropic.com/settings/keys (needs `messages:write`, costs ~$0.01/run)
   - **OpenRouter** — https://openrouter.ai/keys (costs ~$0.001/run with haiku, free-tier models available)
   - **DeepSeek** — https://platform.deepseek.com/api_keys (costs ~$0.0001/run, cheapest option)
3. In https://github.com/metanmai/synapse/settings/secrets/actions, add repository secrets:
   - `SYNAPSE_E2E_API_KEY` → from step 1
   - One of: `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` → from step 2
4. Trigger a re-run of the latest workflow on metanmai (or push any commit). The `happy-flow-e2e` job's "Check secrets are configured" step should flip from "skipped" to "configured=true" and the matrix should actually run.

**Verification after setup:** the `happy-flow-e2e` job's matrix entries on metanmai (ubuntu-latest + windows-latest) both reach the "Run merge gate" step and complete green. Each entry takes ~5-8 minutes (8-min budget per backend-arrival poll). Per-run cost ≈ $0.0002-0.10 total across both matrix entries depending on provider.

**Risk acknowledged:** every push-to-main consumes LLM credits on the metanmai runs. At ~$0.0002-0.10/run × push frequency, this is bounded but non-trivial — if it gets noisy, gate the job with a `paths-ignore:` for docs-only changes.

**Code locations:**
- Job: `.github/workflows/ci.yml` (search for `happy-flow-e2e:` — below `proxy-windows-e2e`)
- Scripts exercised: `scripts/e2e-happy-flow.mjs`, `e2e-adapter-roundtrip.mjs`, `e2e-proxy-layer5.mjs`, `e2e-proxy-source.mjs`, `e2e-proxy-lifecycle.mjs`
- Universal driver: `scripts/e2e-llm-driver.mjs` (auto-detects ANTHROPIC_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY)

---

### Real-tool roundtrip: opencode FIXED; crush + copilot-cli still env-blocked

`scripts/e2e-real-tool-roundtrip.mjs` runs each supported AI harness with fake credentials and asserts Synapse capture fires. **Updated 2026-06-03:** 4 of 6 harnesses now pass: claude-code, codex, gemini, and **opencode** (newly fixed). Two remain env-blocked:

**opencode — FIXED** by two changes: (1) `mcp/src/capture/proxy/session-reconstruction.ts` no longer filters `statusCode 200-299`, so 401 responses from fake-key tests are captured (this was also a real production bug — every failed chat on a flaky network was silently lost); (2) `NO_PROXY=github.com,objects.githubusercontent.com,models.dev` added to opencode's test env, because opencode does a network probe against GitHub on every run for ripgrep cache validation, and that probe hangs through the MITM proxy (Bun's BoringSSL doesn't auto-trust the Synapse CA). UA registered as `opencode` in `user-agent-classify.ts`.

**copilot-cli** — `Error: Access denied by policy settings` from GitHub Copilot. The corporate Copilot policy on this account blocks third-party MCP servers AND non-allowed CLI invocations. Fix requires testing on a GitHub account with personal Copilot subscription (no enterprise policy). **No Synapse-side change can resolve this.**

**crush** — `tls: failed to verify certificate: x509: "api.anthropic.com" certificate is not trusted`. Confirmed via mitmdump probe that crush DOES honor `HTTPS_PROXY` (request reaches the proxy), but brew-built Go binaries on macOS use Apple's `Security.framework` for TLS verification, which consults the **macOS keychain — not env-var CA pools**. So `SSL_CERT_FILE`, `SSL_CERT_DIR`, `GODEBUG=x509usefallbackroots=1` are all ignored. The only sustainable fix is installing the Synapse CA in the user's login keychain (`security add-trusted-cert -k ~/Library/Keychains/login.keychain-db ~/.synapse/proxy/ca.pem`), which on a corp-managed Mac requires an admin password the user does not have. **Environmental on this device; works fine on non-corp Macs and Linux/Windows CI runners with root.**

**Code locations:**
- Test: `scripts/e2e-real-tool-roundtrip.mjs`
- Run only the working subset on this device: `node scripts/e2e-real-tool-roundtrip.mjs --only=claude-code,codex,gemini,opencode`

### Real-tool roundtrip POST_RUN_WAIT_MS is 40s (proxy-tier idle window)

The roundtrip test waits 40s after a tool exits before scanning capture.log. Proxy-tier tools (opencode, crush) go through `ProxySource` which idle-flushes after `DEFAULT_IDLE_MS = 30s` of quiet — so a tool that fired one request and exited has its capture stuck in the buffer for ~30s. The 40s wait = 30s idle + 10s buffer for SSE response assembly and emit latency. Reducing this would require either: (a) shortening `DEFAULT_IDLE_MS` (production-affecting), (b) adding an external flush-now nudge mechanism (new code), or (c) test-only env override. Not worth the cost — 40s is acceptable for an end-to-end test.

---

## P2 — Coverage gaps

### Creem webhook silently dropped renewal events — closed 2026-07-18

**Defensive patch shipped 2026-05-30 in commit `57d475a`** — the switch was extracted into a pure `dispatchCreemWebhookEvent` function with a diagnostic `default:` branch. The proper fix landed 2026-07-18 after comparing production code with Creem's current webhook contract.

The diagnostic branch remains useful: any genuinely new event type now appears in Worker logs instead of returning a silent 200.

Every active `provider='creem'` row in production has `updated_at == created_at`, meaning the row has never been touched since the original `checkout.completed` webhook landed. Confirmed via SQL on 2026-05-23:

| user_id | sub_id | status | created_at | current_period_end | updated_at |
|---|---|---|---|---|---|
| c2e77627… (dogfood) | sub_cxnPAzSODdVKgJh93fQ4Z | active | 2026-03-29 | 2026-04-29 (24d stale) | 2026-03-29 |
| 1a26dee0… (real customer) | sub_5J1fe0K3ILt48oUYOeAmXm | active | 2026-04-01 | 2026-05-01 (22d stale) | 2026-04-01 |
| bd5be0f2… (churned) | sub_3zczzl4C75f3u8rkPZyhLH | inactive | 2026-03-29 | 2026-04-29 | 2026-04-13 |

The churned row (`bd5be0f2`) updated once — almost certainly on the `subscription.canceled` event — proving the webhook endpoint was reachable and the signature check passed. Renewal payloads were the path being lost.

**Root cause:** Creem documents renewals as `subscription.paid`, which the switch already handled. The integration broke one level earlier and one level later: Creem's envelope uses camelCase `eventType`, while the handler read only `event_type`; Creem's subscription object uses `current_period_end_date`, while the handler read only `current_period_end`. Consequently documented renewal payloads dispatched as unknown, and even a directly dispatched `subscription.paid` payload could not advance the stored date.

**User-visible symptom:** the account page showed a renewal date in the past. Plus access remained intact because tier resolution uses status, not `current_period_end`. The UI now labels a past date as "renewal status is updating" instead of presenting it as a future renewal.

**Fix:** the handler now prefers the documented `eventType` and `current_period_end_date` fields while retaining both legacy snake_case fallbacks. A signed, worker-level regression test uses Creem's documented `subscription.paid` renewal shape and asserts the database upsert advances `current_period_end`. Existing stale rows retain Plus access and will refresh on a subsequent paid event; operators may also replay a historical `subscription.paid` delivery from the Creem dashboard.

The diagnostic `default:` remains in place for genuinely new provider event types and still returns 200 to avoid a retry storm.

**Code refs:**
- `backend/src/api/billing.ts` — canonical envelope parsing and subscription lifecycle dispatch
- `backend/test/api/billing-webhook-integration.test.ts` — signed canonical renewal regression test
- `backend/src/db/queries/subscriptions.ts:5` — `getActiveSubscription` filters by status — not affected, but explains why users keep Plus access despite stale period_end
- `frontend/src/lib/components/account/BillingCard.svelte` — renders the stale date directly without checking whether it's in the past

**Adjacent UI fix:** both account billing surfaces now detect a past `current_period_end` and render a neutral status-update message rather than a false future-renewal claim.

---

### 5a. Backend integration tests skip the actual handler logic for events-batch + 6 other endpoints

10+ `.skip`'d tests in `backend/test/api/` are gated on "requires valid auth token + DB". They cover the happy paths for `events-batch`, `events-batch-auto-create`, `project-status`, `project-events`, and `invites` — exactly the endpoints we'd want to regression-test against the actual reducer + DB schema. The active tests only verify auth enforcement (401 without bearer), not the handler logic itself.

**Why it matters:** The Cloudflare 1101 in P0 #1 was never caught by tests precisely because the handler-with-real-DB path is skipped. We have no signal short of production traffic.

**Fix sketch:** Either (a) stand up a test Supabase instance (free tier is enough for CI) and inject creds via repo secrets so the skipped tests run on metanmai CI, or (b) refactor the handler to take db + user as injectable args so we can mock them and test the pure logic.

**Status (2026-05-31):** Path (b) round 2 landed (`<pending>`).

**Done via path (b) pure-helper extraction:**
- `events-batch` (round 1, `7b3e8f3`) — 28 tests covering skew adjustment, cwd-hash regex, id remapping, body validation
- `events-batch-auto-create` (effectively closed by round 1 — its pure logic IS extractCwdHashes + applyIdMapping in `events-batch-pure.ts`)
- `invites` (round 2) — 21 tests covering token generation entropy/charset, body validation (malformed JSON, whitespace email, non-object), expiry boundary semantics, TTL math
- `project-events` (round 2) — 13 tests covering limit clamping (NaN, negative, over-cap, decimals), cursor preservation on empty page

**Path (a) preferred (limited pure-extractable surface):**
- `project-status` — 21-line handler, all DB. The skipped tests assert response shape that's a thin passthrough of `handoff_project_status.status`. No path (b) value.
- `auth-me` — 5-line handler returning `{user_id, email, tier}`. The skipped tests assert the public.users vs auth.users contract — only a live DB can verify the JOIN chain produces the right id.
- `projects-delete` — high-stakes cascade ordering bug class is inherently DB-bound. Pure-extractable surface is the 409 error shape only (low value).
- `projects-merge` — owner-check sequencing + the SQL `merge_projects` RPC are DB-bound. Pure-extractable surface is the self-link guard (one line).

**Pattern for any future round:** extract pure logic into `<endpoint>-pure.ts`, keep DB code in the handler, write `<endpoint>-pure.test.ts` with bug-class tests. The `.skip`'d integration tests stay skipped — they cover schema/RLS/migration drift that needs live Supabase (path (a)).

**Code locations:** `backend/test/api/events-batch.test.ts:44-55`, `backend/test/api/events-batch-auto-create.test.ts:64`, `backend/test/api/project-status.test.ts:27-34`, `backend/test/api/project-events.test.ts:35-44`, `backend/test/api/invites.test.ts:43-51`

---

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

---

## P4 — Performance / correctness, no user impact yet

### 14. Orphan `handoff_sessions` and `handoff_issues` tables in production DB

Migration `015_handoff_layer.sql` created `handoff_sessions` and `handoff_issues` tables. Migration `016_drop_handoff_session_fks.sql` dropped the FK constraints but kept the tables. **No code anywhere in `backend/src` or `packages/shared/src` reads or writes either table.** They sit empty in production, accumulating only an empty schema with RLS overhead.

`016`'s comment notes this: *"The reducer materializes session and actor state purely from events — the tables were redundant in v1's design. v1.1 drops the FKs; the columns remain as loose text references … The tables themselves stay (RLS preserved) in case a future version wants to denormalize for query performance."*

**Decision needed:** Either commit to the denormalization plan and start writing to these tables, or drop them entirely. As-is, they're a constant invitation for someone to query the wrong table and get nothing back.

---

## Closed

### Background recompute could lose completed handoff on one upload blip — closed 2026-07-18

The detached `pull-handoff` process could spend 30–60 seconds generating a local handoff and then make exactly one precomputed `POST /api/conversations/:id/compact`. A network exception or transient 408, 429, or 5xx response discarded that completed work; the next session received the stale cached handoff and had to recompute again.

The computation and upload failure boundaries are now separate. Local compaction runs once, while only its precomputed upload receives three bounded attempts (250 ms and 1 s backoff). Permanent 4xx responses fail immediately, and exhausted retries return the cached handoff without falling through to a second hosted LLM call. Unit coverage pins transient recovery, permanent-error fail-fast behavior, retry exhaustion, and the single-compaction invariant.

### Projects could commit without their owner membership — closed 2026-07-18

Project creation used two independent database writes: insert `projects`, then insert the owner's `project_members` row. A failure between them left an invisible orphan project. The production audit found four such rows; all were generated `E2E-Quota-*` / `multi-account-*` artifacts, so the exact projects and their cascaded synthetic rows were deleted. The post-cleanup invariant returned zero projects whose `owner_id` lacked an owner membership.

Migration `20260718160229_ensure_project_owner_membership.sql` adds an `AFTER INSERT` trigger so the owner membership is created in the same database transaction. Both application creation paths now follow with an idempotent membership upsert, preserving compatibility before and after the migration during a rolling deploy. A production-schema transaction dry run created a project, asserted its owner membership, and rolled back successfully.

### Supabase pgvector extension exposed through `public` — closed 2026-07-18

Supabase's security advisor warned that pgvector was installed in the API-facing `public` schema. A direct schema move was not safe: the vector `<=>` operator moves with the extension, while `match_conversations` and `find_merge_candidates` had hardened `search_path = pg_catalog, public` settings. A transaction-only dry run caught the resulting `operator does not exist` failure and rolled back before production changed.

Migration `20260718154701_move_vector_extension.sql` atomically moved pgvector to `extensions`, qualified the vector operator and HNSW operator class, recreated the conversation RPCs, and restricted all vector RPCs to `service_role`. The audit also found migration-ledger drift from `005_pgvector.sql`: production lacked `entries.embedding`, `entries_embedding_idx`, and `match_entries` even though migration 005 was recorded. The same forward migration restored those objects. Live zero-vector smoke calls passed for `match_entries`, `match_conversations`, and `find_merge_candidates`; the advisor's `extension_in_public` warning disappeared.

The only remaining Supabase advisor warning is leaked-password protection. Enabling `password_hibp_enabled` returned HTTP 402 because this project is on Supabase Free; the feature requires a paid plan. No Auth settings were changed.

### Configure Supabase secrets so CI auto-migrate activates — closed 2026-07-18

Phase 2 added a `migrate` job to `.github/workflows/ci.yml` that runs `supabase db push` on every push to `main`. This process gap is closed: GitHub `prod` now contains all three required secret names—`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD`. Secret names and presence were verified; no secret value was inspected or recorded.

**Why it mattered:** This was the same class of problem as P0 BUG-01: schema drift between repository migrations and production could go undetected while migrations required a manual push. The 2026-07-17 production close-out applied migration 031 and `20260717170215_harden_public_schema_rls.sql` directly, with reproducible SQL committed in `454af70e`; post-apply checks returned zero Supabase advisor errors.

> **⚠️ Near-miss fixed 2026-06-21 (`260621-hsl`):** when `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` were first added (DB password still blank), this job activated and ran `supabase db push **--include-all**`, which forced the out-of-sequence `000_rollback_all.sql` (a DROP-everything teardown) into a **prod** push. It only aborted on a non-CASCADE `DROP FUNCTION update_updated_at()` hitting migration 023's trigger — prod was saved by luck. Fix: (1) the `000_*` maintenance scripts moved to `supabase/maintenance/` (outside the `db push` path); (2) `--include-all` was removed (forward-only); (3) the skip guard now requires all THREE secrets so a partial configuration skips instead of firing. With all three names configured, the job can apply only migrations newer than the remote watermark; teardown scripts are outside the automatic path.

**Close evidence:** GitHub Actions run `29649638136` attempt 2 reached `supabase db push`, reconciled the stale remote-only `000 delete_user` ledger entry, applied `031_api_key_scope.sql` and `20260717170215_harden_public_schema_rls.sql`, and concluded successfully. This is the first run that proves the configured `SUPABASE_DB_PASSWORD` is consumed by the production migration workflow.

**Risk retained:** Every push to `main` can apply forward migrations to production. A destructive forward migration still requires careful review. The recurrence-level CI lint that rejects new tables without RLS remains deferred.

**Code location:** `.github/workflows/ci.yml` (`migrate:` job between `verify:` and `e2e:`).

Fixed in the 2026-05-18 session:

- **CLI didn't pass `device_name` through OAuth-style auth URL** — fixed in `34de058`
- **Wizard's "Start capturing" prompt didn't actually install Claude Code hooks** — fixed in `d3cd771`
- **Launchd plist argv mangled** (single string `"node /path/to/commands.js"` instead of separate `<string>` elements) — fixed in `d3cd771`
- **Service file written but never `launchctl load`ed** — fixed in `d3cd771`
- **Service file pointed at `dist/cli/commands.js`** (a helper module with no main) **instead of `dist/index.js`** (the dispatcher entry) — fixed in `025a814`

Fixed in the 2026-05-30 session (post-Windows-readiness backlog sweep):

- **#11 `recomputeProjectStatus` reads all events per batch** — refactored to an incremental fast path. Added `applyEvents(currentStatus, newEvents, opts) → ProjectStatus | null` in `packages/shared/src/handoff/reducer.ts` (returns `null` on out-of-order arrival or `IssueStateChanged` on a non-open issue not also created in same batch — signals caller to fall back to full reduce). Extended `ProjectStatus` with optional `_meta.last_full_recompute_at` JSONB bookkeeping (no schema migration needed). Backend wrapper (`backend/src/lib/handoff-reducer.ts`) tries the incremental path when the last full recompute was within 5 min and a watermark exists; otherwise re-folds from DB truth. Caller signature unchanged. Property-style equivalence test pins the bug class — `reduce(allEvents)` deep-equals `applyEvents(reduce(events[0..K]), events[K..])` across every split point. Commit `<pending>`.

- **#5 409 `DEVICE_LIMIT_REACHED` has no UI in frontend** — added `POST /auth/cli-revoke-and-session` backend endpoint + `revokeAndContinue` frontend action + picker UI in `cli-auth/+page.svelte`. Free-tier users hitting the 3-device cap now see a list of their devices (with last-used relative time) and can revoke one to make room for the new sign-in. Commit `89e2a69`.
- **#6 Dashboard rename UI for `cli-*` keys not built** — Added `PATCH /api/account/keys/:id` backend endpoint with pure `computeRenamedLabel` helper that preserves the `cli-` prefix invariant, plus inline-edit UI in `ApiKeysCard.svelte` (Rename button next to Revoke). Works for ALL keys, not just cli-prefixed ones. Commit `76aa43f`.
- **#7 Legacy `cli`-labeled keys never migrated** — `supabase/migrations/026_rename_legacy_cli_keys.sql` renames bare `cli` labels to `cli-legacy-YYYY-MM-DD` (date from created_at). Only touches labels equal to exactly `cli` — ad-hoc names like "M4 Pro" are left alone since they're indistinguishable from intentional non-CLI keys. The new shape still matches countCliKeys/listCliKeys' `LIKE 'cli-%'` filter (device-cap accounting unchanged) and is renameable via the dashboard inline-edit shipped in #6. Migration is idempotent + atomic single UPDATE. Will auto-apply on metanmai/synapse via the `migrate` CI job once the SUPABASE_* secrets are configured (P1 above) — until then, requires manual `supabase db push` from a CF-enabled machine.
- **#13 Frontend svelte-check warnings (4 a11y + 8 unused-CSS)** — unused-CSS already cleared in an earlier commit; the 4 a11y warnings (AppShell switcher-wrapper div, two `autofocus` inputs) fixed with role="presentation" + svelte-ignore directives that document the intent inline. svelte-check now reports 0 warnings.

Fixed in the 2026-05-19 to 2026-05-20 sessions (Phase 1, slice 1a-prime + 1b):

- **#1 `/api/events/batch` Cloudflare 1101** — fixed on two layers: functional (re-applied migrations 015/016/017 to restore the missing `handoff_events` table on prod Supabase — the actual root cause, *not* the Promise.all hypothesis from research D1) + defensive (`Promise.allSettled` swap in `backend/src/api/events-batch.ts:147` to isolate per-project recompute failures from now on) — `16a4de1` + `2eb158b`
- **#2 `synapse capture status` reports "stopped" under launchd** — fixed by `checkSupervisor()` platform dispatch in `mcp/src/cli/util/daemon-supervisor.ts` — `17be259`
- **#3 Wizard writes `npx synapsesync` configs blocked by Netskope** — fixed by three-tier MCP command resolver (`which synapsesync` → `node <abs-path>/dist/index.js` → `npx`) in `mcp/src/cli/util/mcp-command.ts` — `1f11b55`
- **#4 `synapse init` doesn't write `.mcp.json` for current project** — fixed by adding `editorIo.writeMcpJson(cwd, ...)` + `ensureGitignore` to the init flow — `768b139`
- **#12 Daemon flush has no retry/backoff** — fixed by `computeNextDelay` pure helper + setTimeout-chain replacing the unconditional 10s interval; jittered exponential 10s → cap 5min — `17be259`
