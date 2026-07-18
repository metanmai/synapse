---
phase: 01-stabilize-backend-observability
plan: 05
type: execute
wave: 2
slice: 1b
status: code-complete-live-verification-pending
defer_reason: "Code and automated tests completed on 2026-07-18. Live activation still requires a Sentry project DSN, `wrangler secret put SENTRY_DSN`, deployment, and the deliberate-throw verification for OBS-01 SC#4."
depends_on: [01-01]
files_modified:
  - backend/package.json
  - backend/src/lib/env.ts
  - backend/src/lib/observability.ts
  - backend/src/index.ts
  - backend/wrangler.jsonc
autonomous: false
requirements: [OBS-01]
user_setup:
  - service: sentry
    why: "Worker exception reporting — captures the unhandled rejections that `app.onError` misses (Pitfall #1 grounding from REQUIREMENTS.md)."
    env_vars:
      - name: SENTRY_DSN
        source: "Sentry Dashboard → [Project] → Settings → Client Keys (DSN)"
        when: "Set via `wrangler secret put SENTRY_DSN` in slice 1b before deploy. Slice 1a only declares the binding type — no value committed to git."
    dashboard_config:
      - task: "Create or identify the Synapse Worker project in Sentry; copy the DSN"
        location: "Sentry Dashboard → Projects"
        when: "Before slice 1b's deploy task. Slice 1a does not need a live DSN to land."

must_haves:
  truths:
    - "`backend/src/index.ts` contains `app.use(sentry(` as the FIRST `app.use` after `const app = new Hono`, before CORS, rate-limit, and dbMiddleware."
    - "`backend/src/lib/observability.ts` exports `scrubPayload` that strips `event.extra[*].payload`, `event.breadcrumbs[*].data.payload`, and `event.request.data` payloads while preserving stack traces, `event_id`, `project_id`, `kind`, `actor_user_id`."
    - "`SENTRY_DSN` is declared as an optional string on the `Env` interface in `backend/src/lib/env.ts`; no DSN literal lives in the repo."
    - "When `env.SENTRY_DSN` is empty/undefined, the SDK initializes in no-op mode AND a `console.warn` line is emitted at request time (Pitfall #2 visibility)."
    - "A defensive `Sentry.captureException(err)` lives inside the non-AppError branch of `app.onError` as belt-and-suspenders for the BETA SDK (per RESEARCH §A2)."
  artifacts:
    - path: "backend/package.json"
      provides: "@sentry/cloudflare ^10.53.1 + @sentry/hono (latest) added to dependencies"
      contains: "@sentry/cloudflare"
    - path: "backend/src/lib/env.ts"
      provides: "Env.SENTRY_DSN?: string"
      contains: "SENTRY_DSN"
    - path: "backend/src/lib/observability.ts"
      provides: "scrubPayload + reportError(err, env, ctx?) helper"
      exports: ["scrubPayload", "reportError"]
    - path: "backend/src/index.ts"
      provides: "app.use(sentry(...)) wired as FIRST middleware + defensive Sentry.captureException in app.onError"
      contains: "sentry("
    - path: "backend/wrangler.jsonc"
      provides: "No literal DSN; comment near vars block noting SENTRY_DSN is a wrangler secret (slice 1b sets it via `wrangler secret put`)"
      contains: "SENTRY_DSN"
  key_links:
    - from: "backend/src/index.ts (middleware chain)"
      to: "backend/src/lib/observability.ts (scrubPayload)"
      via: "import + pass as beforeSend in sentry(app, env => ({...}))"
      pattern: "beforeSend:\\s*scrubPayload"
    - from: "backend/src/index.ts (app.use(sentry(...)))"
      to: "Env.SENTRY_DSN"
      via: "callback `env => ({ dsn: env.SENTRY_DSN })`"
      pattern: "env\\.SENTRY_DSN"
---

<objective>
Close OBS-01 (code-only portion per CONTEXT.md slice routing): author the Sentry SDK init code, Hono middleware wiring, and `wrangler.jsonc` binding declaration. Deploy + SC#4 deliberate-throw verification are DEFERRED to slice 1b on the CF-enabled machine (per CONTEXT.md `<domain>` "Slice 1b").

Purpose: Today Worker exceptions are logged with `console.error` in `app.onError` (`backend/src/index.ts:60`) and disappear into Cloudflare's free-tier logs. Synapse needs Sentry to catch the unhandled rejections that `app.onError` misses (the 1101 root cause family — `Promise.all` swallowing rejections in `recomputeProjectStatus`, per RESEARCH D1). This plan lands the code; slice 1b deploys and verifies.

Output: 5 file edits delivering Sentry SDK init via `@sentry/hono/cloudflare` middleware, `scrubPayload` `beforeSend` hook for PII safety (CONTEXT.md D-07), `SENTRY_DSN` declared as an `Env` type field but NOT as a literal `wrangler.jsonc:vars` entry (per CONTEXT.md "SENTRY_DSN handling" — secret, not var). 5 RED tests turn GREEN (4 scrubPayload + 1 wiring). One blocking-human checkpoint validates `@sentry/hono` legitimacy before install (per RESEARCH §"Package Legitimacy Audit" — `[ASSUMED]` version pin needs verification on a clean network).

User-observable outcome (for slice 1a only): the operator running `npm install` in `backend/` ends with the Sentry packages in node_modules and the wiring assertion test green. SC#4 (deliberate throw → Sentry event within 1 min) is verified in slice 1b after deploy.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-stabilize-backend-observability/01-CONTEXT.md
@.planning/phases/01-stabilize-backend-observability/01-RESEARCH.md
@.planning/phases/01-stabilize-backend-observability/01-VALIDATION.md
@.planning/phases/01-stabilize-backend-observability/01-01-SUMMARY.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/INTEGRATIONS.md

<interfaces>
<!-- Source-of-truth patterns. Extracted from RESEARCH.md Pattern 1 + Pattern 2 + Code Examples. -->

`backend/src/index.ts` current middleware chain (RESEARCH §"Component Responsibilities" + lines 28-65):
- `const app = new Hono<{ Bindings: Env }>()`
- `app.use("*", (c, next) => { /* CORS — lines 31-43 */ })`
- `app.use("*", rateLimit(120, 60000))`
- `app.use("/auth/*", dbMiddleware)`
- `app.use("/api/*", dbMiddleware)`
- `app.onError((err, c) => { if (err instanceof AppError) {...} console.error(...); return c.json(...); })` (lines 51-65)

INSERTION POINT (per RESEARCH §"Pattern 1" + Anti-Pattern "DON'T put Sentry middleware *after* CORS"):
- `app.use(sentry(app, (env) => ({ dsn: env.SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0.1, beforeSend: scrubPayload })))` MUST be the FIRST `app.use` line, immediately after `const app = new Hono(...)`. This ensures Sentry sees every request transaction.

`scrubPayload` shape (per RESEARCH §"Pattern 2" lines 273-313):
- Signature: `(event: Event, hint: EventHint) => Event | null` (loose-typed in Wave 0 stub; this plan tightens to imported types).
- Strips: `event.extra[k].payload` when value is synapse-shaped (`"kind" in v && "event_id" in v`); `event.breadcrumbs[*].data.payload`; `event.request.data` payload subkeys.
- Preserves: stack traces (`event.exception`), `event.request.url`, `event.request.method`, `event_id`, `project_id`, `kind`, `actor_user_id`, `occurred_at`.
- Returns the mutated event (never `null` in this implementation — all synapse-events are forwarded, just scrubbed).

`reportError(err, env, ctx?)` helper (per RESEARCH §"Anti-Pattern" line 573 "for future use in cron paths"):
- Body: `Sentry.captureException(err)`; if `ctx` is provided, `ctx.waitUntil(Sentry.flush(2000))` to guarantee delivery from `ctx.waitUntil` paths.
- Not called from Hono routes in this slice (the middleware handles those). Lands as exported function for cron/scheduled handler use in slice 1b.

`backend/wrangler.jsonc` (per CONTEXT.md "SENTRY_DSN handling" + RESEARCH §"Open Questions" #2):
- DO NOT add a literal `SENTRY_DSN: "..."` under `vars`. Wrangler's own comments at `wrangler.jsonc:33-37` warn that secrets get zeroed on deploy if in `vars`.
- DO add a comment near the `vars` block: `// SENTRY_DSN is set via `wrangler secret put SENTRY_DSN` in slice 1b before deploy` (or similar — match existing comment style in the file).

LANDMINES:
- Pitfall 2 (RESEARCH §"Common Pitfalls"): Sentry silently no-ops when DSN is missing. Add `if (!env.SENTRY_DSN) console.warn("[observability] SENTRY_DSN unset — Sentry disabled")` somewhere in the middleware factory callback (or in `observability.ts` startup) so the silent-mode is visible.
- A2 (RESEARCH §"Assumptions Log"): `@sentry/hono` is BETA. Add defensive `Sentry.captureException(err)` inside `app.onError`'s non-AppError branch (1 LOC insurance per RESEARCH §"Open Questions" #1).
- A1 + Package Legitimacy Audit: `@sentry/hono` version is `[ASSUMED]` (npm view blocked by corp proxy). MUST verify legitimacy on a clean network before pinning — see Task 1 checkpoint.
- D-07 PII policy: `sendDefaultPii: false` + `beforeSend: scrubPayload`. Stack traces ARE preserved (needed for debugging); only event payloads are stripped.

VALIDATION row mapping:
- Task 1 (install + version pin): no test row directly; the checkpoint and legitimacy gate handle this.
- Task 2 (`observability.ts` + `env.ts`): 4 OBS-01 scrubPayload rows in VALIDATION.md.
- Task 3 (`index.ts` middleware wiring + `wrangler.jsonc` binding): 1 OBS-01 wiring row in VALIDATION.md.
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking-human">
  <name>Task 1a: Legitimacy gate for @sentry/hono [ASSUMED]</name>
  <what-built>
    Pre-install legitimacy verification for `@sentry/hono` per RESEARCH §"Package Legitimacy Audit". `@sentry/cloudflare ^10.53.1` is already `[VERIFIED]` end-to-end on this machine (RESEARCH line 94) and does NOT require this checkpoint — only `@sentry/hono` does.
  </what-built>
  <how-to-verify>
    1. On a non-proxied network (tether / personal hotspot), run: `npm view @sentry/hono` (NOT `npx`, NOT through corporate proxy).
    2. Confirm:
       - Repository field shows `github.com/getsentry/sentry-javascript` (same monorepo as `@sentry/cloudflare`).
       - License is `MIT`.
       - `scripts.postinstall` is empty (`npm view @sentry/hono scripts.postinstall` → blank).
       - Maintainer is `sentry` (or `getsentry`).
       - Latest version string — record it; Task 1b will pin this exact version.
    3. Optional (if available): `pip install slopcheck && slopcheck @sentry/hono` on a non-proxied network.
    4. Note the version published date; if newer than 7 days, prefer the previous stable version (per project preference — defensive against fresh-publish supply-chain risk).
  </how-to-verify>
  <resume-signal>Type "approved" and provide the verified version string (e.g., "approved, 10.53.1"), OR provide blocking issues (e.g., "blocked: package not in getsentry repo").</resume-signal>
  <acceptance_criteria>
    - Operator has captured the published `version` string for `@sentry/hono` from `npm view @sentry/hono` output on a non-proxied network (record in the resume signal).
    - Operator has confirmed `repository` resolves to `github.com/getsentry/sentry-javascript` (same monorepo as `@sentry/cloudflare`).
    - Operator has confirmed `license` is `MIT`.
    - Operator has confirmed `npm view @sentry/hono scripts.postinstall` returns blank (no postinstall hook — supply-chain ASVS V14).
    - This checkpoint is NEVER auto-approvable: `workflow.auto_advance` is ignored for blocking-human gates on `[ASSUMED]` packages.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 1b: Install Sentry SDK packages</name>
  <files>backend/package.json</files>
  <read_first>
    - backend/package.json (full)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Standard Stack" lines 88-115
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Package Legitimacy Audit" lines 125-140
    - CLAUDE.md (project) — note: lock files MUST NOT be committed
    - $HOME/.claude/projects/-Users-Tanmai-N-Documents-synapse/memory/feedback_npx_proxy.md
  </read_first>
  <behavior>
    - Adds two dependencies to `backend/package.json`: `@sentry/cloudflare` at the version pinned by RESEARCH (^10.53.1) and `@sentry/hono` at the version approved in Task 1a.
    - Does NOT commit `package-lock.json` (per project memory `feedback_no_lockfile.md`).
    - If `npm install` is blocked by the Netskope proxy on this device, fall back to the symlink approach documented in `$HOME/.claude/.../feedback_worktree_node_modules.md` — the symlink fallback is allowed for the backend workspace (the feedback file notes it works for mcp+backend).
  </behavior>
  <action>
    Run `cd backend && npm install --save @sentry/cloudflare@^10.53.1 @sentry/hono@<version-from-Task-1a>`. If npm is proxy-blocked: tether to a clean network OR symlink `backend/node_modules` from a working installation per `feedback_worktree_node_modules.md`. Verify `backend/package.json` `dependencies` now contains both entries with the exact pinned versions. Discard / `git checkout -- backend/package-lock.json` if npm regenerated it (per `feedback_no_lockfile.md`).
  </action>
  <verify>
    <automated>grep -E '"@sentry/(cloudflare|hono)"' backend/package.json | wc -l</automated>
    <automated>cd backend && node -e "require('@sentry/cloudflare'); require('@sentry/hono'); console.log('ok')"</automated>
  </verify>
  <acceptance_criteria>
    - Both packages declared: `grep -cE '"@sentry/(cloudflare|hono)"' backend/package.json` returns exactly 2.
    - `@sentry/cloudflare` pinned to `^10.53.1`: `grep -E '"@sentry/cloudflare"\\s*:\\s*"\\^10\\.53\\.1"' backend/package.json` exits 0.
    - `@sentry/hono` pinned to the exact version from Task 1a (operator-supplied): `grep -E '"@sentry/hono"\\s*:\\s*"\\^?[0-9]+\\.[0-9]+\\.[0-9]+' backend/package.json` exits 0 (a semver string is present, not a tag like `latest`).
    - Both packages load at runtime: `cd backend && node -e "require('@sentry/cloudflare'); require('@sentry/hono'); console.log('ok')"` prints exactly `ok`.
    - No lockfile staged: `git status --porcelain backend/package-lock.json` outputs empty (per `feedback_no_lockfile.md`).
    - `npm run lint && npm run typecheck` exit 0 from repo root.
  </acceptance_criteria>
  <done>Both packages listed in `backend/package.json` dependencies with pinned versions; `node -e require(...)` from `backend/` prints `ok`; no `package-lock.json` staged for commit; `npm run lint && npm run typecheck` exit 0 from repo root.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement scrubPayload + reportError in observability.ts; declare SENTRY_DSN on Env</name>
  <files>backend/src/lib/observability.ts, backend/src/lib/env.ts</files>
  <read_first>
    - backend/src/lib/observability.ts (Wave 0 stub — full)
    - backend/src/lib/env.ts (full)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 2" (lines 267-316)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Code Examples" "Verified — beforeSend filtering pattern" (lines 654-669)
    - backend/test/lib/observability.test.ts (Wave 0 — read assertions verbatim)
    - .planning/codebase/CONVENTIONS.md
  </read_first>
  <behavior>
    `scrubPayload(event: Event, hint: EventHint): Event | null`:
      - Iterates `event.extra` keys; for each value matching `isSynapseEventShape` (has `kind` AND `event_id`), replaces with `stripPayload(value)` which keeps only `event_id`, `project_id`, `kind`, `actor_user_id`, `occurred_at`.
      - Iterates `event.breadcrumbs ?? []`; for each `bc.data` matching `isSynapseEventShape`, replaces with `stripPayload(bc.data)`.
      - If `event.request?.data && typeof event.request.data === "object"`, runs `sanitizeRequestBody` (strips top-level `payload` key if present, preserves URL/method via not touching them).
      - Returns the (mutated) event. Never returns `null` (no event is dropped, just scrubbed). This matches Wave 0 test "returns the same event when no synapse-shaped data is attached".
      - Preserves `event.exception` (stack traces) untouched.

    `reportError(err: unknown, env: Env, ctx?: ExecutionContext)`:
      - Calls `Sentry.captureException(err)`.
      - If `ctx` is provided, calls `ctx.waitUntil(Sentry.flush(2000))` to ensure delivery from `ctx.waitUntil` execution paths.

    `Env.SENTRY_DSN`:
      - Add as `SENTRY_DSN?: string` (optional — the DSN may be unset locally; Pitfall #2 visibility handled in Task 3).
  </behavior>
  <action>
    In `backend/src/lib/observability.ts`: replace the Wave 0 stub. Import `Event`, `EventHint` from `@sentry/cloudflare`, and `* as Sentry` from `@sentry/cloudflare`. Implement `scrubPayload` per `<behavior>` and RESEARCH §"Pattern 2" lines 277-313. Add the helper `isSynapseEventShape(v): v is Record<string, unknown>` and `stripPayload(ev): Record<string, unknown>` from RESEARCH §"Pattern 2" lines 302-312. Add `sanitizeRequestBody(body): unknown` that returns a shallow copy minus the `payload` key. Export `reportError(err, env, ctx?)` per `<behavior>`. Type signatures must satisfy the Wave 0 test imports.

    In `backend/src/lib/env.ts`: add `SENTRY_DSN?: string;` to the `Env` interface, ideally near the comment block that already documents env-vars (match existing comment style, e.g., add a `// Observability` group line if helpful for readability).

    DO NOT call `Sentry.init` from `observability.ts` — the `sentry()` middleware in `index.ts` handles initialization via its env callback. `observability.ts` only exports helpers.
  </action>
  <verify>
    <automated>cd backend && npx vitest run test/lib/observability.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - VALIDATION row: OBS-01 / "scrubPayload removes event.extra[k].payload from synapse-shaped event objects" → `cd backend && npx vitest run test/lib/observability.test.ts -t "removes event.extra"` exits 0.
    - VALIDATION row: OBS-01 / "scrubPayload preserves stack traces and request metadata" → `cd backend && npx vitest run test/lib/observability.test.ts -t "preserves stack traces"` exits 0.
    - VALIDATION row: OBS-01 / "scrubPayload returns the same event when no synapse-shaped data is attached" → `cd backend && npx vitest run test/lib/observability.test.ts -t "returns the same event"` exits 0.
    - VALIDATION row: OBS-01 / "scrubPayload removes event.request.data and event.breadcrumbs[*].data.payload" → `cd backend && npx vitest run test/lib/observability.test.ts -t "removes event.request.data"` exits 0.
    - `Env.SENTRY_DSN` declared: `grep -nE "SENTRY_DSN\\?:\\s*string" backend/src/lib/env.ts` returns exactly 1 hit.
    - `reportError` exported: `grep -nE "^export function reportError\\(" backend/src/lib/observability.ts` returns exactly 1 hit.
    - No `Sentry.init(` in observability.ts (middleware owns init): `grep -cE "Sentry\\.init\\(" backend/src/lib/observability.ts` returns 0.
    - `npm run lint && npm run typecheck` exit 0 from repo root.
  </acceptance_criteria>
  <done>All 4 OBS-01 scrubPayload rows in 01-VALIDATION.md "Per-Task Verification Map" flip from ⬜ to ✅; `Env` now has `SENTRY_DSN?: string`; `npm run lint && npm run typecheck` exit 0 from repo root.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire app.use(sentry(...)) as FIRST middleware in index.ts + add defensive captureException + wrangler.jsonc note</name>
  <files>backend/src/index.ts, backend/wrangler.jsonc</files>
  <read_first>
    - backend/src/index.ts (full — pay attention to lines 1-65, the middleware chain and app.onError)
    - backend/src/lib/observability.ts (now implemented from Task 2)
    - backend/src/lib/env.ts (now has SENTRY_DSN)
    - backend/wrangler.jsonc (full — note the `vars` comment block around line 33-37 warning about secrets)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Pattern 1" (lines 220-265)
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Anti-Patterns" lines 567-576
    - .planning/phases/01-stabilize-backend-observability/01-RESEARCH.md §"Assumptions Log" A2
    - backend/test/lib/observability-wiring.test.ts (Wave 0 — read the assertion verbatim)
    - .planning/phases/01-stabilize-backend-observability/01-CONTEXT.md §"specifics" + §"decisions" D-03, D-05, D-07
  </read_first>
  <behavior>
    - Add as the FIRST `app.use` after `const app = new Hono<{ Bindings: Env }>()`:
        `app.use(sentry(app, (env) => { if (!env.SENTRY_DSN) console.warn("[observability] SENTRY_DSN unset — Sentry disabled"); return { dsn: env.SENTRY_DSN, sendDefaultPii: false, tracesSampleRate: 0.1, beforeSend: scrubPayload }; }));`
    - All existing middleware (CORS, rateLimit, dbMiddleware) lines remain BELOW the sentry line, in their existing order.
    - In `app.onError`, in the non-AppError branch (after the AppError handler, before the `console.error + return c.json(...)`), add `Sentry.captureException(err);` as belt-and-suspenders (per RESEARCH §A2, §"Open Questions" #1).
    - In `backend/wrangler.jsonc`, near the existing `vars` block (or wherever environment bindings are documented), add a single-line comment: `// SENTRY_DSN: declared on Env type; set via 'wrangler secret put SENTRY_DSN' before deploy (slice 1b owns).` Do NOT add a `SENTRY_DSN: "..."` literal anywhere. The `nodejs_compat` compatibility flag (already at `backend/wrangler.jsonc:6` per RESEARCH) MUST remain.
  </behavior>
  <action>
    Edit `backend/src/index.ts`:
      1. Add imports: `import { sentry } from "@sentry/hono/cloudflare";` and `import * as Sentry from "@sentry/cloudflare";` and `import { scrubPayload } from "./lib/observability";` (or relative path matching existing style).
      2. Insert the `app.use(sentry(app, ...))` middleware call as the FIRST `app.use` line, immediately after `const app = new Hono<{ Bindings: Env }>()`. Use the exact env-callback shape from `<behavior>` including the `console.warn` Pitfall #2 visibility log.
      3. Inside `app.onError`'s non-AppError branch, add `Sentry.captureException(err);` immediately before the existing `console.error(...)` line (defensive duplicate-capture acceptable per A2; Sentry de-dupes internally).

    Edit `backend/wrangler.jsonc`: add the one-line comment near the existing vars block per `<behavior>`. Do NOT add a `SENTRY_DSN` key under `vars`. Verify `nodejs_compat` is still in `compatibility_flags`.

    Do NOT touch the existing CORS / rateLimit / dbMiddleware lines — only their position relative to the new sentry line matters (they remain AFTER it). Do NOT touch `app.route(...)` calls or the `scheduled` handler.
  </action>
  <verify>
    <automated>cd backend && npx vitest run test/lib/observability-wiring.test.ts</automated>
    <automated>cd backend && npx vitest run</automated>
    <automated>grep -v "^//" backend/wrangler.jsonc | grep -E '"SENTRY_DSN"\s*:' | wc -l</automated>
  </verify>
  <acceptance_criteria>
    - VALIDATION row: OBS-01 (wiring) / "backend/src/index.ts calls app.use(sentry(...)) BEFORE CORS and any other middleware" → `cd backend && npx vitest run test/lib/observability-wiring.test.ts` exits 0.
    - Sentry middleware is FIRST: the line number of the first `app.use(sentry(` match equals the line number of the first `app.use(` match. Verify: `[ "$(grep -nE 'app\\.use\\(sentry\\(' backend/src/index.ts | head -1 | cut -d: -f1)" = "$(grep -nE 'app\\.use\\(' backend/src/index.ts | head -1 | cut -d: -f1)" ]` exits 0.
    - Defensive `Sentry.captureException(err)` present in onError: `grep -nE "Sentry\\.captureException\\(err\\)" backend/src/index.ts` returns at least 1 hit.
    - `wrangler.jsonc` has no literal DSN: `grep -v '^[[:space:]]*//' backend/wrangler.jsonc | grep -cE '"SENTRY_DSN"\\s*:' ` returns 0 (the only place SENTRY_DSN appears outside comments is nowhere — the comment about it is fine, the literal value is forbidden).
    - `nodejs_compat` still present: `grep -cE '"nodejs_compat"' backend/wrangler.jsonc` returns ≥ 1.
    - **Reviewer-checklist item (manual, not automated — per `feedback_test_generality.md`: comment-text greps are instance-only theater):** Reviewer confirms `backend/wrangler.jsonc` includes a single-line comment near the `vars` block explaining that SENTRY_DSN is set via `wrangler secret put` (slice 1b). The class-correct guard for the bug class "secret leaked into git" is the `wrangler.jsonc` no-literal-DSN acceptance criterion above (no `"SENTRY_DSN"` literal outside comments) — that catches any drift regardless of comment wording.
    - Full backend suite green: `cd backend && npx vitest run` exits 0.
    - `npm run lint && npm run typecheck` exit 0 from repo root.
  </acceptance_criteria>
  <done>The OBS-01 wiring row in 01-VALIDATION.md flips from ⬜ to ✅; full `backend` test suite green; `npm run lint && npm run typecheck` exit 0 from repo root; the wiring test confirms `app.use(sentry(` is the first `app.use` in `backend/src/index.ts` and there is NO literal SENTRY_DSN value in `wrangler.jsonc`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Worker process → Sentry transport (`sentry.io`) | Sentry SDK sends captured events over HTTPS to sentry.io. Trust: Sentry's transport + retention policy. Mitigations: `sendDefaultPii: false`, `beforeSend: scrubPayload` strips payload PII. |
| Worker process → `c.env.SENTRY_DSN` | DSN is a Cloudflare Workers secret (set in slice 1b via `wrangler secret put`). Trust: Cloudflare's secret storage. |
| package supply chain → npm (`@sentry/cloudflare`, `@sentry/hono`) | Both packages from `getsentry/sentry-javascript` monorepo; first-party. `@sentry/cloudflare` `[VERIFIED]`, `@sentry/hono` `[ASSUMED]` gated by Task 1a checkpoint. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-05-01 | Information Disclosure | Synapse event payload (user prompt / response text) leaked to Sentry | mitigate | `beforeSend: scrubPayload` strips `event.extra[*].payload`, `event.breadcrumbs[*].data.payload`, `event.request.data.payload`. Wave 0 + Task 2 tests cover all four scrub paths. ASVS V7 (Error Handling & Logging). |
| T-01-05-02 | Information Disclosure | `SENTRY_DSN` leaked via `wrangler.jsonc` in git | mitigate | DSN declared on `Env` type only; literal value set via `wrangler secret put SENTRY_DSN` in slice 1b. `wrangler.jsonc` comment documents the policy. ASVS V7 + the explicit policy decision in CONTEXT.md `<additional_specifics>` "SENTRY_DSN handling". |
| T-01-05-03 | Information Disclosure | `sendDefaultPii: true` (default) attaches user IP / headers | mitigate | Explicitly set `sendDefaultPii: false` in the sentry middleware options (per RESEARCH §"Pattern 1" line 244). |
| T-01-05-04 | Tampering | Supply-chain attack on `@sentry/hono` (BETA, [ASSUMED] version) | mitigate | Task 1a blocking-human checkpoint verifies the package on a clean network before install (per RESEARCH §"Package Legitimacy Audit"). T-01-SC ASVS V14 (Configuration). |
| T-01-05-05 | Repudiation | Silent no-op when SENTRY_DSN is unset (Pitfall #2) | mitigate | `console.warn` line in the middleware env callback surfaces the no-op state to Workers logs at request time. |
| T-01-05-06 | Denial of Service | Unbounded `tracesSampleRate: 1.0` could exhaust Sentry quota / Worker CPU | mitigate | `tracesSampleRate: 0.1` (10%) per RESEARCH §"Pattern 1" line 245; tune in slice 1b after SC#4. |
</threat_model>

<verification>
1. `cd backend && npx vitest run` — full backend suite green (5 OBS-01 RED tests now GREEN)
2. `cd backend && node -e "require('@sentry/cloudflare'); require('@sentry/hono'); console.log('ok')"` prints `ok`
3. `npm run lint && npm run typecheck` from repo root — exit 0
4. `backend/test/lib/observability-wiring.test.ts` passes — proves `app.use(sentry(` is wired AND is the first `app.use(` in `backend/src/index.ts` (class-correct behavioral guard; replaces the prior count-based grep)
5. `grep -E '"SENTRY_DSN"\\s*:' backend/wrangler.jsonc` returns NO matches (no literal DSN in git)
6. `grep -n 'SENTRY_DSN' backend/src/lib/env.ts` returns 1+ matches (the type declaration)
7. Manual (slice 1b): SC#4 deliberate-throw verification deferred — confirmed in slice 1b on the CF machine.
</verification>

<success_criteria>
- OBS-01 code-only portion landed: Sentry SDK installed, wired as first Hono middleware, scrubPayload exported and applied via beforeSend, defensive captureException in app.onError, SENTRY_DSN declared on Env without a literal in git.
- 5 RED tests turn GREEN (4 scrubPayload + 1 wiring).
- Pre-install checkpoint executed and approved (Task 1a) — supply-chain risk mitigated for `@sentry/hono`.
- No PII leakage path: scrubPayload + sendDefaultPii:false + DSN as secret all in place. ASVS V5 + V7 satisfied for this slice.
- **No Phase-1 success criteria close in slice 1a for OBS-01.** Slice 1b's SC#4 (deliberate-throw → Sentry within 1 min) verifies on the CF-enabled machine and depends on this code landing first. Slice 1a delivers the code; slice 1b delivers the closure of SC#4.
- Slice 1b deploy task can pick up directly: `wrangler secret put SENTRY_DSN` → `wrangler deploy` → SC#4 verification.
</success_criteria>

<output>
Create `.planning/phases/01-stabilize-backend-observability/01-05-SUMMARY.md` when done. Summary MUST:
- Update VALIDATION.md "Per-Task Verification Map" 5 OBS-01 rows from ⬜ → ✅.
- Record the `@sentry/hono` version pinned (from Task 1a checkpoint).
- List slice-1b handoff items: (a) run `wrangler secret put SENTRY_DSN <value>` on the CF machine; (b) `wrangler deploy`; (c) execute SC#4 deliberate-throw in events-batch.ts; (d) confirm Sentry receives the event within 1 min.
- Note explicitly: **0 SCs closed in slice 1a; SC#4 closes only after slice 1b deploy + verification.**
</output>
