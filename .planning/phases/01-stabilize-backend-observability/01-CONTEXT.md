# Phase 1: Stabilize Backend & Observability - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning (carved slice — wrangler-free subset only)

<domain>
## Phase Boundary

Phase 1's roadmap goal is unchanged: *a user running the daemon can see their events reach the backend, and the operator can see future failures before users do.* This discussion **carves Phase 1 into two slices** because the current device cannot run wrangler (Netskope egress block + intentional CF/non-CF machine separation).

**Slice 1a — wrangler-free (THIS slice, plan + execute here):**
- **BUG-02** — `synapse capture status` reports daemon state honestly under launchd / systemd
- **BUG-03** — wizard's MCP configs work on proxy-restricted networks (Netskope) without `npx`
- **BUG-04** — `synapse init` writes `.mcp.json` to cwd (project-local MCP server config)
- **OBS-01 (code-only)** — Sentry SDK init, Hono `app.onError` wiring, `wrangler.jsonc` `SENTRY_DSN` binding. Deploy + SC#4 deliberate-throw verification deferred to slice 1b.
- **BUGS.md #12** — daemon flush exponential backoff (pulled in: colocated with BUG-02 in `mcp/src/capture/daemon.ts`)

**Slice 1b — wrangler-bound (DEFERRED to the CF-enabled machine):**
- **BUG-01** — 1101 root-cause via `wrangler tail`, then fix (likely `Promise.allSettled` swap at `events-batch.ts:132`, per research D1)
- **OBS-01 (deploy + verify)** — `wrangler deploy` the Sentry code authored in 1a, then SC#4 verification
- **OPS-01** — `wrangler whoami` + dashboard screenshot to confirm Workers Paid tier

Phase 1 is only COMPLETE when both slices land. This CONTEXT.md governs slice 1a; slice 1b will pick up the same CONTEXT.md on the CF machine.

</domain>

<decisions>
## Implementation Decisions

### `synapse init` `.mcp.json` write (BUG-04)
- **D-01:** Always write `.mcp.json` to cwd; if it already exists, parse and merge — add/update only the `synapse` server entry, preserve any other server entries (e.g., Cursor, Windsurf, user-added servers). ~20 LOC of JSON-merge logic + a test.
- **D-02:** No `--scope` flag — keep the CLI surface minimal. `init` becomes a complete one-shot wizard replacement.
- **Rationale:** Safest behavior on re-run; preserves hand-tuned configs; closes BUGS.md #4's "complete one-shot replacement for the wizard" framing without overwriting risk.

### Sentry observability (OBS-01)
- **D-03:** Author Sentry code in slice 1a even though deploy + SC#4 verification must happen on the CF machine. Scope: `backend/src/lib/observability.ts` (new file, SDK init + `reportError` helper), Hono `app.onError` integration in `backend/src/index.ts` (or wherever the app is mounted), `ctx.waitUntil(reportError(...))` for unhandled-rejection escapes, `SENTRY_DSN` env binding added to `backend/wrangler.jsonc`.
- **D-04:** SDK choice locked by research D2: `@sentry/cloudflare ^10.51.0` + `@sentry/hono`. NOT toucan-js (archived 2026-01-12).
- **D-05:** `SENTRY_DSN` binding lands in `wrangler.jsonc` *before* any SDK init code — Prereq #4 (forgetting this turns the SDK into a silent no-op).
- **D-06:** Source-map upload deferred until slice 1b (it's a `wrangler deploy` plugin / hook concern; pre-wiring it in the codebase here is fine if low-cost, otherwise defer).
- **D-07:** PII / payload scrubbing policy: Sentry should NOT capture full event payloads by default — `payload` field on events can contain user prompt/response text. Use a `beforeSend` hook that strips `payload` from any error context, keeping only `event_id`, `project_id`, `kind`, `actor_user_id`. Confirm at planning time.

### Daemon detection + log noise (BUG-02 + BUGS.md #12)
- **D-08:** Daemon detection mechanism locked by research D9. macOS: `launchctl print gui/$UID/<label>` exit code (NOT parsing `launchctl list`). Linux: `systemctl --user is-active synapsesync.service`. PID file (`~/.synapse/capture.pid`) becomes tier-2 fallback only.
- **D-09:** Pull BUGS.md #12 into slice 1a — exponential backoff with jitter on flush failures. Schedule: 10s → 20s → 40s → 80s → cap at ~5min. Reset on first successful flush. Implement in `runFlushCycle` or the loop wrapper at `mcp/src/capture/daemon.ts:164` (`startHandoffLoop`). Rationale: colocated edit with BUG-02 in the same file; quiets `~/.synapse/daemon.log` during the current 1101 outage; prevents burst-flush at recovery.
- **D-10:** No daemon-log rotation/size-cap in this slice — backoff alone reduces log growth from ~6 lines/min to amortized near-zero once cap is hit. Reconsider only if dogfood shows lingering log bloat.

### Proxy-blocked `npx` in wizard configs (BUG-03)
- **D-11:** MCP-command fallback chain locked by research D10. Order: (1) `which synapsesync` → absolute path; (2) `node <abs-path>/dist/index.js`; (3) `npx synapsesync` as last resort with a wizard warning. 2-second `fetch("https://registry.npmjs.org/-/ping")` is the proxy-detection probe before falling back.
- **D-12:** Touched file is `mcp/src/cli/editors/io.ts:95` — same probe + chain logic reused across editor adapters (Cursor, Windsurf, Claude Code local). Centralize the resolver in one helper.

### Linux verification scope
- **D-13:** Linux daemon path remains unverified unless a Linux machine is accessed during execution. Default per research Q5. Code paths land; manual verification deferred. NOT a launch blocker.

### Claude's Discretion
- Test coverage: write standard unit tests for each fix (BUG-04 merge logic, BUG-03 fallback chain, BUG-02 detector, #12 backoff schedule). Do NOT touch the `.skip`'d backend integration tests (BUGS.md #5a) — that's slice 1b territory and currently P2.
- File organization: new helpers (proxy probe, MCP-command resolver, JSON merger) go in `mcp/src/cli/util/` if a single-use helper, or `mcp/src/cli/util/proxy.ts` if reusable. Planner's call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project + roadmap context
- `.planning/PROJECT.md` — milestone scope, constraints, key decisions, evolution rules
- `.planning/REQUIREMENTS.md` — full 23 v1 requirements with acceptance criteria
- `.planning/ROADMAP.md` §"Phase 1: Stabilize Backend & Observability" — success criteria + dependency notes
- `.planning/STATE.md` — current position, recent activity, blockers

### Research (LOCKED decisions for Phase 1)
- `.planning/research/SUMMARY.md` §"Decision Set" — D1 (1101 fix path), D2 (Sentry SDK), D9 (daemon detection), D10 (npx fallback), D11 (Workers Paid verify)
- `.planning/research/SUMMARY.md` §"Non-Obvious Prerequisites" #4 — `SENTRY_DSN` binding before SDK code
- `.planning/research/SUMMARY.md` §"Open Questions" Q1, Q5 — Paid-tier assumption, Linux verification scope

### Bug specifics + fix sketches
- `docs/BUGS.md` #1 — BUG-01 forensic detail (slice 1b)
- `docs/BUGS.md` #2 — BUG-02 root cause + fix sketch
- `docs/BUGS.md` #3 — BUG-03 fix sketch
- `docs/BUGS.md` #4 — BUG-04 fix sketch
- `docs/BUGS.md` #12 — daemon flush backoff fix sketch (pulled into 1a)

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md` — overall system shape; events pipeline
- `.planning/codebase/STACK.md` §"Worker Observability" + §"Install-Time UX"
- `.planning/codebase/INTEGRATIONS.md` — Cloudflare + Supabase + Sentry integration surface
- `.planning/codebase/CONCERNS.md` — known correctness/perf concerns
- `.planning/codebase/CONVENTIONS.md` — TypeScript / testing / module patterns

### Source files in scope (slice 1a)
- `mcp/src/capture/daemon.ts:40-50` — `DaemonManager.isRunning()` (BUG-02 fix site)
- `mcp/src/capture/daemon.ts:164` — `startHandoffLoop` (BUGS.md #12 fix site)
- `mcp/src/capture/handoff-sync.ts:42` — flush throw path (BUGS.md #12)
- `mcp/src/cli/editors/io.ts:95` — MCP command emission (BUG-03)
- `mcp/src/cli/init.ts` — `runInit` (BUG-04, write `.mcp.json` with merge)
- `mcp/src/cli/commands.ts` — `runCaptureStatus` (BUG-02 surface)
- `backend/src/lib/observability.ts` — NEW (Sentry init + `reportError`)
- `backend/src/index.ts` (or app mount) — Hono `app.onError` wiring
- `backend/wrangler.jsonc` — `SENTRY_DSN` binding

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Hook-command resolver pattern** at `mcp/src/cli/init.ts` for installing hooks — same `which → absolute → node dist/index.js` chain that BUG-03 needs. Reuse this resolver across `init.ts` and `editors/io.ts`; don't duplicate.
- **`os-service.ts` install-side detection** — already distinguishes launchd vs systemd. Symmetric pattern for D8's runtime detection.
- **`reduce()` from `@synapse/shared/handoff/reducer.js`** — at-least-once + idempotent semantics are preserved for daemon backoff; failed flushes don't lose data because `events.jsonl` is append-only and `.watermark` only advances on success.

### Established Patterns
- **TypeScript across all 4 workspaces** — no language switches. New `observability.ts` is TS.
- **Pre-push hook runs `lint && typecheck && test`** — every commit pays ~25s. Plan tasks should be small enough that the hook isn't punishing.
- **No external users → no backwards-compat constraints** — `.mcp.json` merge logic doesn't need a migration path for legacy shapes; today's shape is the only shape.
- **PID file as fallback, not source-of-truth** — D8 mirrors install-side; existing `~/.synapse/capture.pid` lookups stay as tier-2.

### Integration Points
- **`runInit`** is called from both the wizard (`d3cd771`) and direct CLI invocation. BUG-04 fix must work for both call sites (the wizard partially closes BUG-04 today by calling `runInit`, but direct callers still get hooks-without-`.mcp.json`).
- **Sentry → Hono integration** binds at `app.onError`; `ctx.waitUntil(reportError(...))` handles the unhandled-rejection escape path that Hono can't catch directly (the root cause family that 1101 belongs to).
- **Daemon flush loop** in `startHandoffLoop` calls `cycle()` every `min(pull_ms, flush_ms)` = 10s. Backoff state must be loop-scoped, not per-cycle.

</code_context>

<specifics>
## Specific Ideas

- **`.mcp.json` merge:** preserve unknown server entries verbatim. The `synapse` entry key is the merge target; everything else is opaque pass-through.
- **Backoff jitter:** add ±25% randomness to each step to avoid synchronized retries across simultaneously-restarting daemons. Reference: AWS exponential-backoff guidance.
- **Sentry `beforeSend` scrubbing:** keep `event_id`, `project_id`, `kind`, `actor_user_id`. Strip `payload`. Keep stack traces and request metadata.
- **Capture status output:** when daemon is running under launchd, surface the supervised PID + "supervised by launchd"/"supervised by systemd" tag so the user can distinguish "alive" from "alive AND supervised" if it matters during debugging.

</specifics>

<deferred>
## Deferred Ideas

### Slice 1b (CF machine — wrangler-bound)
- BUG-01 1101 root-cause via `wrangler tail` + fix (likely `Promise.allSettled` swap at `events-batch.ts:132`)
- OBS-01 deploy + SC#4 verification (deliberately-thrown error → Sentry within 1 min)
- OPS-01 Workers Paid tier verification (`wrangler whoami` + dashboard screenshot)
- Source-map upload via wrangler (if not pre-wired in 1a)
- Closing BUGS.md #5a (handler integration tests against a real DB) — currently P2; revisit if the test gap directly blocks slice 1b confidence
- BUG-03 verification on a live Netskope-restricted network (code lands in 1a, manual verification needs the wizard outro to be observed against the proxy)

### Other phases
- Linux daemon path verification — Phase 2 if a Linux machine is accessible; otherwise launch with the gap documented
- Daemon log rotation/size-cap — only if backoff alone proves insufficient post-dogfood
- BUGS.md #5a integration test refactor — P2 follow-up

</deferred>

---

*Phase: 01-stabilize-backend-observability (slice 1a)*
*Context gathered: 2026-05-19*
*Note: This phase has TWO execution slices. Slice 1a (wrangler-free) is planned + executed on this device; slice 1b (wrangler-bound) resumes on the CF-enabled machine. Phase is only complete when both ship.*
