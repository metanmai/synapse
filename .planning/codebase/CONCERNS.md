# Codebase Concerns

**Analysis Date:** 2026-05-15

This document catalogs technical debt, latent bugs, security gaps, performance bottlenecks, and fragile areas as of the v1.1 handoff-layer merge. Each item is severity-labeled. Verified file paths are included so the planner can navigate directly to remediation sites.

A prior dead-code audit (`.planning/dead-code-scan-2026-05-14.md`) is the parent reference for items 1, 2, 12, 13 and 14 below — many of its findings have since been resolved by v1.1 follow-up commits (e.g. `daemon` is now wired in `HANDLERS`, the FK on `handoff_events.session_id` was dropped in migration 016, etc.). The list below reflects current state.

## Tech Debt

### Orphan module: `mcp/src/cli/resolve-project.ts` — Low / Tracked

- **Issue:** `resolveProject`, `ResolvedProject`, and `BackendResolveResponse` in `mcp/src/cli/resolve-project.ts` are imported only by `mcp/test/unit/resolve-project.test.ts`. No production caller exists. The runtime resolution path (`resolveProjectFromCwd` in `mcp/src/cli/handlers.ts:77`) uses a different algorithm (local map → `cwd_<hash>` placeholder → backend auto-create), making this module's three-tier resolver dead.
- **Files:** `mcp/src/cli/resolve-project.ts:1-63`, `mcp/test/unit/resolve-project.test.ts`
- **Impact:** ~63 lines of unused production code + test file. Confuses future maintainers about which resolver is canonical.
- **Fix approach:** Delete the file and its test. Deferred from v1.1 cleanup (see `dead-code-scan-2026-05-14.md` §3) because the test still passes and removal is not blocking.

### Asymmetric test coupling: `writeDaemonCcProfile` — Low / Tracked

- **Issue:** `writeDaemonCcProfile` is exported from `mcp/src/capture/daemon-cc.ts:6` but the only production caller (`spawnInferNextStep`, same file line 31) invokes it internally. The `export` keyword is held alive only by `mcp/test/capture/sandbox.test.ts:3` and `mcp/test/capture/daemon-cc.test.ts:3`. If those tests are deleted, the export becomes dead.
- **Files:** `mcp/src/capture/daemon-cc.ts:6`, `mcp/test/capture/sandbox.test.ts`, `mcp/test/capture/daemon-cc.test.ts`
- **Impact:** Cosmetic — pollutes the module's public surface. No runtime cost.
- **Fix approach:** Drop the `export` keyword and have the two tests test through `spawnInferNextStep` instead (or accept a `_writeProfile` injectable). A v2.0 cleanup target.

### Dead LLM inference path: `maybeFireInferNextStep` never called — High

- **Issue:** `maybeFireInferNextStep` (`mcp/src/capture/daemon.ts:83`) is the entry point for daemon-side LLM next-step inference. It reads recent events, calls `spawnInferNextStep` (which shells out to `claude -p ...`), and appends a `NextStepInferred` event. **Nothing in production calls it.** `startHandoffLoop` (`mcp/src/capture/daemon.ts:131`) only runs `runFlushCycle`/`runPullCycle`/`writeBrief` on its interval; `runDaemon` (`mcp/src/cli/run-daemon.ts:27`) wires `startHandoffLoop` directly. The only callers are `mcp/test/capture/daemon-cc.test.ts` and the daemon test (test/capture/daemon.test.ts via injection).
- **Files:** `mcp/src/capture/daemon.ts:83-129`, `mcp/src/capture/daemon.ts:131-179` (the loop that omits the call), `mcp/src/capture/heuristic-synth.ts` (dead transitively)
- **Impact:** Marketed v1.1 behavior ("LLM-inferred next steps when a session goes idle") never fires in production. The heuristic fallback (`synthesizeHeuristicNextStep`) is also dead at runtime because its only caller is the dead path. Users get briefs without inferred next-step content unless someone explicitly runs `synapse handoff "..."`.
- **Fix approach:** Add an idle-detection timer inside `startHandoffLoop` that calls `maybeFireInferNextStep` per project. Decide `idle_threshold_ms` (the function expects it but no caller sets it). Smoke-test with a real `claude` binary in the spawn path.

### Deprecated MCP server tools still shipped — Tracked / Low

- **Issue:** `mcp/src/index.ts:267` carries the comment `// DEPRECATED: legacy MCP surface. Prefer REST API or handoff CLI. Removal target: v2.0` above the registration of `save_insight` and `list_insights`. These tools remain functional and connect to `/api/insights` over HTTP, so MCP hosts (Cursor, Windsurf, VS Code MCP) still see them.
- **Files:** `mcp/src/index.ts:267-388`
- **Impact:** Two parallel write paths (MCP tool + REST API) for insights. Until removal, both must be maintained in lockstep — schema changes to insights must update both call sites.
- **Fix approach:** Confirmed deprecation comment is in place. Wait for v2.0 to delete. Document in CHANGELOG so MCP-host integrations get a runway.

### Hardcoded production URLs across MCP, backend, and frontend — Medium

- **Issue:** `https://api.synapsesync.app` and `https://synapsesync.app` are hardcoded in source rather than env-driven. Most places have a fallback to env (e.g., `envOr(c.env, "APP_URL", "https://synapsesync.app")`), but several do not:
  - `mcp/src/cli/config.ts:1-2` — `API_URL` and `APP_URL` constants (no env override)
  - `mcp/src/cli/run-daemon.ts:20` — duplicates `const API_URL = "https://api.synapsesync.app"` inside the daemon entry, ignoring `mcp/src/cli/config.ts` and with no env fallback
  - `backend/src/api/invites.ts:21` — `const JOIN_URL_BASE = "https://synapsesync.app/invite"` with no env override
  - `backend/src/index.ts:35` — CORS allow-list includes `https://synapse-7mq.pages.dev` (preview deploy URL) baked into source
- **Files:** `mcp/src/cli/config.ts`, `mcp/src/cli/run-daemon.ts:20`, `backend/src/api/invites.ts:21`, `backend/src/index.ts:35`
- **Impact:** Cannot point the CLI/daemon at a staging API without rebuilding. Breaks any contributor who needs to test against a self-hosted backend.
- **Fix approach:** Promote all production URLs to env vars (`SYNAPSE_API_URL`, `SYNAPSE_APP_URL`, `SYNAPSE_INVITE_BASE`). Have `mcp/src/cli/run-daemon.ts:20` read from the existing `API_URL` export instead of re-declaring it.

### Frontend env handling: runtime over build-time guarantees — Tracked / Medium

- **Issue:** v1.1 switched the SvelteKit server-side modules to `$env/dynamic/private` (runtime resolution) instead of `$env/static/private` (build-time replacement). All three consumers are documented: `frontend/src/lib/server/api.ts:1`, `frontend/src/lib/server/auth.ts:1`, `frontend/src/routes/cli-auth/+page.server.ts:1`.
- **Files:** `frontend/src/lib/server/api.ts:1-3` (`const API_URL = env.API_URL;` then a null check at line 15)
- **Trade-off (explicit design choice):**
  - **Pro:** Single build deploys to multiple environments (staging + prod) without rebuild. Env can be changed without redeploying.
  - **Con:** A missing `API_URL` is caught at first request (returns 500) rather than at build time. There is no preflight validation in `hooks.server.ts` or `vite.config.ts`.
  - **Con:** SvelteKit cannot inline the value for tree-shaking — minor bundle/perf cost on the server side only (no client impact).
- **Impact:** Acceptable. Documented here so future readers don't try to "fix" it back to static imports without context.
- **Fix approach:** No action. Optionally, add a startup validator in `frontend/src/hooks.server.ts` that errors loudly if `API_URL` is unset, converting the failure mode from "500 on first request" to "boot crash."

### One residual `as any` cast (intentional thenable mock) — Low / Tracked

- **Issue:** `biome check` across the repo reports exactly two warnings, both for the same line (the second is `.claude/worktrees/...` reflection of the same file). The cast lives in a test mock that builds a Supabase chainable thenable.
- **Files:** `backend/test/db/queries.test.ts:73` — `chains.push(chainable as any);`
- **Impact:** The mock builder needs `chainable` to look like multiple incompatible types at once (`PostgrestFilterBuilder` + thenable + `vi.fn()`). A precise type union would be 30+ lines of generics. The biome warning is the cheaper cost.
- **Fix approach:** Either suppress with `// biome-ignore lint/suspicious/noExplicitAny: chainable mock` or model the mock with a `Pick<...>` union. Low priority — it's test-only and stable.

### Stale CLI help text — Medium

- **Issue:** `mcp/src/index.ts:66-110` (`printHelp`) does not list the v1.1 handoff subcommands. The help table groups subcommands into Setup / Orient / Capture / Workspace / Account but omits `handoff`, `set-focus`, `note`, `issue`, `invite`, `init`, `doctor`, and `daemon` — all of which are wired in `mcp/src/cli/handlers.ts:129-214`.
- **Files:** `mcp/src/index.ts:66-110`, `mcp/src/cli/handlers.ts:129-214`
- **Impact:** Users running `synapse --help` won't discover the v1.1 features. Forces them to read README or `commands/synapse/*.md` slash-command definitions.
- **Fix approach:** Add a "Handoff" section to the help printer that mirrors the HANDLERS map. Consider generating the help text from the map directly to prevent future drift.

### Two parallel daemon families share a directory — Medium

- **Issue:** `mcp/src/capture/` houses two unrelated daemons:
  - **Old (conversation capture):** `capture-worker.ts`, `cloud-sync.ts`, `store.ts`, `watcher.ts`, `safe-read.ts`, `adapters/*.ts` — file-watches editor session files, POSTs to `/api/conversations`. Launched by `synapse capture start` (`mcp/src/capture/cli.ts:42`).
  - **New (handoff events):** `daemon.ts`, `daemon-cc.ts`, `handoff-sync.ts`, `events-log.ts`, `handoff-paths.ts`, `handoff-brief.ts`, `actor.ts`, `heuristic-synth.ts` — appends to `events.jsonl`, POSTs to `/api/events/batch`. Launched by `synapse daemon` (the OS service entry).
  - They share zero state, write to different cache locations, but coexist in the same source folder.
- **Files:** `mcp/src/capture/` (the whole directory)
- **Impact:** First-time readers cannot tell which is current. The fact that `synapse capture start` and `synapse daemon` are both launchable produces confusing user-facing behavior: two daemons can run simultaneously.
- **Fix approach:** Move the new daemon to its own directory (e.g. `mcp/src/handoff/`) and keep `mcp/src/capture/` for the legacy conversation capture only — OR retire the old capture entirely (~1500 lines of cleanup) if conversations-via-capture is superseded.

## Known Bugs

### Invite acceptance does not verify email match — High (Security)

- **Symptoms:** Any authenticated user who knows or guesses a 32-char base64url invite token can accept it, regardless of the email the invite was issued to.
- **Files:** `backend/src/api/invites.ts:75-104`
- **Trigger:** Attacker obtains the join URL via any leak (shoulder-surfing, browser history, accidental copy-paste). The endpoint at line 75 only checks `invite.accepted_at` and `invite.expires_at`. It never compares `user.email` to `invite.email`.
- **Workaround:** Tokens are 192 bits of randomness via `crypto.getRandomValues`, which makes guessing infeasible. The real risk is link leakage. Until the email check lands, treat invite URLs as bearer credentials.
- **Fix approach:** After fetching the invite at `invites.ts:80`, add `if (row.email.toLowerCase() !== user.email.toLowerCase()) return c.json({ error: "invite is not for this account" }, 403);` before the membership insert.

### Frontend env race on first request — Medium

- **Symptoms:** If `frontend` is deployed without `API_URL` set, every request fails with HTTP 500 "API_URL is not configured. Set it in your environment variables." There is no boot-time check.
- **Files:** `frontend/src/lib/server/api.ts:14-17`
- **Trigger:** Mis-deploy where the env var fails to propagate (Cloudflare Pages or Vercel config drift).
- **Workaround:** Manually validate the env var via the dashboard before deploys.
- **Fix approach:** Add an `assert(env.API_URL, "API_URL must be set")` in `frontend/src/hooks.server.ts` so the worker crashes at boot.

### `runFlushCycle` swallows body-parse errors silently — Medium

- **Symptoms:** When the backend response body is malformed JSON, `runFlushCycle` (`mcp/src/capture/handoff-sync.ts:45-64`) writes the watermark anyway, marking events as flushed even though the daemon never confirmed acceptance.
- **Files:** `mcp/src/capture/handoff-sync.ts:58-64`
- **Trigger:** Hypothetical — backend bug that returns non-JSON 200. Unlikely in production but a recurring issue in CI when the backend container is misconfigured.
- **Workaround:** None. Watermark advances and events are lost from the daemon's perspective.
- **Fix approach:** Only advance the watermark when `body.canonical_project_ids` is parseable. Re-throw on non-JSON-on-2xx — the daemon's outer `try/catch` will log and retry on the next cycle.

### Brief renderer trusts `ProjectStatus.active_actors[0]` ordering — Low

- **Symptoms:** `renderBriefFromCache` (`mcp/src/capture/handoff-brief.ts:32`) treats `active_actors[0]` as "most recent." If the reducer's sort changes, the brief will silently mis-attribute activity.
- **Files:** `mcp/src/capture/handoff-brief.ts:32`, `packages/shared/src/handoff/reducer.ts` (the sort guarantee)
- **Trigger:** Reducer refactor without coordinated update to the brief renderer.
- **Workaround:** None.
- **Fix approach:** Have the reducer expose `most_recent_actor` explicitly rather than the brief consumer asserting array ordering, OR add a `// reducer guarantees actors[0] is most-recent` comment that's tested in `mcp/test/capture/handoff-brief.test.ts`.

## Security Considerations

### Backend uses Supabase service-role key — bypasses RLS — High (Architectural)

- **Risk:** Every API endpoint runs as service-role (`backend/src/db/client.ts:5`), so RLS policies on tables like `projects`, `handoff_events`, `handoff_project_status`, `entries` are advisory. Authorization MUST be enforced in application code on every endpoint.
- **Files:** `backend/src/db/client.ts:1-9`
- **Current mitigation:** The middleware/helpers `resolveProject`, `resolveProjectEditor`, `resolveProjectOwner`, `requireRole` (`backend/src/middleware/project-auth.ts`) wrap the membership check pattern. Most write endpoints invoke them.
- **Recommendations:** Audit every Hono route in `backend/src/api/` for either:
  1. A call to `requireRole`/`resolveProject*` before any DB write tied to a project_id, OR
  2. A query that scopes by `user.id` in the WHERE clause.
  This audit has gaps — see the three high-severity items below.

### `/api/events/batch` writes events without project membership check — Critical

- **Risk:** Any authenticated user can write `handoff_events` rows to **any project** they know the UUID of. The endpoint at `backend/src/api/events-batch.ts:37` takes `body.events[].project_id` at face value and only verifies the auth token (line 10, `authMiddleware`).
- **Files:** `backend/src/api/events-batch.ts:37-140`
- **Current mitigation:** None. The cwd-hash auto-create path (line 78-121) correctly creates a project for the caller, but the non-hash code path (line 123-126) directly upserts events for any `project_id` string.
- **Recommendations:** Before the upsert at line 123, compute the unique non-hash `project_id` set and run a single `db.from("project_members").select("project_id").eq("user_id", user.id).in("project_id", nonHashIds)` then drop any row whose project the caller doesn't belong to. Return `403` if all rows are dropped.

### `/api/projects/:id/status` returns status without membership check — High

- **Risk:** Any authenticated user can read `handoff_project_status.status` for **any project ID** they guess or scrape. Project IDs are UUIDs (low practical guess rate) but enumeration via `/api/projects/list` is not prevented.
- **Files:** `backend/src/api/project-status.ts:8-19`
- **Current mitigation:** None — the handler at line 11 selects on `project_id` with no membership filter.
- **Recommendations:** Call `requireRole(db, project_id, user.id)` (`backend/src/middleware/project-auth.ts:67`) before the select.

### `/api/projects/:id/events` returns events without membership check — High

- **Risk:** Same as project-status — `backend/src/api/project-events.ts:8-24` reads `handoff_events` filtered by `project_id` with no authz check beyond `authMiddleware`. An attacker with a valid API key for any account can paginate through another tenant's event log.
- **Files:** `backend/src/api/project-events.ts:8-24`
- **Current mitigation:** None.
- **Recommendations:** Add `await requireRole(db, project_id, user.id);` before the query at line 13.

### Embedding service: optional API key check — Medium

- **Risk:** `embedding-service/app.py:18` only enforces the bearer token if `EMBED_API_KEY` is set as a non-empty env var (`if API_KEY and credentials.credentials != API_KEY`). If the env var is missing or empty, the service accepts any request.
- **Files:** `embedding-service/app.py:12-19`
- **Current mitigation:** Production deploys set `EMBED_API_KEY`. The service is not internet-facing (called from Cloudflare Workers IP range), but Docker/k8s misconfig could expose it.
- **Recommendations:** Reject startup when `EMBED_API_KEY == ""`, OR explicitly accept `if not API_KEY: raise HTTPException(503, "auth disabled")` so silent misconfig fails loudly.

### Daemon writes claude profile world-readable — Low

- **Risk:** `writeDaemonCcProfile` (`mcp/src/capture/daemon-cc.ts:6-18`) writes `~/.synapse/daemon-cc-profile.json` with default umask (0644 on most Unix-likes). The file contains tool-permission allowlist for the spawned `claude` invocation, no secrets.
- **Files:** `mcp/src/capture/daemon-cc.ts:6-18`
- **Current mitigation:** Content is not sensitive. The file is in `$HOME/.synapse/` which usually has 0755 perms.
- **Recommendations:** Use `{ mode: 0o600 }` on `fs.writeFileSync` as defense-in-depth. Other files in `~/.synapse/` (notably `config.json` containing the API key) should get the same treatment — `mcp/src/cli/init.ts:131` writes `config.json` with default umask, leaking API keys to any other process running as the user.

### API keys persisted to disk in plaintext — Tracked / Medium

- **Risk:** `~/.synapse/config.json` (`mcp/src/cli/init.ts:125-132`) and the MCP config files (`.cursor/mcp.json`, `~/.claude.json`, etc., written by `mcp/src/cli/editors/io.ts`) store the user's Synapse API key in plaintext on the local filesystem. There is no OS-keychain integration.
- **Files:** `mcp/src/cli/init.ts:125-132`, `mcp/src/cli/editors/io.ts`
- **Current mitigation:** File perms inherit user umask. Standard for CLI tools (npm, pip, gh, etc.) but worth documenting.
- **Recommendations:** Set `mode: 0o600` on `fs.writeFileSync` for `config.json`. Long-term, integrate with `keytar`/macOS Keychain/Windows Credential Manager.

## Performance Bottlenecks

### `recomputeProjectStatus` runs full table scan on every batch — High

- **Problem:** `recomputeProjectStatus` (`backend/src/lib/handoff-reducer.ts:5-19`) re-reads **every** event for the project, calls `reduce()` on the full history, and upserts the result. Called once per affected project on every `/api/events/batch` POST (`backend/src/api/events-batch.ts:132`). For a project with 100k events that's 100k rows per flush cycle.
- **Files:** `backend/src/lib/handoff-reducer.ts:5-19`, `backend/src/api/events-batch.ts:132`
- **Cause:** No incremental state — the reducer is a pure fold over the event list. Cost grows linearly with event history.
- **Improvement path:**
  1. Short-term: store the reduced state plus a `last_reduced_event_id` watermark, and on the next batch read only events `>` the watermark. Apply them to the stored state.
  2. Long-term: persist a materialized view via Postgres trigger that updates `handoff_project_status` on every `handoff_events` insert.

### `runFlushCycle` reads entire events.jsonl on every cycle — Medium

- **Problem:** `readEvents` (`mcp/src/capture/events-log.ts:39-47`) loads the whole `events.jsonl` file into memory and `.split("\n")`. Called every flush cycle (every 10s by default). On a long-lived daemon project with 10k+ events the daemon re-reads megabytes per cycle.
- **Files:** `mcp/src/capture/events-log.ts:39-47`, `mcp/src/capture/handoff-sync.ts:33`
- **Cause:** No streaming/tail reader. No rotation/compaction of `events.jsonl`.
- **Improvement path:**
  1. Track byte offset of last-read position; `read` from offset on subsequent cycles.
  2. Rotate `events.jsonl` after N events / M bytes — daemon already maintains a watermark in `.watermark`, the file beyond which can be archived or truncated post-flush.

### `Promise.all(recomputeProjectStatus)` on multi-project batches — Medium

- **Problem:** `backend/src/api/events-batch.ts:132` fires `recomputeProjectStatus` concurrently for every distinct project in the batch. Each one does a separate full scan + reduce + upsert. Cloudflare Workers have a 50 subrequest limit per request — a batch touching 25+ projects would hit it.
- **Files:** `backend/src/api/events-batch.ts:131-132`
- **Cause:** No batching of reduce/upsert; no limit on distinct project_ids per batch.
- **Improvement path:** Cap `projectIds.length` per request (reject with 400 if > 20) or move recompute to a Durable Object queue so the request returns immediately.

### Synchronous file IO in hot daemon paths — Low

- **Problem:** `appendEvent` (`mcp/src/capture/events-log.ts:26-37`) uses `fs.openSync`/`writeSync`/`closeSync`. The daemon is single-threaded JS so any FS lag blocks the event loop. Each event = one open/close. Hook handlers (which write events from inside the user's editor process, see `mcp/src/cli/hook-dispatch.ts`) take the same hit.
- **Files:** `mcp/src/capture/events-log.ts:26-37`
- **Cause:** Conservative correctness — fsync semantics are easier with `*Sync`. Async would batch better.
- **Improvement path:** Migrate to a write queue with `fs.promises.appendFile`. Probably premature — at expected event rates (<100 events/s) the sync path is fine.

## Fragile Areas

### `mcp/src/capture/heuristic-synth.ts`: hand-rolled fallback prose — Tracked

- **Files:** `mcp/src/capture/heuristic-synth.ts`
- **Why fragile:** When the LLM inference path fails, `synthesizeHeuristicNextStep` composes the brief from event-kind heuristics: "Continue working on X", "Pick up subtask Y", "Last commit: Z". Quality is materially lower than LLM output. Worse, the function is reached only via the dead `maybeFireInferNextStep` path (see Tech Debt §3 above), so the fallback has near-zero production exposure today.
- **Safe modification:** Once `maybeFireInferNextStep` is wired into `startHandoffLoop`, expect heuristic output to surface for users without Claude Code installed. Tests in `mcp/test/capture/heuristic-synth.test.ts` cover the obvious cases — extend before changing the prose template.
- **Test coverage:** Decent for the function itself; zero for the integration path.

### Watcher test fragility — Tracked / Low (NOT a v1.1 regression)

- **Files:** `mcp/test/unit/capture/watcher.test.ts`
- **Why fragile:** Relies on chokidar's filesystem-event timing. The test at line 45 polls for up to 8s and has a 15s vitest timeout (`}, 15000)` on line 65). Lines 80-99 (dedup tests) sleep 3s and check counts. CI runners with slow IO can still time out.
- **Safe modification:** Don't drop the explicit `15000` timeouts. Consider mocking chokidar entirely for unit-level coverage and moving filesystem-event scenarios to `test/e2e/`.
- **Test coverage:** Adequate; flake is process-level, not assertion-level.

### Hook dispatcher: untyped payload casting — Medium

- **Files:** `mcp/src/cli/hook-dispatch.ts:11-12`, lines 18-36
- **Why fragile:** The dispatcher casts the parsed JSON payload to `Record<string, any>` (biome-ignored at line 11) and then `as Parameters<typeof runX>[0]` for each handler. There is no runtime validation that Claude Code's hook payload actually has the expected fields (`session_id`, `cwd`, `tool_name`, etc.). If Claude Code changes the hook schema, the handlers silently receive `undefined` for now-missing fields.
- **Safe modification:** Add Zod schemas per hook kind and validate in `readHookPayloadFromStdin` (`mcp/src/cli/hook-dispatch.ts:48`) before dispatch. Failures should log to stderr and exit 0 (the file already comments "Hooks must never break Claude Code" at `mcp/src/cli/commands.ts:186`).
- **Test coverage:** Per-hook unit tests exist (`mcp/test/hooks/*.test.ts`) but they construct already-shaped payloads — no shape-mismatch coverage.

### Brief renderer fails open when cache is missing — Low

- **Files:** `mcp/src/capture/handoff-brief.ts:9-15`
- **Why fragile:** If `statusCachePath(project_id)` doesn't exist (first-run, daemon not yet synced), the brief just says "(no cached context yet — daemon will populate on next sync)". A user with a flaky daemon (TCC permission revoked, see Scaling Limits below) will see this string forever and may not realize the daemon is broken.
- **Safe modification:** Have the brief include a hint to run `synapse doctor` when the cache is stale (mtime > N minutes old).
- **Test coverage:** Covered for the happy path; no test for stale-cache scenario.

### `os-service.ts` writes service files unconditionally — Medium

- **Files:** `mcp/src/capture/os-service.ts:46-66`, `mcp/src/cli/init.ts:34-37`
- **Why fragile:** `writeServiceFile` (line 46) overwrites the launchd plist / systemd unit on every `synapse init` invocation. Users who customize the unit (e.g., change `KeepAlive`, add `nice` priorities) lose their edits silently. There is no merge step.
- **Safe modification:** Check `fs.existsSync(p)` first; if present, compare content and ask the user before overwrite, OR skip the write and log "Existing service file kept — delete it manually to regenerate."
- **Test coverage:** `mcp/test/capture/os-service.test.ts` exists but doesn't cover the overwrite scenario.

## Platform Gaps

### No Windows OS service installer — Tracked / Medium

- **Problem:** `mcp/src/capture/os-service.ts:46-66` handles `darwin` (launchd) and `linux` (systemd user units), and throws on any other platform with the message *"Unsupported platform: <plat>. Run `synapse daemon` manually until Windows service support lands."*
- **Files:** `mcp/src/capture/os-service.ts:63-65`
- **Impact:** Windows users can install the MCP CLI globally and run `synapse daemon` in a terminal, but they don't get a persistent background daemon. The handoff brief at SessionStart will be stale on every cold start because no daemon is around to flush/pull.
- **Out of v1.1 scope.** Future fix path: NSSM service script or Task Scheduler `schtasks` integration.

### macOS TCC sensitivity for `~/Documents/synapse/` — Tracked / Medium

- **Problem:** The Synapse repo and `~/.synapse/` directories sit under macOS TCC (Transparency, Consent, Control) protection when located inside `~/Documents/`. Long-running Claude Code sessions can lose filesystem access mid-session if TCC revokes the grant (e.g., on macOS updates or sandbox-policy changes).
- **Files:** Affects everything that reads from `~/.synapse/projects/` or the project source — `mcp/src/capture/events-log.ts`, `mcp/src/capture/handoff-sync.ts`, `mcp/src/cli/init.ts`.
- **Impact:** Daemon silently fails to read events.jsonl; daemon logs show EACCES errors; brief stays stale. Recovery requires manual re-grant in System Settings → Privacy & Security → Files and Folders, plus a Claude Code restart.
- **Workaround:** Document in user-facing FAQ. Optionally move tracked projects to a path outside `~/Documents/` (e.g., `~/Projects/`) which avoids TCC.

## Scaling Limits

### Cloudflare Workers subrequest limit on event batches — Medium

- **Resource/System:** Workers free + paid tiers cap subrequests per invocation. Service-bindings + Supabase REST roundtrips count.
- **Current capacity:** Each `/api/events/batch` does:
  1. 1 select on `project_members` (auto-create branch only)
  2. Up to N selects on `projects` (one per cwd-hash needing match — N typically 0-3)
  3. Up to N inserts on `projects` + N inserts on `project_members` (auto-create)
  4. 1 upsert on `handoff_events`
  5. N calls to `recomputeProjectStatus` — each does 1 select + 1 upsert. So 2N subrequests.
- **Limit:** ~50 subrequests/invocation on paid plan. Hit at ~20 distinct projects per batch.
- **Files:** `backend/src/api/events-batch.ts`
- **Scaling path:** Move recompute to a queue / Durable Object as in Performance §3.

### Daemon stores one events.jsonl per project, never rotates — Medium

- **Resource/System:** Local disk under `~/.synapse/projects/<id>/events.jsonl`.
- **Current capacity:** Append-only. No rotation. Each event is ~300-500 bytes JSON. At 10k events/day per active project, ~5MB/day per project.
- **Limit:** Whatever the user's home FS can hold. The `readEvents` re-load cost (Performance §2) hits first.
- **Files:** `mcp/src/capture/events-log.ts`
- **Scaling path:** Daily rotation + post-flush truncation past the watermark.

### MCP brief renderer truncates at MAX_BRIEF_LINES=30 — Low

- **Resource/System:** `mcp/src/capture/handoff-brief.ts:6` caps brief output at 30 lines.
- **Current capacity:** Brief sections: next-step, recent-activity, open-subtasks (first 5), open-questions (first 3). Hard cap means subtasks/questions beyond the slice are dropped silently.
- **Limit:** Most projects have <30 open subtasks. Power users with many open threads will not see them in the brief.
- **Scaling path:** Pagination link in the brief ("...and 12 more — `synapse status` to see all") and a corresponding `synapse status --full` flag.

## Dependencies at Risk

### MCP SDK version skew between mcp/ and backend/ — Low

- **Risk:** `mcp/package.json` pins `@modelcontextprotocol/sdk: 1.27.1` (exact); `backend/package.json` uses `@modelcontextprotocol/sdk: ^1.26.0`. If the backend resolves to 1.26.x while mcp uses 1.27.1, protocol differences (resource subscriptions, completion handlers) can mismatch.
- **Impact:** Tools work because the SDK is backward-compatible within 1.x, but the divergence is silent until a breaking change ships.
- **Migration plan:** Align both to `1.27.1` or move the SDK into a shared workspace dep.

### `@supabase/supabase-js` 2.99.x — Tracked / Low

- **Risk:** `backend/package.json:20` uses `^2.99.2`. Supabase ships breaking changes via minor versions occasionally (e.g., 2.50 → 2.51 changed `update().select()` return shape). The caret allows automatic upgrades.
- **Impact:** A `pnpm install` after a Supabase release could silently change response shapes for the queries in `backend/src/db/queries/*.ts`.
- **Migration plan:** Pin to exact `2.99.2` and bump deliberately. Confirm with `backend/test/` E2E.

### `zod 4.x` in MCP — Low

- **Risk:** `mcp/package.json:36` uses `zod 4.3.6` (exact pin, good). Zod 4 has different `z.string().describe()` semantics from Zod 3 — the MCP SDK examples and most docs are still Zod 3.
- **Impact:** When upgrading the SDK or adopting community schemas, devs may copy-paste Zod 3 patterns that subtly fail in Zod 4.
- **Migration plan:** Document Zod major in README; add a code review checklist item for any new `z.*` schema.

## Test Coverage Gaps

### `/api/events/batch` authz behavior — High

- **What's not tested:** That the endpoint rejects events whose `project_id` belongs to a project the caller is not a member of (per the Critical security finding above). The tests at `backend/test/api/events-batch.test.ts:35-56` are all `.skip` with reason "requires valid auth token + DB".
- **Files:** `backend/test/api/events-batch.test.ts:35-56`, `backend/src/api/events-batch.ts:37`
- **Risk:** The authorization bug above could silently regress. Fix has no test net.
- **Priority:** High.

### `/api/projects/:id/events` and `/status` membership enforcement — High

- **What's not tested:** Cross-tenant reads. Test files exist (`backend/test/api/project-events.test.ts:35-44`, `project-status.test.ts:27-34`) but every test is `.skip` for the same reason.
- **Files:** `backend/test/api/project-events.test.ts`, `backend/test/api/project-status.test.ts`
- **Risk:** Same as above — the listed authz bugs go unnoticed.
- **Priority:** High.

### Invite flow happy/error paths — Medium

- **What's not tested:** Invite acceptance with mismatched email, expired invite, already-accepted invite — all `.skip` at `backend/test/api/invites.test.ts:43-51`.
- **Files:** `backend/test/api/invites.test.ts:43-51`, `backend/src/api/invites.ts:75-104`
- **Risk:** Combined with the email-mismatch bug above, this is the security-feature with the weakest test coverage.
- **Priority:** Medium-High.

### Daemon idle-trigger / LLM inference integration — Medium

- **What's not tested:** End-to-end "daemon goes idle → fires `maybeFireInferNextStep` → writes `NextStepInferred` event." Unit tests for the function exist (`mcp/test/capture/`) but no integration test ties it to `startHandoffLoop`. (And the integration path is dead — see Tech Debt §3.)
- **Files:** `mcp/src/capture/daemon.ts:83-129`
- **Risk:** Once the path is wired, regressions in idle detection or in the claude spawn will go silent.
- **Priority:** Medium.

### Frontend a11y warnings — Tracked / Low

- **What's not tested:** The accessibility regressions surfaced by `svelte-check`:
  - `frontend/src/lib/components/layout/AppShell.svelte:60` — `<div>` with click handler missing keyboard handler + ARIA role (two warnings on the same node).
  - `frontend/src/routes/(app)/home/+page.svelte:77` — `autofocus`.
  - `frontend/src/routes/(app)/settings/+page.svelte:192` — `autofocus`.
  - Unused CSS selectors in `Hero.svelte`, `CliSetupWizard.svelte`, `ProblemSection.svelte` (CSS dead code, low priority).
- **Files:** See above. Total of 12 svelte-check warnings across 6 files.
- **Risk:** Keyboard-only users can't dismiss the workspace switcher on AppShell.svelte. Autofocus is hostile to screen readers. None of this is covered by automated tests.
- **Priority:** Low (no automated coverage planned; address opportunistically).

### Old conversation-capture path (`watcher.test.ts` flake) — Tracked / Low

- **What's not tested reliably:** The legacy capture path's filesystem-event behavior. The 15s vitest timeout (`mcp/test/unit/capture/watcher.test.ts:65`) is a band-aid for chokidar's CI flakiness, not a fix.
- **Files:** `mcp/test/unit/capture/watcher.test.ts`
- **Risk:** If/when the legacy capture is retired (see Tech Debt §8), this test file goes with it. Until then, expect occasional CI timeouts.
- **Priority:** Low.

---

*Concerns audit: 2026-05-15*
