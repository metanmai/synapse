# Phase 1: Stabilize Backend & Observability — Research (Slice 1a)

## RESEARCH COMPLETE

**Researched:** 2026-05-19
**Slice:** 1a (wrangler-free — BUG-02, BUG-03, BUG-04, OBS-01 code-only, BUGS.md #12)
**Confidence:** HIGH for Sentry SDK shape, daemon detection mechanism, JSON merge approach. MEDIUM for the precise Sentry `app.onError` interaction (docs are thin on the exact wiring beyond the middleware). LOW only for "does the daemon backoff need persistence" — answered as NO, justification below.

**Domain:** Cloudflare Workers observability + Node.js CLI / daemon hygiene under launchd/systemd + cross-editor MCP config generation.

## Summary

Slice 1a is five surgical edits sharing a single backbone: every bug is a "we silently lied about state" failure. BUG-02 lies about whether the daemon is alive. BUG-03 lies that `npx synapsesync` will work everywhere. BUG-04 lies that `synapse init` is a complete installer. OBS-01 fixes the deeper lie — that the Worker is healthy when it's actually 1101-ing in prod. BUGS.md #12 stops the daemon from lying with logs ("here's another flush, here's another flush, …" 6/min during a backend outage).

All locked decisions from CONTEXT.md hold up against research. The most consequential discovery is a **gotcha about `launchctl print` exit semantics** that confirms D-08 but only if invoked correctly (do not pipe; check `execSync` exit code directly). One new prerequisite surfaced: **the existing `writeMcpJson` helper at `mcp/src/cli/editors/io.ts:98` already does merge-if-exists** for `mcpServers.synapse` — BUG-04 is therefore *not* "write merge logic from scratch," it's "call this existing helper from `runInit`."

**Primary recommendation:** Plan 5 tasks (one per slice-1a item) + 1 Wave-0 shared helper task (`mcp/src/cli/util/mcp-command.ts` resolver). Use existing `writeMcpJson` for BUG-04. Use injectable `nowFn` + `vi.useFakeTimers` for the daemon backoff test. Wire `@sentry/hono`'s `sentry()` middleware as the FIRST `app.use(...)` in `backend/src/index.ts` — it must precede the existing CORS, rate-limit, and DB middleware so it sees every request.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim from 01-CONTEXT.md `<decisions>`)

**`.mcp.json` write (BUG-04):**
- **D-01:** Always write `.mcp.json` to cwd; if it already exists, parse and merge — add/update only the `synapse` server entry, preserve any other server entries (e.g., Cursor, Windsurf, user-added servers). ~20 LOC of JSON-merge logic + a test.
- **D-02:** No `--scope` flag — keep the CLI surface minimal. `init` becomes a complete one-shot wizard replacement.

**Sentry observability (OBS-01):**
- **D-03:** Author Sentry code in slice 1a even though deploy + SC#4 verification must happen on the CF machine. Scope: `backend/src/lib/observability.ts` (new file, SDK init + `reportError` helper), Hono `app.onError` integration in `backend/src/index.ts`, `ctx.waitUntil(reportError(...))` for unhandled-rejection escapes, `SENTRY_DSN` env binding added to `backend/wrangler.jsonc`.
- **D-04:** SDK choice locked by research D2: `@sentry/cloudflare ^10.51.0` + `@sentry/hono`. NOT toucan-js.
- **D-05:** `SENTRY_DSN` binding lands in `wrangler.jsonc` *before* any SDK init code.
- **D-06:** Source-map upload deferred until slice 1b.
- **D-07:** `beforeSend` strips `payload` from any error context, keeping only `event_id`, `project_id`, `kind`, `actor_user_id`. Keep stack traces and request metadata.

**Daemon detection + log noise (BUG-02 + BUGS.md #12):**
- **D-08:** macOS: `launchctl print gui/$UID/<label>` exit code. Linux: `systemctl --user is-active synapsesync.service`. PID file = tier-2 fallback.
- **D-09:** Pull BUGS.md #12 into slice 1a — exponential backoff with jitter on flush failures. 10s → 20s → 40s → 80s → cap at ~5min. Reset on first success.
- **D-10:** No daemon-log rotation/size-cap in this slice.

**Proxy-blocked `npx` in wizard configs (BUG-03):**
- **D-11:** Fallback chain: (1) `which synapsesync` → absolute path; (2) `node <abs-path>/dist/index.js`; (3) `npx synapsesync` as last resort with warning. 2s `fetch("https://registry.npmjs.org/-/ping")` is the proxy-detection probe.
- **D-12:** Touched file is `mcp/src/cli/editors/io.ts:95`. Centralize the resolver in one helper, reused across editor adapters.

**Linux verification scope:**
- **D-13:** Linux daemon path remains unverified unless a Linux machine is accessed during execution.

### Claude's Discretion
- Test coverage: standard unit tests for each fix (BUG-04 merge, BUG-03 fallback, BUG-02 detector, #12 backoff). Do NOT touch `.skip`'d backend integration tests (BUGS.md #5a) — slice 1b territory.
- File organization: new helpers (proxy probe, MCP-command resolver, JSON merger) go in `mcp/src/cli/util/`.

### Deferred Ideas (OUT OF SCOPE — slice 1b owns these)
- BUG-01 1101 root-cause via `wrangler tail` + likely `Promise.allSettled` swap at `events-batch.ts:132`
- OBS-01 deploy + SC#4 verification (deliberate-throw → Sentry within 1 min)
- OPS-01 Workers Paid tier verification (`wrangler whoami` + dashboard screenshot)
- Source-map upload via wrangler
- Closing BUGS.md #5a (handler integration tests against real DB)
- BUG-03 verification on a live Netskope network
</user_constraints>

<phase_requirements>
## Phase Requirements (slice 1a)

| ID | Description | Research Support |
|----|-------------|------------------|
| BUG-02 | `synapse capture status` accurately reports daemon state when supervised by launchd or systemd. Acceptance: with a launchd-supervised daemon alive, `synapse capture status` shows "Daemon: running" + the launchd PID. | §"BUG-02 — Daemon detection" — `launchctl print gui/$UID/<label>` exit-0 ⇒ running; parse PID from `pid = N` line. systemd: `systemctl --user is-active`. Fall back to existing PID-file path. |
| BUG-03 | Wizard's MCP configs work on proxy-restricted networks. Acceptance: fresh wizard run on a network where `npx` returns 403 produces a `.mcp.json` whose `command` field resolves to a binary on disk, and the MCP server starts. | §"BUG-03 — Proxy-resilient MCP command resolver" — `which` → absolute path; `node <abs-path>/dist/index.js`; emit `npx synapsesync` only with a warning. 2s timeout probe of `https://registry.npmjs.org/-/ping`. |
| BUG-04 | `synapse init` writes project-local `.mcp.json` in addition to hooks + service + config. Acceptance: `synapse init --api-key X` + Claude Code restart → `mcp__synapse__tree()` succeeds. | §"BUG-04 — `.mcp.json` write from runInit" — call **existing** `writeMcpJson(path.join(cwd, ".mcp.json"), api_key)` from `runInit`. The helper already does merge-if-exists for `mcpServers.synapse`. Also: `ensureGitignore(cwd, ".mcp.json")`. |
| OBS-01 (code) | Sentry SDK init, Hono `app.onError` wiring, `wrangler.jsonc` `SENTRY_DSN` binding, `beforeSend` payload scrubbing. (Deploy + SC#4 verification deferred to slice 1b.) | §"OBS-01 — Sentry wiring (code-only)" — single `app.use(sentry(app, env => ({ dsn: env.SENTRY_DSN, beforeSend: scrubPayload })))` as FIRST middleware. `app.onError` keeps current behavior; `sentry()` middleware auto-captures from onError. Manual `Sentry.captureException(err)` + `ctx.waitUntil()` for non-Hono paths (scheduled cron, Durable Object alarms). |
| BUGS.md #12 | Daemon flush exponential backoff with jitter (10s → 20s → 40s → 80s → cap ~5min). Reset on first successful flush. | §"BUGS.md #12 — Daemon backoff" — backoff state in `startHandoffLoop` closure (loop-scoped). Replace fixed `setInterval(cycle, 10000)` with self-rescheduling `setTimeout` that uses current backoff delay. Reset to base on any successful `runFlushCycle`. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daemon supervisor detection (launchctl/systemctl) | mcp/CLI (Node) | — | macOS/Linux shell-out; runs in user-space; touches no backend |
| `.mcp.json` merge | mcp/CLI (Node) | — | Touches cwd files; never crosses network |
| Proxy-resilient command-string resolver | mcp/CLI (Node) | — | Pure synchronous resolution + one HEAD-style fetch |
| Sentry SDK init + middleware | backend (Cloudflare Worker) | — | Hono is the integration boundary; SDK runs only inside the Worker |
| `beforeSend` payload scrubbing | backend (Cloudflare Worker) | — | Pure function on the event object; same isolate as Sentry SDK |
| Daemon flush backoff state | mcp/CLI (Node) — `startHandoffLoop` closure | — | Loop-scoped (per-process). Watermark on disk handles durability. |
| `SENTRY_DSN` secret storage | Cloudflare (`wrangler secret put`) | `wrangler.jsonc` declares the binding name | Secret value is set out-of-band; the JSON file only declares the binding exists |

**No cross-tier capabilities in this slice.** Slice 1b will add one: the OBS-01 deploy path crosses from local-machine (`wrangler deploy`) into the Worker tier.

## Standard Stack

### Core (new dependencies for OBS-01)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@sentry/cloudflare` | `^10.53.1` | Sentry SDK base for Cloudflare Workers; peer of `@sentry/hono` | First-party Cloudflare-supported SDK from getsentry. `[VERIFIED: npm registry — npm view @sentry/cloudflare version → 10.53.1, time.created 2024-07-31, repo getsentry/sentry-javascript, MIT, no postinstall script]` `[CITED: https://docs.sentry.io/platforms/javascript/guides/cloudflare/]` |
| `@sentry/hono` | latest (BETA) | Hono middleware that wires Sentry into the app lifecycle including `app.onError` | The dedicated Hono SDK from getsentry; the canonical integration for Hono apps. `[CITED: https://github.com/getsentry/sentry-javascript/blob/master/packages/hono/README.md]` — README accessed 2026-05-19 raw from GitHub. Note: README explicitly labels it BETA. `[VERIFIED: source code in getsentry/sentry-javascript monorepo]` `[ASSUMED: latest published version — npm view failed via corporate proxy (403); the planner must verify on a clean network before pinning]` |

### Existing dependencies in use (no version changes)

| Workspace | Library | Why It Matters Here |
|-----------|---------|---------------------|
| backend | `hono ^4.12.8` | Sentry middleware mounts via `app.use(sentry(app, ...))` — must precede CORS/rate-limit/db. (`backend/src/index.ts:1`, `backend/src/index.ts:31-49`) |
| mcp | `@clack/prompts ^0.11.0` | Used in `runInit` for UI; no change needed for slice 1a |
| mcp | vitest `^4.1.2` | Test runner with `vi.useFakeTimers()` already proven in `mcp/test/unit/browser-auth.test.ts:114,123` — used for backoff scheduling tests |

### No new dependencies for the mcp workspace

BUG-02/03/04 and BUGS.md #12 are all **pure stdlib + existing helpers**. No JSON-merge library needed — the existing `writeMcpJson` at `mcp/src/cli/editors/io.ts:98-112` and `writeJsonSafe` at `mcp/src/cli/editors/io.ts:135-153` already implement merge-if-exists for known shapes. No new HTTP client needed — `fetch` is native.

**Installation (backend only):**
```bash
cd backend && npm install --save @sentry/cloudflare @sentry/hono
```

The `mcp` workspace receives **zero** new dependencies. This matters for the corporate-proxy constraint (PROJECT.md): every avoided dependency is one less Netskope block to navigate.

### Alternatives Considered (and rejected per CONTEXT.md decisions)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `@sentry/cloudflare` + `@sentry/hono` | `toucan-js` | Archived 2026-01-12 (per research D2 / SUMMARY.md) |
| Existing `writeMcpJson` helper for BUG-04 | A new `deepMerge` helper | The existing helper already preserves unknown server entries by spreading the previous `mcpServers` (`io.ts:107-110`). Writing a new merger duplicates working code. |
| Parse `launchctl list <label>` output | `launchctl print gui/$UID/<label>` exit code | Apple's man page warns the `list` format isn't API; D-08 explicitly locks the `print` mechanism. Plus: `list` is tied to a single Label — `print` is symmetric with the systemd `is-active` shape. (Both rely on exit code, not output parsing.) |
| New shared `pidPath()` API | Re-use existing `~/.synapse/capture.pid` as tier-2 fallback | Per `<code_context>` reusable assets — the PID file stays in place; `isRunning()` just *additionally* asks the supervisor first. |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@sentry/cloudflare` | npm | ~22 mo (created 2024-07-31) | High (Sentry monorepo) | github.com/getsentry/sentry-javascript | n/a (tool unavailable) | Approved |
| `@sentry/hono` | npm | new-ish, BETA label | unknown (proxy blocked `npm view`) | github.com/getsentry/sentry-javascript (same monorepo) | n/a (tool unavailable) | Approved |

**Slopcheck status:** `pip install slopcheck` was not attempted on this device (corporate proxy blocks PyPI). Both packages live in the **same first-party `getsentry/sentry-javascript` monorepo** confirmed by reading the README directly from the public raw GitHub URL — this is the strongest verification available. The `[ASSUMED]` tag on `@sentry/hono`'s precise version applies only to its **published version number**, not to its legitimacy as a package.

**Postinstall check:** `@sentry/cloudflare` has no postinstall script (`npm view @sentry/cloudflare scripts.postinstall` → empty). `@sentry/hono` could not be queried due to proxy.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious:** none

**Planner action:** Add a `checkpoint:human-verify` task **only** for the `@sentry/hono` version pin step (re-run `npm view @sentry/hono version` on a non-proxied network before committing the `package.json` change). `@sentry/cloudflare` is verified end-to-end on this machine and needs no checkpoint.

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────────────┐
                       │  Cloudflare Worker (backend)                    │
                       │                                                 │
   POST /api/events ──▶│  Hono app                                       │
                       │   ├─ app.use(sentry(...))   ◀── NEW (slice 1a)  │
                       │   ├─ app.use(cors)                              │
                       │   ├─ app.use(rateLimit)                         │
                       │   ├─ app.use(dbMiddleware)                      │
                       │   └─ app.route(...)                             │
                       │        │                                        │
                       │        ▼                                        │
                       │   events-batch handler                          │
                       │        │ Promise.all(recomputeProjectStatus)    │
                       │        │   ◀── 1101 origin (slice 1b)           │
                       │        ▼                                        │
                       │   throws → app.onError → sentry middleware      │
                       │                          captures + beforeSend  │
                       │                          strips event.extra.    │
                       │                          payload                │
                       │                                                 │
                       │   ctx.waitUntil(scheduled) ─┐                   │
                       │                             ▼                   │
                       │              cron / scheduled → unhandled       │
                       │              throws need manual                 │
                       │              Sentry.captureException +          │
                       │              ctx.waitUntil(Sentry.flush(2000))  │
                       └─────────────────────────────────────────────────┘
                                              ▲
                                              │ POST events
                                              │
   ┌──────────────────────────────────────────┴─────────────────────────┐
   │  User's machine (mcp workspace)                                    │
   │                                                                    │
   │   synapse capture status                                           │
   │      └─ DaemonManager.isRunning()                                  │
   │             ├─ tier-1: launchctl print gui/$UID/app.synapsesync.daemon
   │             │           exit 0 ⇒ running                           │
   │             ├─ tier-1: systemctl --user is-active synapsesync.service
   │             │           prints "active" ⇒ running                  │
   │             └─ tier-2: ~/.synapse/capture.pid + kill(pid, 0)       │
   │                                                                    │
   │   synapse init                                                     │
   │      ├─ installHooks(~/.claude/settings.json)                      │
   │      ├─ installSlashCommands(~/.claude/commands/synapse/)          │
   │      ├─ writeConfig(~/.synapse/config.json)                        │
   │      ├─ writeServiceFile() → launchd/systemd                       │
   │      └─ writeMcpJson(cwd/.mcp.json) ◀── NEW (BUG-04)               │
   │              └─ uses mcp-command resolver (BUG-03):                │
   │                     proxyHealthy ? "synapsesync" or absolute       │
   │                     bin path : node <abs>/dist/index.js : npx      │
   │                                                                    │
   │   capture daemon (startHandoffLoop)                                │
   │      loop iteration:                                               │
   │         runFlushCycle → success → backoff=10s, reset               │
   │                       → throw   → backoff = min(backoff*2, 300s)   │
   │                                  + ±25% jitter                     │
   │         setTimeout(loop, backoff)                                  │
   └────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| File | Owns | Touched by |
|------|------|------------|
| `backend/src/index.ts:28-65` | Hono app construction, middleware chain, `app.onError` | OBS-01 (insert sentry middleware as FIRST `app.use`) |
| `backend/src/lib/observability.ts` (NEW) | `Sentry.init` options (DSN, beforeSend), `reportError(err, ctx?)` helper for non-Hono paths | OBS-01 |
| `backend/wrangler.jsonc` | Worker binding declarations | OBS-01 D-05 (add `SENTRY_DSN` to vars or set via `wrangler secret put`) |
| `mcp/src/capture/daemon.ts:40-50` | `DaemonManager.isRunning()` | BUG-02 |
| `mcp/src/capture/daemon.ts:131-179` | `startHandoffLoop` | BUGS.md #12 (replace `setInterval` with self-rescheduling `setTimeout`) |
| `mcp/src/cli/init.ts:54-63` | `runInit` orchestrator | BUG-04 (add `writeMcpJson` call) |
| `mcp/src/cli/editors/io.ts:94-96` | `synapseMcpServer` — emits the MCP command/args object | BUG-03 (replace `npx`/`synapsesync` constants with resolver call) |
| `mcp/src/cli/util/mcp-command.ts` (NEW) | Cross-editor MCP-command resolver (which → absolute → node dist/index.js → npx fallback) + proxy probe | BUG-03 D-12 |
| `mcp/src/cli/util/daemon-supervisor.ts` (NEW) | Wraps `launchctl print` / `systemctl --user is-active` calls; returns `{ running: bool, pid?: number, supervisor: "launchd"|"systemd"|"pid-file"|null }` | BUG-02 (DaemonManager calls this first) |

### Pattern 1: Sentry middleware wiring (OBS-01)

**What:** `@sentry/hono/cloudflare` exports `sentry(app, options)` middleware that:
- Reads `env` bindings via a callback (so `SENTRY_DSN` flows from `wrangler.jsonc`/`wrangler secret put` → `c.env.SENTRY_DSN` → Sentry).
- Auto-captures any uncaught throw inside Hono routes (including the ones currently logged by `app.onError` at `backend/src/index.ts:51-65`).
- Requires `nodejs_compat` compatibility flag (already set: `backend/wrangler.jsonc:6`).

**When to use:** Always, as the FIRST `app.use` line — before CORS, before rate-limit, before any business middleware. This ensures Sentry sees every request transaction and captures errors thrown by any later middleware.

**Example (synthesized from canonical README — adapt to repo style):**
```typescript
// backend/src/index.ts (modified)
import { Hono } from "hono";
import { sentry } from "@sentry/hono/cloudflare";
import { initSentry, scrubPayload } from "./lib/observability";  // NEW
import type { Env } from "./lib/env";
// ... other imports unchanged

const app = new Hono<{ Bindings: Env }>();

// Sentry middleware — MUST be first
app.use(
  sentry(app, (env) => ({
    dsn: env.SENTRY_DSN,
    sendDefaultPii: false,        // never default-send PII; we'll opt in selectively
    tracesSampleRate: 0.1,        // 10% sampling; tune in slice 1b after SC#4
    beforeSend: scrubPayload,     // strip event.extra.payload
  })),
);

// Existing middleware unchanged
app.use("*", (c, next) => { /* CORS — backend/src/index.ts:31-43 */ });
app.use("*", rateLimit(120, 60000));
app.use("/auth/*", dbMiddleware);
app.use("/api/*", dbMiddleware);

app.onError((err, c) => {
  // EXISTING behavior unchanged. The sentry middleware will already have
  // captured the throw before this handler runs.
  if (err instanceof AppError) { /* ... existing code ... */ }
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
  return c.json({ error: err.message || "Internal server error", /* ... */ }, 500);
});
```

**Source:** `[CITED: https://github.com/getsentry/sentry-javascript/blob/master/packages/hono/README.md]` — verbatim init shape with callback-style env access.

### Pattern 2: `beforeSend` payload scrubbing (OBS-01 D-07)

**What:** A function `(event: Event, hint: Hint) => Event | null` that runs per outgoing Sentry event. Returning `null` drops the event entirely; mutating and returning `event` filters fields.

**Why we need it:** Synapse events (the ones in `~/.synapse/projects/<id>/events.jsonl`, also shipped to the backend) contain `payload` blobs that may include user prompt/response text via `tool_used` events. If a Worker error attaches the event object to its Sentry frame (via `event.extra`, `event.contexts`, or stack-frame locals), Sentry would persist PII.

**Implementation (target: `backend/src/lib/observability.ts`):**
```typescript
import type { Event, EventHint } from "@sentry/cloudflare";

const SAFE_EVENT_KEYS = new Set(["event_id", "project_id", "kind", "actor_user_id", "occurred_at"]);

export function scrubPayload(event: Event, _hint: EventHint): Event | null {
  // Strip event-level extras that may include user payloads
  if (event.extra && typeof event.extra === "object") {
    for (const key of Object.keys(event.extra)) {
      const val = (event.extra as Record<string, unknown>)[key];
      if (isSynapseEventShape(val)) {
        (event.extra as Record<string, unknown>)[key] = stripPayload(val);
      }
    }
  }
  // Same scrub for breadcrumb data
  for (const bc of event.breadcrumbs ?? []) {
    if (bc.data && isSynapseEventShape(bc.data)) {
      bc.data = stripPayload(bc.data);
    }
  }
  // Same scrub for request body if Hono attached it
  if (event.request?.data && typeof event.request.data === "object") {
    event.request.data = sanitizeRequestBody(event.request.data);
  }
  return event;
}

function isSynapseEventShape(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && "kind" in v && "event_id" in v;
}

function stripPayload(ev: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) {
    if (SAFE_EVENT_KEYS.has(k)) out[k] = v;
  }
  return out;
}
```

`[CITED: https://docs.sentry.io/platforms/javascript/configuration/filtering/]` — confirms `beforeSend(event, hint): Event | null` signature; example shows the same `delete event.user.email` pattern we apply more generally.

### Pattern 3: Daemon supervisor detection (BUG-02)

**What:** A two-tier check — supervisor first, PID file fallback.

**macOS (launchd):**
```typescript
// In util/daemon-supervisor.ts
import { execSync } from "node:child_process";

const LABEL = "app.synapsesync.daemon";

function checkLaunchd(): { running: boolean; pid: number | null } {
  try {
    const uid = process.getuid?.() ?? 0;
    // execSync returns the actual exit code from launchctl — NOT piped.
    const out = execSync(`launchctl print gui/${uid}/${LABEL}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    // Exit code 0 means service is loaded. Parse pid from output.
    const m = out.match(/^\s*pid\s*=\s*(\d+)/m);
    return { running: true, pid: m ? Number(m[1]) : null };
  } catch {
    // execSync throws on non-zero exit (113 = service not found)
    return { running: false, pid: null };
  }
}
```

**LANDMINE (verified empirically on this machine, 2026-05-19):**
- `launchctl print gui/$UID/<missing>` exits with code **113** (verified: `launchctl print gui/502/com.nonexistent.fake.service ; echo $?` → 113).
- `launchctl print gui/$UID/<existing>` exits with code **0** AND prints multi-line output where one line matches `/^\s*pid\s*=\s*\d+/`.
- **DO NOT pipe** the command — piping (e.g. `launchctl ... | head`) sets `$?` to the pipe terminator's exit code, masking the real result. `execSync` without a pipe works correctly.

**Linux (systemd):**
```typescript
function checkSystemd(): { running: boolean; pid: number | null } {
  try {
    const state = execSync(`systemctl --user is-active synapsesync.service`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    if (state !== "active") return { running: false, pid: null };
    // Pull PID from `systemctl --user show -p MainPID --value synapsesync.service`
    const pid = execSync(`systemctl --user show -p MainPID --value synapsesync.service`, {
      stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8",
    }).trim();
    const n = Number(pid);
    return { running: true, pid: Number.isFinite(n) && n > 0 ? n : null };
  } catch {
    return { running: false, pid: null };
  }
}
```

`[CITED: systemctl(1) man page]` — exit codes: 0 = at least one unit active; nonzero otherwise. States: `active`/`inactive`/`activating`/`deactivating`/`failed`/`unknown`.

**Tier-2 fallback (existing PID file) — unchanged:**
The current `isRunning()` body (`mcp/src/capture/daemon.ts:40-50`) remains as fallback for unsupervised daemons (the `synapse capture start` path at `mcp/src/capture/cli.ts:42-64` writes `capture.pid` directly). New `DaemonManager.isRunning()` becomes:
```typescript
isRunning(): boolean { return this.status().running; }
status(): DaemonStatus {
  // Tier 1: supervisor
  const sup = checkSupervisor();   // platform-dispatch helper
  if (sup.running) return { running: true, pid: sup.pid, supervisor: sup.kind };
  // Tier 2: PID file (existing behavior)
  const pid = this.readPid();
  if (pid !== null) {
    try { process.kill(pid, 0); return { running: true, pid, supervisor: null }; }
    catch { this.cleanup(); }
  }
  return { running: false, pid: null, supervisor: null };
}
```

### Pattern 4: Proxy-resilient MCP command resolver (BUG-03)

**What:** A helper `resolveSynapseMcpCommand(apiKey): { command, args, env }` that performs the fallback chain ONCE at install time (during `runInit` / wizard run), caches nothing, and emits the most reliable command shape for the current network conditions.

**Algorithm:**
1. Probe `https://registry.npmjs.org/-/ping` with a 2-second timeout via `AbortController`. Success = npm-reachable.
2. Run `which synapsesync` (or `process.platform === "win32"` → `where synapsesync`). If it exits 0, parse stdout as the absolute bin path.
3. Decision tree:
   - **bin path found AND it resolves to a real file:** emit `{ command: <abs-bin-path>, args: [], env: { SYNAPSE_API_KEY } }`. Most reliable; bypasses npm/PATH entirely.
   - **bin path NOT found, but we can compute `<package-root>/dist/index.js`** (via `require.resolve` or `import.meta.resolve`): emit `{ command: process.execPath /* absolute node */, args: [<abs-dist-path>], env: { SYNAPSE_API_KEY } }`. Bypasses npm and PATH `synapsesync` lookup.
   - **proxy reachable AND nothing else works:** emit `{ command: "npx", args: ["synapsesync"], env: { SYNAPSE_API_KEY } }` (the legacy shape, kept as last resort).
   - **proxy NOT reachable AND no bin AND no dist:** still emit `npx synapsesync` BUT show a wizard warning ("npm registry unreachable; the MCP server may fail to start; run `npm i -g synapsesync` from a non-proxied network and rerun `synapse init`").

**Code shape (target: `mcp/src/cli/util/mcp-command.ts`):**
```typescript
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export async function resolveSynapseMcpCommand(apiKey: string): Promise<McpCommand> {
  const env = { SYNAPSE_API_KEY: apiKey };

  // 1. Try absolute bin from PATH
  const binPath = whichSynapsesync();
  if (binPath && fs.existsSync(binPath)) {
    return { command: binPath, args: [], env };
  }

  // 2. Try node + this package's dist/index.js
  const distEntry = resolveDistEntry();
  if (distEntry) {
    return { command: process.execPath, args: [distEntry], env };
  }

  // 3. Fall through to npx (with warning if registry unreachable)
  return { command: "npx", args: ["synapsesync"], env };
}

export async function probeNpmRegistry(timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://registry.npmjs.org/-/ping", { signal: ctrl.signal });
    return res.ok;
  } catch { return false; }
  finally { clearTimeout(t); }
}

function whichSynapsesync(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where synapsesync" : "which synapsesync";
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    // `where` may return multiple lines on Windows; take the first.
    return out.split(/\r?\n/)[0] || null;
  } catch { return null; }
}

function resolveDistEntry(): string | null {
  // This file lives at mcp/src/cli/util/mcp-command.ts in source,
  // and mcp/dist/cli/util/mcp-command.js after build. dist/index.js is
  // three levels up from dist/cli/util/. Same idea as resolveDaemonScriptPath
  // in mcp/src/capture/os-service.ts:113-116.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const distIndex = path.resolve(here, "../../index.js");
    return fs.existsSync(distIndex) ? distIndex : null;
  } catch { return null; }
}
```

Then `mcp/src/cli/editors/io.ts:94-96` becomes:
```typescript
// io.ts — replace synapseMcpServer + add async overload
export async function resolvedSynapseMcpServer(apiKey: string): Promise<Record<string, unknown>> {
  const { command, args, env } = await resolveSynapseMcpCommand(apiKey);
  return { command, args, env };
}
// Callers (writeMcpJson, cursor, windsurf, claude-code adapters) become async or
// receive a pre-resolved command object passed in by the orchestrator (cleaner).
```

**Important:** the existing `writeMcpJson(filePath, apiKey)` signature stays the same — internally it now resolves the command via the helper. Callers don't change.

### Pattern 5: Daemon flush exponential backoff with jitter (BUGS.md #12)

**What:** Replace `setInterval(cycle, Math.min(pull_ms, flush_ms))` at `mcp/src/capture/daemon.ts:164` with a self-rescheduling `setTimeout` whose delay is the current backoff value. Backoff state is two `number`s closured in `startHandoffLoop`.

**Schedule:** base `10_000` ms → cap `300_000` ms. On failure, multiply by 2. On success, reset to base. Apply ±25% multiplicative jitter to each delay.

**Code shape (replaces `startHandoffLoop` body — `mcp/src/capture/daemon.ts:131-179`):**
```typescript
export function startHandoffLoop(a: HandoffLoopArgs): () => void {
  const pull_ms = a.pull_ms ?? 15000;
  const flush_ms = a.flush_ms ?? 10000;
  const hc_ms = a.healthcheck_ms ?? 10000;

  const BASE_DELAY = Math.min(pull_ms, flush_ms);  // 10s
  const MAX_DELAY = 300_000;                       // 5 min

  let stopped = false;
  let currentDelay = BASE_DELAY;
  let consecutiveFailures = 0;
  let nextTimer: NodeJS.Timeout | null = null;

  async function cycle(): Promise<boolean> {
    if (stopped) return true;
    let allOk = true;
    for (let i = 0; i < a.projects.length; i++) {
      const project_id = a.projects[i];
      try {
        const flush = await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        const effectiveId = flush.canonical_project_id ?? project_id;
        if (flush.canonical_project_id) a.projects[i] = flush.canonical_project_id;
        await runPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
        if (a.user_id) writeBrief(effectiveId, a.user_id);
      } catch (err) {
        console.error("[handoff] cycle error", project_id, err);
        allOk = false;
      }
    }
    return allOk;
  }

  async function scheduleNext() {
    if (stopped) return;
    const ok = await cycle();
    if (ok) {
      currentDelay = BASE_DELAY;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
    }
    const jitter = currentDelay * (0.75 + Math.random() * 0.5);  // ±25%
    nextTimer = setTimeout(scheduleNext, jitter);
  }

  // flush-now signal — unchanged; this stays a separate 100ms tick.
  const signalCheck = setInterval(async () => {
    if (fs.existsSync(flushNowSignalPath())) {
      try { fs.unlinkSync(flushNowSignalPath()); } catch {}
      await cycle();  // does NOT participate in backoff schedule; it's user-initiated
    }
  }, 100);

  const hcTimer = setInterval(() => {
    fs.mkdirSync(path.dirname(healthcheckPath()), { recursive: true });
    fs.writeFileSync(healthcheckPath(), new Date().toISOString());
  }, hc_ms);

  scheduleNext();  // kick off

  return () => {
    stopped = true;
    clearInterval(signalCheck);
    if (nextTimer) clearTimeout(nextTimer);
    clearInterval(hcTimer);
  };
}
```

**Why loop-scoped (not persisted) is correct:**
- `events.jsonl` is append-only on disk. `.watermark` only advances on full-batch success (`mcp/src/capture/handoff-sync.ts:67`). If the daemon process dies mid-backoff, restart goes back to base delay (10s) — that's *more* aggressive, not less, and is exactly the right behavior because process restart is itself evidence the previous state was lost.
- No risk of data loss: every event captured during a backoff window is preserved on disk and flushed when the next cycle succeeds.
- Avoids one new disk artifact in `~/.synapse/`.

**Jitter rationale:** Multiple daemons restarting simultaneously (e.g., after a backend deploy + reload) would otherwise sync up on the same multiple-of-10s schedule and create a thundering-herd retry pattern. ±25% jitter desynchronizes them. `[CITED: AWS Architecture Blog — Exponential Backoff and Jitter, 2015]` (referenced from CONTEXT.md `<specifics>`).

### Anti-Patterns to Avoid

- **DON'T pipe `launchctl print` output to detect running state.** Piping makes `$?` reflect the pipe terminator. Use `execSync` directly and rely on its throw-on-nonzero-exit behavior. Verified empirically (see §"BUG-02 LANDMINE").
- **DON'T parse `launchctl list` text output.** Apple's man page warns the format is not API. Use the `print gui/$UID/<label>` exit code instead. (Per D-08.)
- **DON'T write a new `deepMerge` library for BUG-04.** Use the existing `writeMcpJson` helper (`mcp/src/cli/editors/io.ts:98-112`) that already preserves unknown `mcpServers` entries via spread.
- **DON'T put Sentry middleware *after* CORS/rate-limit.** CORS rejection or rate-limit 429 should still be visible to Sentry. The Sentry middleware MUST be the very first `app.use`. `[CITED: https://github.com/getsentry/sentry-javascript/blob/master/packages/hono/README.md]` — "Initialize the Sentry Hono middleware as early as possible in your app."
- **DON'T forget that `app.onError` doesn't catch unhandled rejections inside `ctx.waitUntil(...)`.** The `scheduled` handler at `backend/src/index.ts:96-104` calls `ctx.waitUntil(runDailyAggregation(env))` and `ctx.waitUntil(runScheduledGoogleSync(env))` — those throws never hit `app.onError`. For Slice 1a we leave these alone (they're not the 1101 source), but `lib/observability.ts` should export a `reportError(err, env, ctx)` helper that does `ctx.waitUntil(Sentry.captureException(err))` for future use in cron paths. Slice 1b will add `Promise.allSettled` semantics to the events-batch path.
- **DON'T re-add backoff state to `runFlushCycle`.** Keep it loop-scoped in `startHandoffLoop`. The flush function should remain a pure "throw on non-2xx" surface so single-cycle calls (the `flush-now` signal path) aren't affected by backoff state.
- **DON'T persist backoff state to disk.** Process restart = base delay = correct (see "loop-scoped" rationale).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Capturing Worker exceptions | Custom error handler that POSTs to a webhook | `@sentry/hono/cloudflare` middleware | First-party SDK handles stack-trace symbolication, breadcrumb collection, transaction tracing, automatic context binding. Per D-04. |
| MCP-server entry config | Custom argv parser + new launcher binary | Existing `writeMcpJson` helper at `mcp/src/cli/editors/io.ts:98` | The helper already handles merge-if-exists; the wizard already calls it for Claude Code, Cursor, Windsurf. BUG-04 = "call this from runInit." |
| Daemon process detection | Custom `ps`-grep parser | `launchctl print gui/$UID/<label>` + `systemctl --user is-active` exit codes | The supervisors already know whether the process is alive. Re-implementing this is one Apple-API-change away from breaking silently. (Per D-08.) |
| JSON merge for `.mcp.json` | Write `deepMerge.ts` from scratch | Existing `writeMcpJson` shape — known schema, spread preserves unknown keys | Per `<specifics>` in CONTEXT.md: "preserve unknown server entries verbatim. The `synapse` entry key is the merge target; everything else is opaque pass-through." A spread does this. |
| Retry/backoff scheduling | Custom retry helper module | Inline `currentDelay = min(currentDelay * 2, cap) + jitter` | 8 LOC. A library would weigh more than the implementation. The schedule shape is locked by D-09; nothing to abstract. |

**Key insight:** Three of the five slice-1a items already have working helpers *in the codebase* that just need to be wired up (the existing `writeMcpJson` for BUG-04; the install-side launchd/systemd pattern from `os-service.ts` for BUG-02; the hook-command resolver pattern from `init.ts:resolveBin()` for BUG-03). This is "wire it up correctly," not "design from scratch."

## Runtime State Inventory

> Phase 1 slice 1a is overwhelmingly greenfield-additive: it ADDS code (Sentry, new helpers) and rewires `isRunning`/`startHandoffLoop` in-place. **Two items** in the existing inventory matter:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no rename, no schema migration in this slice. `events.jsonl`, `.watermark`, `config.json` formats unchanged. | None |
| Live service config | launchd `app.synapsesync.daemon` plist is already installed on this dev machine (verified: `launchctl print gui/502/app.synapsesync.daemon` → exit 0, active count 1, plist path `/Users/Tanmai.N/Library/LaunchAgents/app.synapsesync.daemon.plist`). | None — BUG-02 reads from the already-installed plist; no re-install needed |
| OS-registered state | The launchd label `app.synapsesync.daemon` is hard-coded in `mcp/src/capture/os-service.ts:26`. The new BUG-02 helper MUST use the **same label**. | New `daemon-supervisor.ts` imports the label from a shared constant (or pulls it from `os-service.ts`'s plist template). DO NOT re-define it. |
| Secrets/env vars | `SENTRY_DSN` is a NEW Worker secret. Must be set via `wrangler secret put SENTRY_DSN` AFTER the binding is declared in `wrangler.jsonc` (or in `vars` for non-secret local-dev with `.dev.vars`). | Slice 1a authors the binding declaration. Slice 1b sets the actual secret via `wrangler secret put` before deploy. |
| Build artifacts | `mcp/dist/` is regenerated on each build. The BUG-03 resolver depends on `dist/index.js` being on disk at runtime — which it always is for an installed package. | None — but if a developer runs the resolver in source-mode (`tsx` etc.) before `npm run build`, the dist path won't exist and the resolver will fall through to `npx`. Document this. |

**Nothing found in category:** None — every category has an answer.

## Common Pitfalls

### Pitfall 1: `launchctl print` exit code masked by piping
**What goes wrong:** A test or shell wrapper does `launchctl print gui/$UID/<label> | grep pid` and reads `$?` to decide "running or not." `$?` is `grep`'s exit code, not `launchctl`'s. Always 0 if grep finds the line, 1 if not — completely uncorrelated with launchctl's signal.
**Why it happens:** Bash exit-code semantics on pipelines. Without `set -o pipefail`, only the last command's exit code propagates.
**How to avoid:** Use Node's `execSync` (which gets the real exit code via its own waitpid call) without piping. If a shell pipe is unavoidable, set `pipefail` and capture `${PIPESTATUS[0]}`. The recommended `daemon-supervisor.ts` approach uses `execSync` and try/catch — the right shape.
**Warning signs:** Test passes locally ("daemon shows running") but the unit test claiming "missing service is detected as stopped" passes accidentally because both code paths return the same answer.

### Pitfall 2: Sentry SDK silently no-ops when DSN is missing
**What goes wrong:** Authoring Sentry init code without first declaring `SENTRY_DSN` in `wrangler.jsonc` → SDK initializes with `dsn: undefined` → all `captureException` calls are queued and dropped. Observability *looks* on but isn't.
**Why it happens:** Sentry's design intentionally degrades gracefully (no DSN = no transport) to keep local dev quiet. The cost is a silent failure mode.
**How to avoid:** Per D-05, the `SENTRY_DSN` env binding lands in `wrangler.jsonc` BEFORE the SDK init code is merged. Add a startup log in `lib/observability.ts` — e.g., `if (!env.SENTRY_DSN) console.warn("[observability] SENTRY_DSN unset — Sentry disabled")` — so the silent-mode is at least visible in Workers logs.
**Warning signs:** Slice 1b's SC#4 verification (deliberate throw → Sentry event within 1 min) fails after deploy. Workers Observability logs will show the deliberate throw; Sentry dashboard will show nothing. That's the DSN miss.

### Pitfall 3: `npx synapsesync` succeeds on the dev's machine and fails on a user's
**What goes wrong:** The developer runs the wizard, sees `command: "npx", args: ["synapsesync"]` written to `.mcp.json`, restarts Claude Code, and the MCP server starts cleanly — because the dev has `synapsesync` cached in `~/.npm/_npx/` already. The user on Netskope's corp network hits `403 Forbidden` from `registry.npmjs.org` and the MCP server fails silently. The user thinks "Synapse is broken" with no actionable error.
**Why it happens:** `npx` resolves cached packages before reaching the registry. Local dev paths look identical to a cold-laptop scenario, but aren't.
**How to avoid:** The BUG-03 resolver prefers absolute paths *unconditionally*. Even on a non-proxy network where `npx` would work, the absolute path is more reliable. Per D-11, only fall back to `npx` if neither `which synapsesync` nor `dist/index.js` resolution works.
**Warning signs:** Cold-laptop test (LAUNCH-03 in slice 1b / Phase 5) on a network without npx-cached synapsesync. Or: a user reports "MCP server not connecting" with no other symptoms.

### Pitfall 4: Daemon backoff masks a real outage by capping at 5min
**What goes wrong:** Backend is down for 30+ minutes. Daemon backs off to 5min cap. User runs `synapse capture status`, sees "Daemon: running" with no recent errors, has no signal that flushes are failing.
**Why it happens:** Backoff is correct mitigation for log spam but creates a "looks healthy, isn't" surface.
**How to avoid:** Out of scope for slice 1a (D-10 explicitly defers log rotation/health surfacing). BUT: `synapse capture status` could optionally read `daemon.log`'s recent lines and surface "Last successful flush: <timestamp>; current backoff: <delay>." Recommend adding this as a discretionary refinement to BUG-02's status display.
**Warning signs:** None during slice 1a — this only shows up post-deploy in slice 1b when backend recovers from a long outage and user data appears delayed by an hour.

### Pitfall 5: `process.getuid` is undefined on Windows
**What goes wrong:** `process.getuid()` is Unix-only. On Windows it's `undefined`, and calling it throws `TypeError`. The BUG-02 helper uses `process.getuid?.() ?? 0` for that reason — but the launchctl path itself doesn't run on Windows.
**Why it happens:** Cross-platform asymmetry between launchd/systemd and Windows Service Control Manager.
**How to avoid:** Branch on `process.platform` *first*. On `win32`, skip directly to the tier-2 PID-file fallback. Windows daemon support is explicitly partial per STACK.md §"Platform Requirements." Document the Windows behavior as "PID-file only; supervisor-aware detection lands when SCM support lands."
**Warning signs:** A Windows user runs `synapse capture status` and gets a thrown error.

## Code Examples

### Verified — `app.use(sentry(...))` with env callback (Cloudflare)

```typescript
// Source: https://github.com/getsentry/sentry-javascript/blob/master/packages/hono/README.md
// (verbatim, accessed 2026-05-19)
import { Hono } from 'hono';
import { sentry } from '@sentry/hono/cloudflare';

type Bindings = { SENTRY_DSN: string };

const app = new Hono<{ Bindings: Bindings }>();

app.use(sentry(app, env => ({ dsn: env.SENTRY_DSN })));

export default app;
```

### Verified — `beforeSend` filtering pattern

```typescript
// Source: https://docs.sentry.io/platforms/javascript/configuration/filtering/
// (canonical pattern from Sentry docs; we extend it to strip event.extra.payload
//  rather than event.user.email)
Sentry.init({
  dsn: "___PUBLIC_DSN___",
  beforeSend(event) {
    if (event.user) {
      delete event.user.email;
    }
    return event;
  },
});
```

### Verified — `fs.mkdtempSync` + `SYNAPSE_HOME` override (existing test pattern)

```typescript
// Source: mcp/test/capture/handoff-sync.test.ts:7-16 (in-repo, verified)
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-sync-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});
```

### Verified — `vi.useFakeTimers` + `advanceTimersByTimeAsync` (existing test pattern)

```typescript
// Source: mcp/test/unit/browser-auth.test.ts:114-123 (in-repo, verified)
vi.useFakeTimers();
// ... start the async operation ...
await vi.advanceTimersByTimeAsync(120_001);
// ... assert post-timer state ...
```

This is exactly the pattern the BUGS.md #12 backoff test needs: stub `fetch` to throw, run `scheduleNext` once, advance the fake clock by N seconds, verify backoff doubled, advance again, verify capped at 300s.

### Verified — Existing `writeMcpJson` shape (no changes needed for BUG-04 merge)

```typescript
// Source: mcp/src/cli/editors/io.ts:98-112 (in-repo, verified)
export function writeMcpJson(filePath: string, apiKey: string): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }
  }
  existing.mcpServers = {
    ...((existing.mcpServers as Record<string, unknown>) || {}),  // ← preserves other servers
    synapse: synapseMcpServer(apiKey),                            // ← only synapse entry updated
  };
  fs.writeFileSync(filePath, `${JSON.stringify(existing, null, 2)}\n`);
}
```

The spread on line 4 already implements the merge-if-exists semantics D-01 calls for. BUG-04 only needs to add `writeMcpJson(path.join(process.cwd(), ".mcp.json"), a.api_key)` inside `runInit` (between `writeConfig` and `writeServiceFile`).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `toucan-js` for Workers Sentry | `@sentry/cloudflare` + `@sentry/hono` | toucan archived 2026-01-12 | First-party SDK gets release-binding, source-maps, breadcrumbs out of the box |
| Parsing `launchctl list` text output | `launchctl print gui/$UID/<label>` exit code | Apple has warned about `list` format being unstable for >5 years | Symmetric with systemd's `is-active`; both rely on exit code |
| `setInterval(cycle, fixed)` retry loop in daemon | `setTimeout` with self-rescheduling + exponential backoff + jitter | Industry-standard since AWS 2015 jitter post | Stops thundering-herd on backend recovery |
| `npx <package>` in MCP configs | Resolve to absolute `node + dist/index.js` path | Corporate-proxy reality (Netskope, ZScaler) makes `npx` unreliable | Cold-laptop installs work on locked-down networks |

**Deprecated/outdated:**
- `toucan-js` (last release 2024-12; archived 2026-01-12). Do not use.
- The `process.kill(pid, 0)` PID-file-only daemon-detection path stays as fallback but is **insufficient as the primary** mechanism since launchd-supervised daemons never write `~/.synapse/capture.pid`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Latest `@sentry/hono` version (couldn't query via proxy) | Standard Stack | LOW — when planner runs `npm install --save @sentry/hono` from a clean network, npm picks latest; we just don't have the exact version string in research. Planner adds `checkpoint:human-verify` per Package Legitimacy Audit. |
| A2 | The `app.use(sentry(app, ...))` middleware *automatically* covers errors thrown into `app.onError` and we do not need an additional `Sentry.captureException` call inside `onError` | OBS-01 wiring | MEDIUM — Sentry's Hono docs are explicit that the middleware captures errors, but the BETA label on `@sentry/hono` means coverage of all error paths is not 100% guaranteed. **Mitigation:** add `Sentry.captureException(err)` defensively inside `app.onError` as a belt-and-suspenders. It's idempotent if the middleware already captured. Slice 1b's SC#4 verifies the end-to-end. |
| A3 | The `daemon-cc.profile.json` reload behavior is unaffected by the new `setTimeout`-based loop in `startHandoffLoop` | BUGS.md #12 | LOW — the `flush-now` signal path stays a separate `setInterval(_, 100)` polling loop; it doesn't participate in backoff. The healthcheck timer also stays separate. The new code preserves both. |
| A4 | The launchd label `app.synapsesync.daemon` from `os-service.ts:26` is the canonical label everywhere (no other label is in use) | BUG-02 | LOW — grep confirms only `os-service.ts` defines it; importing from there into `daemon-supervisor.ts` keeps a single source of truth. |
| A5 | `process.execPath` returns an absolute path consistent with the running node (true on macOS/Linux dev installs; documented behavior) | BUG-03 | LOW — already trusted by the install-side resolver at `mcp/src/cli/init.ts:21` and `mcp/src/capture/os-service.ts:124`. |
| A6 | A 2-second `fetch("https://registry.npmjs.org/-/ping")` is sufficient to detect proxy blockage | BUG-03 | LOW — corporate proxies typically return 403 or 502 fast; pure DNS blackholes take longer but 2s is enough to disambiguate "Netskope blocks" from "slow but working." Tunable if needed. |

**This list is short by design.** The decisions in CONTEXT.md are locked, and most claims in this research are verified against in-repo code or canonical Sentry docs. The planner should treat A2 as the highest-priority assumption to validate during slice 1b's SC#4 deliberate-throw test.

## Open Questions

1. **Should `Sentry.captureException` be added inside `app.onError` as belt-and-suspenders?**
   - What we know: `@sentry/hono` middleware auto-captures errors thrown from Hono routes (`[CITED: https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/hono/]`).
   - What's unclear: whether the middleware *also* sees errors that pass through `app.onError`'s rebranding to a JSON 500 response (i.e., does the middleware intercept *before* or *after* `app.onError` runs?).
   - Recommendation: add a defensive `Sentry.captureException(err)` inside the non-AppError branch of `app.onError` (`backend/src/index.ts:55`). Cost: 1 LOC + 1 import. Benefit: guaranteed capture even if BETA SDK behaves unexpectedly. Slice 1b's SC#4 will tell us if it was needed.

2. **Where should `SENTRY_DSN` go — `vars` or as a `wrangler secret`?**
   - What we know: `wrangler.jsonc:33-37` explicitly comments that secrets must NOT live in `vars` (they get zeroed on deploy).
   - What's unclear: is a Sentry DSN considered a secret? It's not high-value (it identifies a project, doesn't authenticate writes beyond rate limits), but Sentry's docs recommend treating it as a secret.
   - Recommendation: declare the binding name in code (e.g., expose `SENTRY_DSN` on the `Env` type in `backend/src/lib/env.ts`), and set the value via `wrangler secret put SENTRY_DSN` in slice 1b's deploy task. Slice 1a author keeps the literal DSN out of git.

3. **Does the BUG-03 resolver need to be async?**
   - What we know: `execSync` is synchronous; `fs.existsSync` is sync; the only async piece is the proxy ping.
   - What's unclear: do we actually need the proxy ping in the resolver, or only in the wizard's outro/warning surface?
   - Recommendation: the resolver itself is sync. The proxy probe is called *separately* by the wizard to decide *whether to warn* — not to gate the resolution. Sync resolver is simpler, faster, and doesn't propagate `async` through the existing editor adapters.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `launchctl` (macOS) | BUG-02 | ✓ | macOS-bundled | PID-file path (tier-2) |
| `systemctl --user` (Linux) | BUG-02 (Linux only) | ✗ on this dev machine | — (macOS host) | PID-file path. Code lands; verification deferred per D-13. |
| `which` (POSIX) | BUG-03 | ✓ | system-bundled | `where` on Windows |
| `node` ≥ 22 (for `process.execPath`) | BUG-03, all daemon paths | ✓ | matches `mcp/package.json:39` `@types/node ^22` | n/a — already required |
| `https://registry.npmjs.org/-/ping` reachable | BUG-03 (proxy probe) | ✓ on local dev (no Netskope today) | n/a | Whole BUG-03 *exists* to handle the case when this fails |
| `wrangler` CLI | OBS-01 deploy + SENTRY_DSN secret | ✗ on this device (corporate proxy + intentional separation) | — | **Slice 1b on the CF machine.** Per phase boundary. |
| Cloudflare Worker runtime | OBS-01 deploy | ✗ this device cannot deploy | n/a | Slice 1b |
| Existing launchd plist for `app.synapsesync.daemon` | BUG-02 manual verification | ✓ on this machine (verified 2026-05-19: active count 1) | — | n/a |

**Missing dependencies with no fallback:**
- None for slice 1a — all five items have either tooling on hand or test infrastructure (vitest + tmpdir + mocked execSync) to verify without the missing piece.

**Missing dependencies with fallback:**
- `systemctl` on Linux: code lands, manual verification on a Linux box deferred per D-13. Tests for the Linux path use mocked `execSync`.
- `wrangler deploy`: explicit slice 1b owner.

## Validation Architecture

> `workflow.nyquist_validation` is not explicitly disabled in `.planning/config.json` — treating as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x (mcp: 4.1.2; backend: 4.1.0; `[VERIFIED: backend/package.json:30, mcp/package.json:41]`) |
| Config file (mcp) | `mcp/vitest.config.ts` |
| Config file (backend) | `backend/vitest.config.ts` (uses `@cloudflare/vitest-pool-workers`) |
| Quick run command (mcp) | `cd mcp && npx vitest run test/cli/init.test.ts test/cli/status.test.ts test/capture/handoff-sync.test.ts test/capture/daemon.test.ts` |
| Quick run command (backend) | `cd backend && npx vitest run test/lib/observability.test.ts` (new file) |
| Full suite command | `npm run test` from repo root (runs every workspace; ~25-30s with pre-push hook overhead) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUG-02 | `DaemonManager.isRunning()` returns `true` when launchd reports the label is loaded (mock execSync) | unit | `cd mcp && npx vitest run test/cli/status.test.ts` | ✅ (extend existing) |
| BUG-02 | `DaemonManager.isRunning()` returns `false` when `launchctl print` throws (service not loaded) | unit | same command | ✅ |
| BUG-02 | `DaemonManager.isRunning()` falls back to PID-file check on non-supervisor platforms | unit | same command | ✅ |
| BUG-02 (manual) | Real launchd-supervised daemon shows "Daemon: running" via `synapse capture status` | manual | n/a | n/a — local-only validation |
| BUG-03 | `resolveSynapseMcpCommand` returns absolute bin path when `which synapsesync` succeeds (mock execSync) | unit | `cd mcp && npx vitest run test/cli/mcp-command.test.ts` | ❌ Wave 0 |
| BUG-03 | `resolveSynapseMcpCommand` returns `node <abs>/dist/index.js` shape when `which` fails but dist exists | unit | same command | ❌ Wave 0 |
| BUG-03 | `resolveSynapseMcpCommand` returns `npx synapsesync` last-resort when neither resolves | unit | same command | ❌ Wave 0 |
| BUG-03 | `probeNpmRegistry` returns false on 2s timeout (mock fetch) | unit | same command | ❌ Wave 0 |
| BUG-03 (manual) | Cold-laptop wizard run on Netskope produces a working `.mcp.json` | manual | n/a | Slice 1b — deferred per CONTEXT.md `<deferred>` |
| BUG-04 | `runInit` writes a new `.mcp.json` in cwd with the synapse server entry | integration | `cd mcp && npx vitest run test/cli/init.test.ts` | ✅ (extend) |
| BUG-04 | `runInit` merges into an existing `.mcp.json` preserving other server entries | integration | same command | ✅ (extend) |
| BUG-04 | `runInit` corrupts → backs up → rewrites for an invalid existing `.mcp.json` | integration | same command (already covered by existing `writeMcpJson` paths) | ✅ (extend) |
| OBS-01 | `scrubPayload` removes `event.extra[k].payload` from synapse-shaped event objects | unit | `cd backend && npx vitest run test/lib/observability.test.ts` | ❌ Wave 0 |
| OBS-01 | `scrubPayload` preserves stack traces and request metadata | unit | same command | ❌ Wave 0 |
| OBS-01 | `scrubPayload` returns the same event when no synapse-shaped data is attached | unit | same command | ❌ Wave 0 |
| OBS-01 (smoke) | `backend/src/index.ts` imports `sentry` from `@sentry/hono/cloudflare` and `app.use` is wired before CORS | unit (string-match on built source OR module-level test) | `cd backend && npx vitest run test/lib/observability-wiring.test.ts` | ❌ Wave 0 |
| OBS-01 (deploy verify) | Deliberate throw at events-batch produces a Sentry event within 1 min | manual + production | Slice 1b SC#4 | Slice 1b |
| BUGS.md #12 | Backoff starts at base delay (10s) | unit | `cd mcp && npx vitest run test/capture/daemon-backoff.test.ts` | ❌ Wave 0 |
| BUGS.md #12 | Backoff doubles on each failure | unit | same command | ❌ Wave 0 |
| BUGS.md #12 | Backoff caps at MAX_DELAY (300s) | unit | same command | ❌ Wave 0 |
| BUGS.md #12 | Backoff resets to base on first success | unit | same command | ❌ Wave 0 |
| BUGS.md #12 | Jitter is within ±25% of the current delay | unit (assert range) | same command | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd <touched-workspace> && npx vitest run <changed-test-files>` — under 5 seconds for any single test file.
- **Per wave merge:** `npm run test` from repo root — runs every workspace (~25-30s including pre-push hook lint + typecheck).
- **Phase gate (slice 1a):** Full suite green before merging. Slice 1b adds its own gate (SC#4 deliberate-throw verification on production).

### Wave 0 Gaps
- [ ] `mcp/test/cli/mcp-command.test.ts` — covers BUG-03 (resolver branches + proxy probe). New file.
- [ ] `backend/test/lib/observability.test.ts` — covers OBS-01 `scrubPayload` filtering. New file.
- [ ] `backend/test/lib/observability-wiring.test.ts` — verifies `sentry()` middleware is the first `app.use` in `backend/src/index.ts`. New file. (Defensive — guards against future refactors that move it.)
- [ ] `mcp/test/capture/daemon-backoff.test.ts` — covers BUGS.md #12 backoff schedule using `vi.useFakeTimers`. New file.
- [ ] Extend `mcp/test/cli/init.test.ts` — add tests for BUG-04 (new + merge + corrupt paths).
- [ ] Extend `mcp/test/cli/status.test.ts` — add tests for BUG-02 (launchd / systemd / pid-file branches with mocked `execSync`).
- [ ] Framework install: none — vitest is already wired in both workspaces.

*Existing test infrastructure covers all phase requirements except the test files listed above. No new framework setup needed.*

## Security Domain

> `security_enforcement` is not explicitly disabled in `.planning/config.json`. Including this section.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | This slice does not touch auth surfaces. `synapse init` writes the API key into `~/.synapse/config.json` only via paths that already exist (`mcp/src/cli/init.ts:160-170`). |
| V3 Session Management | no | No session surfaces touched. |
| V4 Access Control | no | No new access-control logic. The `.mcp.json` in cwd may include the API key — this is **existing** behavior already gitignored by `ensureGitignore(cwd, ".mcp.json")` at `mcp/src/cli/editors/claude-code.ts:9`; new BUG-04 path must also call `ensureGitignore`. |
| V5 Input Validation | yes | `scrubPayload`'s output is consumed by Sentry as-is — must not be mutable by attacker input. Achieved by allowlist (`SAFE_EVENT_KEYS`) rather than blocklist. |
| V6 Cryptography | no | No new crypto. Existing `hashApiKey` etc. unchanged. |
| V7 Error Handling & Logging | yes | OBS-01 is squarely V7. `beforeSend` must scrub PII *before* Sentry transports the event. Logged stack traces should not include user prompt/response strings. |
| V13 API & Web Service | partial | Sentry middleware sits in the request path. Must not increase the rate-limit-bypass surface or attach the auth bearer to events. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PII leakage in error reports | Information Disclosure | `beforeSend` allowlist scrubs `event.extra.<key>.payload`, `event.breadcrumbs[*].data.payload`, and `event.request.data` (the Hono request body). Per D-07. |
| API key leaking into Sentry event metadata | Information Disclosure | The auth bearer is in the `Authorization` header. Sentry's default Hono request capture excludes headers by default (`sendDefaultPii: false`). Verify this explicitly in `lib/observability.ts` init options. |
| `.mcp.json` written with API key, committed to git | Information Disclosure | BUG-04 must `ensureGitignore(cwd, ".mcp.json")` (mirroring `claude-code.ts:9`). The helper already exists in `editors/io.ts:124-133`. Failure mode: a developer using `synapse init --api-key X` in a clean repo accidentally commits the key. **Test must verify the gitignore entry is written.** |
| Sentry DSN exposed in client | Information Disclosure | DSN lives in Worker env (`SENTRY_DSN`), never in frontend bundle. The Workers DSN identifies the Sentry project but does not grant write access beyond rate limits — still treat as a moderate secret. |
| Malicious launchctl/systemctl output triggers RCE in pid-parse | Injection | The PID regex `/^\s*pid\s*=\s*(\d+)/m` only accepts decimal digits; `Number(m[1])` produces a number, never executes anything. No shell escape needed because we pass argv arrays to execSync (not shell strings) — except we currently use shell-style `launchctl print gui/${uid}/${LABEL}`. **The LABEL is a hard-coded constant; UID is from `process.getuid()` which is a system call result, not user input.** No injection surface. |
| `which synapsesync` output injection | Injection | `which` stdout is read via `execSync.encoding: "utf-8"` and used as a path string. If a malicious user has `synapsesync` shadowing on PATH, they could make us spawn an arbitrary binary — but they could just as easily run that binary directly. Same trust model as the existing `process.argv[1]` resolution at `mcp/src/cli/init.ts:22`. No new surface. |
| Backoff makes DoS amplification harder to detect | Repudiation (sort of) | Loop-scoped backoff caps total client-side request volume at ~12 requests/hour during a sustained outage. This is a defensive property, not a new threat. |

**No new attack surfaces** introduced by slice 1a. The `wrangler.jsonc` SENTRY_DSN binding adds one new secret to the Worker secrets inventory; otherwise the change set is read-only with respect to security boundaries.

## Sources

### Primary (HIGH confidence)
- **Sentry Hono SDK README** — `https://github.com/getsentry/sentry-javascript/blob/master/packages/hono/README.md` — fetched raw 2026-05-19 — verbatim init shape with env callback for Cloudflare Workers, install steps for both `@sentry/hono` and `@sentry/cloudflare` peer dep.
- **Sentry Cloudflare guide** — `https://docs.sentry.io/platforms/javascript/guides/cloudflare/` — `nodejs_compat` requirement, `withSentry` wrapper signature, `ctx.waitUntil` + Sentry spans pattern, source-map upload via `upload_source_maps: true` (deferred to slice 1b).
- **Sentry filtering docs** — `https://docs.sentry.io/platforms/javascript/configuration/filtering/` — `beforeSend(event, hint): Event | null` signature confirmation.
- **In-repo code** — `mcp/src/cli/editors/io.ts:98-112` (existing `writeMcpJson` merge-if-exists implementation), `mcp/src/capture/os-service.ts:26,113-116` (existing launchd label + dist-entry resolver pattern), `mcp/src/capture/daemon.ts:131-179` (existing `startHandoffLoop` shape), `mcp/test/capture/handoff-sync.test.ts:7-16` (tmpdir test pattern), `mcp/test/unit/browser-auth.test.ts:114-123` (fake timers pattern), `backend/src/index.ts:28-65` (current Hono app + middleware chain).
- **Empirical verification on this device, 2026-05-19** — `launchctl print gui/502/app.synapsesync.daemon` → exit 0, active count 1; `launchctl print gui/502/com.nonexistent.fake.service` → exit 113. Confirms D-08's exit-code mechanism.
- **`npm view @sentry/cloudflare`** — version 10.53.1, created 2024-07-31, repository `getsentry/sentry-javascript`, license MIT, no postinstall script.

### Secondary (MEDIUM confidence)
- **Sentry Hono+Cloudflare guide** — `https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/hono/` — landing page; redirects to the Hono Quick Start. Confirms `@sentry/hono` is the canonical Hono path.
- **launchctl `gui/<uid>` domain semantics** — Apple Developer Forums + SS64 reference — `[CITED: https://ss64.com/mac/launchctl.html]` for the GUI domain definition.
- **systemctl is-active exit codes** — freedesktop.org systemctl man page + GitHub issue threads — exit 0 = at least one active; states include `active|inactive|activating|deactivating|failed|unknown`.
- **MCP `.mcp.json` schema** — Anthropic Claude Code docs + community references — confirms `mcpServers.<name>.{command, args, env}` shape used by `synapseMcpServer` already.

### Tertiary (LOW confidence)
- **Latest `@sentry/hono` published version** — `npm view @sentry/hono` was blocked by corporate proxy (403 from `pkgproxy-uat.coinswitch.co/npm/@sentry%2fhono`). Version pin should be re-verified on a non-proxied network before commit. Flagged as A1 in Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Sentry packages verified on npm; `@sentry/hono` README read verbatim from getsentry's monorepo.
- Architecture (Sentry middleware ordering, `beforeSend`, `app.onError` interaction): MEDIUM-HIGH — SDK docs are clear on middleware-must-be-first; less clear on the exact interception order with `app.onError`. A2 in Assumptions Log captures this.
- Daemon detection (BUG-02): HIGH — verified empirically on this machine + mirrors install-side pattern that already works.
- MCP command resolver (BUG-03): HIGH — pure stdlib pattern matching the existing `resolveBin()` shape at `mcp/src/cli/init.ts:20-29`.
- `.mcp.json` merge (BUG-04): HIGH — the helper already exists and is verified by reading `io.ts:98-112` directly.
- Daemon backoff (BUGS.md #12): HIGH — closure-scoped state pattern with `setTimeout` is standard; `vi.useFakeTimers` test pattern verified in-repo at `browser-auth.test.ts:114`.
- Pitfalls: HIGH — Pitfall 1 (pipe exit code) was empirically discovered during this research (initial pipe-based exit check returned 0 for a missing service; rerunning without pipe returned 113).

**Research date:** 2026-05-19
**Valid until:** 2026-06-18 (30 days; Sentry SDKs are stable but @sentry/hono is BETA — re-verify before any pin update)
