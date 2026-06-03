# Stack Research — Stabilize-for-launch milestone

**Domain:** AI coding session capture & handoff tooling (Synapse) — additive libraries on top of existing Cloudflare Workers + SvelteKit + Supabase stack
**Researched:** 2026-05-19
**Confidence:** HIGH for Sentry, Tail Worker, Resend; MEDIUM for Supabase Queues (newer); HIGH for daemon detection (stdlib + already-shipped subprocess pattern)

This document covers ONLY net-new libraries / patterns for the four milestone feature areas. The existing stack (Hono 4.12.8, Wrangler 4.75, Cloudflare Workers `nodejs_compat`, SvelteKit 2.55, Svelte 5.54, Tailwind 4.2, Supabase JS 2.99.2, Supabase SSR 0.9.0, Vitest 4.1, Biome 1.9.4, zod 4.3.6, MCP SDK 1.27.1) is documented in `.planning/codebase/STACK.md` and is reused as-is.

---

## Telemetry — REQ-MEASURE-01/02/03

Brief-quality thumbs Y/N + daemon-emitted timestamps for time-to-context, persisted server-side and surfaced on the dashboard.

### Recommended

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Event transport | **Existing handoff event pipeline** (`EventKind.BriefRated`, `EventKind.BriefRendered`, `EventKind.FirstNonOrientationPrompt`) | — | Idempotent ULID-keyed batch endpoint already exists; reducer already folds events into `ProjectStatus`. Adding two new `EventKind`s costs ~30 LOC in `packages/shared/src/handoff/events.ts` and `reducer.ts`. Zero new infra. |
| Daemon-side rating capture | **Slash command `/synapse-rate` writing a `BriefRated` event** via `appendEvent` | — | Mirrors the existing `/synapse-handoff` pattern (`mcp/src/cli/handoff-commands.ts`). User types `/synapse-rate y` or `/synapse-rate n` → CLI shells out → event appended → daemon flushes within 10s. No new persistence layer. |
| Auto-detect "first non-orientation prompt" | **In-process check in `mcp/src/hooks/user-prompt-submit.ts`** — first `UserPromptSubmit` after a `SessionOpened` where the prompt is not the prefilled brief reference | — | The hook already runs on every prompt; adding a "session has emitted FirstNonOrientationPrompt yet?" cache file in `~/.synapse/projects/<id>/cache/` is cheap. |
| Dashboard chart rendering | **`layerchart` 2.x** (Svelte 5 native) **OR** native SVG with derived runes | layerchart `^2.0.0` | Svelte-5-native chart lib actively maintained for runes. Light alternative: hand-rolled SVG (the milestone only needs a sparkline of rating-rate + a median-bar — both are 30 LOC of SVG). Prefer hand-rolled given the 5-day window — it removes one dep, one tailwind/CSS shim, one Vitest mock. |
| Dashboard data shape | **`/api/projects/:id/telemetry`** Hono route returning aggregated counts from `handoff_events` filtered by the two new `EventKind`s | — | Reuses `dbMiddleware` and the auth pattern of every other `/api/projects/:id/*` endpoint. No new table needed for v1 — `handoff_events` already has the right shape and `event_id` ULID makes time-range queries fast. |

### Integration sketch

```
packages/shared/src/handoff/events.ts
  + EventKind.BriefRendered          // emitted by daemon when brief.md is written
  + EventKind.FirstNonOrientationPrompt   // emitted by user-prompt-submit hook
  + EventKind.BriefRated             // emitted by /synapse-rate slash command

packages/shared/src/handoff/reducer.ts
  + fold BriefRated into status.recent_ratings[] (last 20)
  + fold (BriefRendered.occurred_at, FirstNonOrientationPrompt.occurred_at) pairs
    into status.recent_time_to_context_ms[] (last 20)

mcp/src/cli/handoff-commands.ts
  + runRateCmd(args)  // "y"|"n" → appendEvent + signalFlush

mcp/src/cli/init.ts
  + SLASH_COMMANDS entry: "rate.md" → "synapse rate \"$ARGUMENTS\""

mcp/src/hooks/session-start.ts
  + on brief emission, appendEvent({ kind: BriefRendered, payload: { brief_hash } })

mcp/src/hooks/user-prompt-submit.ts
  + once per session, if brief was the previous turn and current prompt
    does not contain "<synapse-brief>" reference text, append FirstNonOrientationPrompt

backend/src/api/telemetry.ts   (new)
  + GET /api/projects/:id/telemetry → { ratings: {y, n, recent_rate}, ttc: {p50, p90, samples} }

frontend/src/routes/(app)/projects/[name]/+page.server.ts
  + load telemetry alongside existing project status
frontend/src/lib/components/telemetry/  (new)
  + RatingTrend.svelte (Svelte 5 runes, hand-rolled SVG sparkline)
  + TimeToContext.svelte
```

### Alternatives Considered

| Recommended | Alternative | Why Not |
|---|---|---|
| Events-as-telemetry via existing pipeline | New `telemetry_events` table + dedicated endpoint | Doubles the write path. Adds another idempotency/dedup story. No real benefit; rating count over a month is < 1k rows per user. |
| Hand-rolled SVG sparklines | `layerchart`, `chartjs-plugin-svelte`, `echarts` | Bundle size + Svelte 5 runes compat churn. Two sparkline + one bar = ~60 LOC SVG. Faster to ship in a 5-day window. |
| Slash command `/synapse-rate` for the rating | Inline thumbs UI in the brief itself | Claude Code injection is plaintext stdin → cannot render interactive UI in the brief. A slash command + visible affordance in the brief footer ("Type `/synapse-rate y` or `/synapse-rate n`") is the only fit. |
| Auto-detected time-to-context | User-specified marker | Auto is more honest — it measures actual recovery speed without user discipline. |

### What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| PostHog / Mixpanel / Amplitude SDKs in the worker | Adds a network dep, leaks telemetry to a 3rd party for what is fundamentally project-scoped data. CSP / corporate-network risk. | Self-hosted on `handoff_events` via the existing pipeline. |
| Adding a `ratings` column to `handoff_project_status.status` | Status is a derived projection — recomputed from events on every batch. Anything written there directly will be overwritten. (See `ARCHITECTURE.md` anti-pattern "Imperatively mutating ProjectStatus".) | New `EventKind` + fold in `reduce()`. |
| Chart.js | Canvas-based; harder to style with Tailwind; not Svelte 5 runes-aware. | Hand-rolled SVG or `layerchart`. |

---

## Waitlist Throttle — REQ-LAUNCH-01/02

Public signups queued at `synapsesync.app`, batches granted access manually (or by admin button), email sent on grant.

### Recommended

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Persistence | **New Supabase table `waitlist_signups`** (id, email, source, status enum `queued`|`granted`|`rejected`, queued_at, granted_at, notified_at, granted_by) | — | Lightest possible. Supabase Queues (pgmq) is overkill for a list that's read once per "grant batch" and never auto-processed. A table + status enum gives you the dashboard view for free. |
| Public signup endpoint | **SvelteKit form action** at `/+page.server.ts` (landing) calling backend `POST /api/waitlist/signup` | — | Mirrors existing pattern — frontend form actions call backend endpoints via `lib/server/api.ts`. CAPTCHA-less for v1; add Cloudflare Turnstile post-launch if abused. |
| Admin grant UI | **Existing dashboard `(app)/admin/` shell** + a new `waitlist/+page.svelte` listing queued signups with checkbox + "Grant selected" button | — | `backend/src/api/admin.ts` already gates by `ADMIN_SECRET` env (`env.ts:1-49`). One new admin endpoint `POST /api/admin/waitlist/grant` that takes an array of IDs. |
| Email transport | **Resend `^6.12.3`** via HTTPS API (no SMTP), called from the Worker | resend 6.12.3 (npm published ~12 days ago, ESM, Workers-compatible — uses `fetch()` under the hood) | Workers can't open TCP sockets so SMTP is out. Resend has clean DX, React Email template support, predictable deliverability, and pricing covers free-tier launch volume (3k/month free). Alternative `env.EMAIL.send()` (Cloudflare Email Sending) is in public beta as of 2026-04-16 — too new for a launch-this-week milestone. |
| Email template | **Plain HTML string in `backend/src/lib/email/waitlist-granted.ts`** | — | One email template, ~30 lines of inline HTML. React Email is overkill for one transactional message. Revisit when template count > 3. |
| Grant trigger | **Manual admin button** (`POST /api/admin/waitlist/grant`) sending Resend immediately and flipping row state in one transaction | — | The milestone explicitly says "granted in controlled batches" — manual is the requirement. No cron, no queue worker, no Durable Object alarm. |
| Auth gating after grant | **Existing Supabase email-OTP / magic link signup flow** | — | Granting flips `status = 'granted'` and the email contains the magic-link URL. Supabase Auth already handles the sign-up bottle path; we just allow-list emails by checking `waitlist_signups.status = 'granted'` in the signup endpoint. |

### Integration sketch

```
supabase/migrations/0NN_waitlist.sql
  CREATE TABLE waitlist_signups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    source text,                    -- "landing", "share-link", etc.
    status text NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','granted','rejected')),
    queued_at timestamptz DEFAULT now(),
    granted_at timestamptz,
    notified_at timestamptz,
    granted_by uuid REFERENCES users(id)
  );
  -- RLS: writable only by service role; no client-side reads needed v1.

backend/package.json
  + "resend": "^6.12.3"

backend/src/lib/env.ts
  + RESEND_API_KEY: string;
  + WAITLIST_FROM_EMAIL: string;   // "Synapse <hello@synapsesync.app>"

backend/src/api/waitlist.ts (new)
  POST /signup   → insert row, return { queued: true }
backend/src/api/admin.ts
  POST /waitlist/grant   → update status, send Resend email, set notified_at

backend/src/lib/email/resend-client.ts (new)
  export async function sendEmail(env, { to, subject, html }) {
    const r = new Resend(env.RESEND_API_KEY);
    return r.emails.send({ from: env.WAITLIST_FROM_EMAIL, to, subject, html });
  }

frontend/src/routes/+page.svelte                     // landing: add waitlist form
frontend/src/routes/+page.server.ts                  // form action → POST /api/waitlist/signup
frontend/src/routes/(app)/admin/waitlist/+page.svelte (new)
frontend/src/routes/(app)/admin/waitlist/+page.server.ts (new)

backend/src/api/auth.ts (Supabase email signup wrapper, if one exists, or middleware on signup)
  + before creating a user, check waitlist_signups.status — reject if not 'granted'.
```

Set the secret: `wrangler secret put RESEND_API_KEY`. `WAITLIST_FROM_EMAIL` can live in `vars`.

### Alternatives Considered

| Recommended | Alternative | Why Not |
|---|---|---|
| Supabase table + admin button | Supabase Queues (pgmq) + scheduled worker that grants on a cron | Queues solve a problem you don't have (high-throughput async processing). Manual grant gives explicit control during launch week. |
| Resend (HTTP API) | Cloudflare Email Sending (`env.EMAIL.send()`) | Public beta since 2026-04-16 — deliverability + DMARC alignment is not yet proven for cold-domain transactional. Revisit in 2-3 months. |
| Resend (HTTP API) | AWS SES | More setup (verified identity, DKIM/SPF), and the cost curve only matters at >50k emails/month. |
| Resend (HTTP API) | SendGrid / Postmark / Mailgun | Resend's DX (TS-first, ESM, one-line send) is strictly better in 2026. SendGrid pricing/API is older and clunkier. Postmark is closest competitor but Resend has won the indie/launch-week mindshare. |
| Plain HTML template | React Email / `react-email` | Adds React + JSX build to the Worker. Not worth it for one template. |
| `nodemailer` | Doesn't work on Workers — no TCP sockets. | Resend HTTP API. |

### What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| Supabase Auth's built-in SMTP | Hard-capped at 2 emails/hour (per Supabase docs) — useless past tiny scale. | Custom SMTP provider via Resend, or Resend direct call from the Worker. |
| `nodemailer` / any SMTP client | Cloudflare Workers has no TCP socket support. Will not work. | Resend (HTTP). |
| Open public signup with no throttle | Milestone REQ-LAUNCH-01 explicitly requires waitlist. | Waitlist table + admin grant. |

---

## Worker Error Observability — REQ-BUG-01 (root cause + prevent recurrence)

Surface real stack traces from Worker exceptions so the current opaque 1101 doesn't repeat (and so any future `Promise.all` reject inside a Hono route is caught and attributed).

### Recommended

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Error capture | **`@sentry/cloudflare` 10.51.x** (last published ~7 days before research date) | `@sentry/cloudflare ^10.51.0` | First-party Sentry SDK for Workers. Captures uncaught exceptions, unhandled rejections, and `Promise.all` rejects that escape Hono's `app.onError`. Maintained — `toucan-js` was archived 2026-01-12 (do not use). |
| Hono integration | **`@sentry/hono` middleware `sentry(app, env → { dsn })`** | bundled with `@sentry/cloudflare` family | Wraps every route automatically. The `app.onError` handler in `backend/src/index.ts:51` keeps surfacing JSON 500 to clients; Sentry middleware just attaches a span/error report in parallel. |
| Wrangler config | Already have `compatibility_flags: ["nodejs_compat"]` — required for `AsyncLocalStorage`. Add `upload_source_maps: true` to `backend/wrangler.jsonc` | — | Source maps map minified stack frames back to TS line numbers. Critical for 1101-class debugging. |
| Tail Worker (immediate, free, dependency-free) | **`tail_consumers`** in `backend/wrangler.jsonc` pointing at a small sibling worker `synapse-tail` that writes events to Workers Analytics Engine or just `console.log`s to the Cloudflare logs UI | — | Even before Sentry is wired, this catches the *raw* event including `outcome`, `exceptions[]`, `scriptVersion`. It's the cheapest possible "see the 1101 stack." Workers Logs (the built-in panel) is already enabled in `wrangler.jsonc:41-48` but does not always surface uncaught Promise rejections that escape; a Tail Worker does. |
| Structured logging | **Plain `console.log(JSON.stringify(...))`** (Workers Logs auto-indexes JSON fields) | — | Pino-browser works but adds a dep and a build step. The volume here doesn't justify it. Centralise via a tiny `backend/src/lib/log.ts` exporting `log.info(msg, fields)`, `log.error(msg, err, fields)`. |
| Diagnostic-first investigation | **Run `wrangler tail` against prod** with the failing flush payload BEFORE wiring Sentry | wrangler 4.75 (already installed) | The current 1101 will reveal its stack instantly via `wrangler tail --name synapse --format pretty` — this is the first-best move per `BUGS.md #1` and should happen before any new lib is added. |

### Integration sketch

```
# Step 0 — immediate (no new code): diagnose the existing 1101
cd backend
wrangler tail --name synapse --format pretty &
# trigger one daemon flush and read the real stack from terminal

# Step 1 — Sentry wiring
backend/package.json
  + "@sentry/cloudflare": "^10.51.0"
  + "@sentry/hono": "^10.51.0"  (peer of @sentry/cloudflare for Hono framework support)

backend/wrangler.jsonc
  + "upload_source_maps": true
  // compatibility_flags already has nodejs_compat — required for AsyncLocalStorage

backend/src/lib/env.ts
  + SENTRY_DSN: string;

backend/src/index.ts
  import { sentry } from "@sentry/hono/cloudflare";
  ...
  app.use(sentry(app, (env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,         // 10% perf samples; errors are always captured
    environment: env.ENVIRONMENT ?? "production",
  })));
  // existing app.onError(...) stays — Sentry captures in parallel.

backend/src/lib/log.ts (new, tiny)
  export const log = {
    info: (msg, fields = {}) => console.log(JSON.stringify({ level: "info", msg, ...fields })),
    error: (msg, err, fields = {}) =>
      console.error(JSON.stringify({ level: "error", msg, err: { message: err?.message, stack: err?.stack }, ...fields })),
  };

# Step 2 — Tail Worker (optional belt-and-braces; skip if Sentry is enough)
.github/...  (or a sibling project root)
backend-tail/wrangler.jsonc + src/index.ts with `export default { async tail(events, env, ctx) { ... } }`

backend/wrangler.jsonc
  + "tail_consumers": [{ "service": "synapse-tail" }]

# Set secret
wrangler secret put SENTRY_DSN
```

### Where to instrument first (root-cause for the current 1101)

Per `BUGS.md #1`, the suspected throw is inside `Promise.all(projectIds.map(pid => recomputeProjectStatus(db, pid)))` at `backend/src/api/events-batch.ts:132`. Wrap each call in a try/catch *and* let Sentry capture so future reducer-shape regressions are attributed instead of opaque-1101'd:

```ts
const results = await Promise.allSettled(
  projectIds.map(pid => recomputeProjectStatus(db, pid))
);
for (const r of results) {
  if (r.status === "rejected") {
    log.error("recomputeProjectStatus failed", r.reason, { projectIds });
    Sentry.captureException(r.reason, { tags: { route: "events-batch" } });
  }
}
```

This single change probably resolves REQ-BUG-01 even before Sentry sees anything.

### Alternatives Considered

| Recommended | Alternative | Why Not |
|---|---|---|
| `@sentry/cloudflare` | `toucan-js` | **Archived 2026-01-12** by the maintainer. Last release was 4.1.1, seven months ago. Do not introduce an archived dep into a launch-critical observability path. |
| `@sentry/cloudflare` | Plain Tail Worker + Cloudflare Logpush → R2 → grep | Works but requires building a viewer. Sentry gives breadcrumbs, release tags, and grouping out of the box. |
| `@sentry/cloudflare` | Axiom / Honeycomb via OpenTelemetry export | Cloudflare Workers supports OTLP export, but the setup overhead is higher and the Sentry UI is more "click and read the stack" friendly. Revisit if Sentry pricing becomes an issue. |
| Tail Worker for raw events | Cloudflare Workers Logs (built-in panel) | Workers Logs is enabled but in practice misses some `Promise.all`-escaped rejections, particularly the 1101 case. A Tail Worker sees the raw runtime event including `exceptions[].stack`. |
| `console.log(JSON.stringify(...))` | `pino` + `pino-cloudflare-transport` | Pino-browser works but the workers-sdk team has not merged pino-pretty support (`cloudflare/workers-sdk#6841`). Plain JSON.stringify is the path of least resistance. |
| Source maps via `upload_source_maps: true` | Manual sentry-cli upload | The wrangler-native flag is the supported path; manual sentry-cli adds a deploy step. Some open issues exist (`getsentry/sentry-javascript#19213`) but they're OpenNext-specific. |

### What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `toucan-js` | Archived January 2026. Won't get security/runtime patches. | `@sentry/cloudflare`. |
| `node:async_hooks` / `node:perf_hooks` directly | Some are stubbed under `nodejs_compat`. Don't assume — let Sentry's `AsyncLocalStorage` use handle context propagation. | `@sentry/cloudflare` (it handles ALS internally). |
| `@cloudflare/worker-sentry` | This is a *Sentry-over-Access* gateway, not a worker error reporter. Naming is misleading. | `@sentry/cloudflare`. |
| Silently catching reducer errors | Loses the signal the 1101 was meant to give us. | `Promise.allSettled` + `Sentry.captureException` + JSON-log. |

---

## Install-Time UX Polish — REQ-BUG-02 / REQ-BUG-03

Daemon-health detection via launchd / systemd, and a graceful path for proxy-blocked `npx`.

### Recommended

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Daemon-state detection | **Plain `node:child_process.execFile`** of `launchctl print gui/$UID/app.synapsesync.daemon` (macOS) or `systemctl --user is-active synapsesync.service` (Linux) | stdlib | The wrong choice is to introduce a library. Both commands are stable, return well-defined exit codes (0 = active), and the daemon directory `mcp/src/capture/os-service.ts` already shells out for installation — the symmetry argues for the same pattern on the read side. |
| Fallback PID check | **Existing `~/.synapse/capture.pid` read** (kept as the last-resort signal for non-launchd / non-systemd hosts, e.g. Windows / WSL / Docker) | — | Already implemented in `DaemonManager.isRunning()`; do not delete it, just demote it to second priority. |
| Process introspection helper (optional) | **`ps-list` 8.x** — only if a richer process listing is needed | `ps-list ^8.1.1` | Cross-platform pure-JS process listing. Useful for "is the node process matching `synapse daemon` alive?" sanity check on Windows where neither launchctl nor systemctl exists. Use sparingly — adds ~15kb. |
| MCP command resolution (REQ-BUG-03) | **Detection-and-fall-through in `mcp/src/cli/editors/io.ts:95`**: try `which synapsesync` → use absolute path; else fall back to `node <abs-path-to>/dist/index.js`; only emit `npx synapsesync` as a last resort, with a wizard-time warning when on a network where `npx --version` 404s | stdlib + existing wizard pattern | Mirrors what `synapse init` already does for hook installation (absolute path to `dist/cli/commands.js`). Cleanest fix: never write `"command": "npx"` if a more reliable path exists. |
| Proxy detection | **`fetch("https://registry.npmjs.org/-/ping", { signal: AbortSignal.timeout(2000) })`** in the wizard preflight | stdlib (Node 22+) | A 2-second ping confirms npm-registry egress works. On failure → display "npx may be blocked by your network — using local node path instead". |
| Wizard prompt UX | **Already on `@clack/prompts` `^0.11`** — extend with `s.start()/s.stop()` spinners around detection steps and `s.note()` for "found daemon under launchd at PID X" | clack 0.11 | Already a dep. Do not introduce ink/listr2/oclif. |
| Healthcheck doctor | **Extend `synapse doctor`** (`mcp/src/cli/status.ts`) with: `Daemon (launchd) ✓`, `Backend reachable ✓`, `MCP server in current cwd ✓`, `npm registry reachable ✓` | — | The `doctor` command is the right surface; users already run it after install. Each check is ~5 lines of `execFile` + status-line emission. |

### Integration sketch

```
mcp/src/capture/daemon.ts
  // refactor isRunning() to a tiered check:
  // 1. ask launchd / systemd (sync execFile, 200ms timeout)
  // 2. fall back to ~/.synapse/capture.pid + kill(pid, 0)
  // returns: { running: boolean, supervisor: "launchd"|"systemd"|"pid"|"none", pid?: number }

mcp/src/capture/os-service.ts
  + export async function getDaemonStatus(): Promise<DaemonStatus>
    // wraps `launchctl print gui/<uid>/app.synapsesync.daemon` or
    //       `systemctl --user is-active synapsesync.service`

mcp/src/cli/commands.ts (runCaptureStatus)
  // replace the existing capture.pid-only check with getDaemonStatus()
  // print supervisor name in the status line

mcp/src/cli/editors/io.ts
  + function resolveMcpCommand(): { command: string; args: string[] }
    // try `which synapsesync` (absolute path)
    // → { command: "/opt/homebrew/bin/synapsesync", args: [] }
    // else fall back to node + absolute dist path
    // → { command: process.execPath, args: [<repoOrInstall>/mcp/dist/index.js] }
    // last resort: { command: "npx", args: ["synapsesync"] } + emit warning

mcp/src/cli/wizard.ts
  + preflight: ping npm registry; if it fails, prefer node-direct command
  + outro: if synapsesync is not on PATH and we wrote a node-direct config,
    advise `npm i -g synapsesync` for cleaner editor configs.

mcp/src/cli/status.ts  (synapse doctor)
  + new checks:
      "Daemon supervised by launchd": getDaemonStatus().supervisor === "launchd"
      "Backend reachable": fetch(API_URL + "/health") within 2s
      "npm registry reachable": fetch("https://registry.npmjs.org/-/ping") within 2s
      "MCP server in .mcp.json": read ./.mcp.json and look for synapse server
```

### Alternatives Considered

| Recommended | Alternative | Why Not |
|---|---|---|
| `execFile launchctl/systemctl` | A library like `node-windows` / `node-mac` | Both are abandoned (years stale). The actual CLI commands are stable. |
| Plain stdlib + `ps-list` (only if needed) | `pidusage`, `find-process` | `find-process` works but adds 200kb and a native dep for finding a string — overkill. |
| `clack` (already in use) | `enquirer`, `inquirer`, `listr2`, `ink` | No reason to swap. Clack v0.11 already handles spinners, prompts, multi-select. |
| Wizard ping to registry | Detecting Netskope/proxy by env vars (`HTTPS_PROXY`) | Proxy env vars are sometimes set but the network is still broken (or unset and the network is fine). A 2-second ping is the actual signal. |
| Always-absolute MCP command path | Always-`npx synapsesync` | Breaks on Netskope (the BUG-03 case). |
| Always-absolute MCP command path | Always-`node <dist>/index.js` | Works but uses the install-location path which can change with `npm i -g` upgrades. `synapsesync` on PATH is the cleanest when available. |

### What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| Parsing `launchctl list` output | Apple's man page explicitly says the output format is *not* API and may change without notice. | `launchctl print gui/$UID/<label>` and check exit code (0 = exists/loaded). |
| Polling for PID file existence as the *only* daemon check | Misses launchd-supervised daemons (precisely the REQ-BUG-02 case). | Tiered check: supervisor first, PID file second. |
| Forcing `npx` in editor configs | Fails on proxy-restricted networks (REQ-BUG-03). | Detect `synapsesync` on PATH; fall back to absolute `node <dist>`; only emit `npx` with a warning. |
| Introducing pm2 or forever | We're not replacing the OS service layer. The launchd/systemd path is correct. | Stay with launchd/systemd; only the *detection* side needs the fix. |
| `node-cron` / similar in the daemon | The daemon already has its own interval loop. Cron-shaped scheduling solves a problem we don't have. | Existing `setInterval` in `startHandoffLoop`. |

---

## Installation (cumulative, for all 4 areas)

```bash
# Backend (run from repo root)
npm install --workspace=backend resend@^6.12.3 @sentry/cloudflare@^10.51.0 @sentry/hono@^10.51.0

# Frontend — no new deps required for telemetry (hand-rolled SVG) or waitlist (form actions)
# Skip layerchart unless the dashboard grows beyond two charts.

# MCP — no new runtime deps; ps-list is optional and only if Windows support
# is brought up to parity later:
# npm install --workspace=mcp ps-list@^8.1.1   # NOT in this milestone

# Wrangler secrets
cd backend
wrangler secret put SENTRY_DSN
wrangler secret put RESEND_API_KEY
```

Update `backend/wrangler.jsonc`:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],   // already set
  "upload_source_maps": true,                  // NEW — for Sentry stack traces
  "vars": {
    "COMPACTION_LLM_MODEL": "claude-haiku-4-5-20251001",
    "WAITLIST_FROM_EMAIL": "Synapse <hello@synapsesync.app>"   // NEW (non-secret)
  },
  "tail_consumers": [                          // OPTIONAL — only if standing up a sibling tail worker
    { "service": "synapse-tail" }
  ]
}
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---|---|---|
| `@sentry/cloudflare ^10.51.0` | Wrangler ^4.75, Workers `compatibility_flags: ["nodejs_compat"]` | Requires `AsyncLocalStorage` → needs `nodejs_compat` (or `nodejs_als`); we already have `nodejs_compat`. ESM only — already the project default. |
| `@sentry/hono ^10.51.0` | Hono ^4.12, `@sentry/cloudflare ^10.51.0` | Use the `/cloudflare` subpath: `import { sentry } from "@sentry/hono/cloudflare"`. |
| `resend ^6.12.3` | Workers (uses `fetch`), Node 22 | ESM. No SMTP, no TCP — Workers-safe. |
| `layerchart ^2.x` (only if you skip hand-rolled SVG) | Svelte ^5.54, SvelteKit ^2.55, Tailwind ^4 | Verify peer-deps before adding; Svelte 5 runes-aware lib churn is real. |
| Supabase `pgmq` (NOT recommended for this milestone) | supabase-js ^2.99.2 via `client.schema('pgmq_public').rpc('send'|'pop', {...})` | Listed for completeness in case future async grant-flow is added. |
| `ps-list ^8.1.1` (optional / future) | Node ^22, all OSes | Pure-JS, no native deps. |

---

## Stack Patterns by Variant

**If the 1101 is reproduced before Sentry is wired:**
- Skip the Sentry wiring for this milestone; ship the `Promise.allSettled` + `console.error(JSON.stringify(...))` fix + Tail Worker only.
- Add Sentry post-launch when there's signal it's needed.

**If Resend deliverability is a concern on a cold domain:**
- Warm `synapsesync.app` by configuring SPF + DKIM + DMARC before launch day.
- Use Resend's "Domains" UI; verification takes ~1h end-to-end.

**If launchd/systemctl shell-outs are slow on user machines:**
- Cache the result for 2s in `DaemonManager` to avoid hammering on dashboard polls.
- Already plausible given the daemon's 10s interval is the only consumer.

**If the waitlist grows past ~1k entries before granting starts:**
- Add a simple search/filter in the admin UI (`waitlist/+page.svelte`).
- Still no need for a queue — table scan is fine through ~100k rows.

---

## Sources

- [Cloudflare Workers Observability](https://developers.cloudflare.com/workers/observability/) — HIGH (official)
- [Cloudflare Tail Workers docs](https://developers.cloudflare.com/workers/observability/logs/tail-workers/) — HIGH (official, includes `tail_consumers` config)
- [Cloudflare Source Maps and Stack Traces](https://developers.cloudflare.com/workers/observability/source-maps/) — HIGH (official, `upload_source_maps: true`)
- [Sentry for Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/) — HIGH (official; `@sentry/cloudflare`, `nodejs_compat` requirement)
- [Sentry for Hono on Cloudflare](https://docs.sentry.io/platforms/javascript/guides/hono/) — HIGH (official, exact `sentry(app, env → { dsn })` call)
- [@sentry/cloudflare on npm](https://www.npmjs.com/package/@sentry/cloudflare) — version 10.51.0, last published ~7 days before research date — HIGH
- [toucan-js on GitHub](https://github.com/robertcepa/toucan-js) — repo archived 2026-01-12 — HIGH (avoid)
- [Resend on npm](https://www.npmjs.com/package/resend) — version 6.12.3 — HIGH
- [Resend on Cloudflare Workers tutorial](https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/) — HIGH (official)
- [Resend for Cloudflare Workers (Resend docs)](https://resend.com/docs/send-with-cloudflare-workers) — HIGH (official)
- [Cloudflare Email Sending public beta announcement](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/) — HIGH; too new for launch-week — defer
- [Supabase pgmq Quickstart](https://supabase.com/docs/guides/queues/quickstart) — HIGH (RPC examples for `pgmq_public.send`/`pop`)
- [Supabase pgmq API](https://supabase.com/docs/guides/queues/api) — HIGH
- [silentworks/waiting-list (Supabase reference impl)](https://github.com/silentworks/waiting-list) — MEDIUM (community reference)
- [How to build a waitlist with Supabase and Next.js (Tinloof)](https://tinloof.com/blog/how-to-build-a-waitlist-with-supabase-and-next-js) — MEDIUM (pattern reference)
- [Cloudflare Workers Logs (JSON structured)](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) — HIGH
- [pino + Cloudflare Workers issue](https://github.com/pinojs/pino/issues/2035) — MEDIUM (informs the "don't bother with pino" choice)
- [Alan Siu: launchctl print subcommands](https://www.alansiu.net/2025/05/28/using-new-launchctl-subcommands-to-check-for-and-reload-launch-daemons/) — MEDIUM (informs the "use `launchctl print <label>` exit code, not output parsing" choice)
- [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers) — HIGH

---

*Stack research for: AI coding session capture & handoff tool — stabilize-for-launch milestone*
*Researched: 2026-05-19*
