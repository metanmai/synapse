# Architecture — Stabilize-for-Launch Milestone

**Project:** Synapse
**Milestone:** Launch (REQ-BUG-01..04 + REQ-MEASURE-01..03 + REQ-LAUNCH-01..03 + REQ-DOGFOOD-01)
**Researched:** 2026-05-19
**Confidence:** HIGH (existing codebase is the primary source; new code is bounded extensions to known files)

## TL;DR

Four new features land on top of an existing event-sourced pipeline:

| # | Feature | Integration shape | New components needed |
|---|---------|-------------------|------------------------|
| 1 | Worker observability (REQ-BUG-01 prereq) | Wrap `app.fetch` + `app.onError` + cron handlers in a try/catch+`ctx.waitUntil(report(...))` shim. Add a structured `console.log({ level: "error", req_id, route, err, stack })` sink. | `backend/src/lib/observability.ts` (logger + report helper), optional `/api/admin/errors` rolling-buffer view. |
| 2 | Brief rating (REQ-MEASURE-01) | A new `EventKind.BriefRated` flows through the *existing* event pipeline. Capture via slash command `/synapse:rate y\|n [note]`. Reducer rolls forward `brief_ratings[]` on `ProjectStatus`. Dashboard reads `GET /api/projects/:id/status` (already wired). | New event kind, new slash command, reducer extension, dashboard widget. **No new endpoint, no new table.** |
| 3 | Time-to-context (REQ-MEASURE-02) | Two new `EventKind`s: `BriefShown` (emitted by `session-start` hook with `shown_at`) and `FirstNonOrientationPrompt` (emitted by `user-prompt-submit` hook the *first* time the user prompt is not the literal brief acknowledgement). Reducer computes `time_to_context_ms` per session and aggregates. | Two event kinds, two hook handler tweaks, reducer extension, dashboard widget. **No new endpoint, no new table.** |
| 4 | Waitlist throttle (REQ-LAUNCH-01..02) | New `waitlist` table + a gate in `/auth/signup`: signups go to `waitlist` until admin promotes them. Promotion mints the real Supabase auth user + sends invite email. Dashboard `/api/admin/waitlist` for batch admit. | New migration `018_waitlist.sql`, new `backend/src/api/waitlist.ts`, frontend `/signup` rework, transactional email via Supabase Auth invite (or Resend if separate). |

**Build order:** 1 → 4 → 2 → 3 → dogfood. Observability first so the 1101 surfaces a real stack trace; waitlist second so the next steps run behind a closed door; telemetry last so it captures real (gated) traffic; dogfood lives on top.

---

## Existing Pipeline (one screen, for reference)

```
hook → events.jsonl → daemon flush → POST /api/events/batch
                                       ├─ upsert handoff_events (idempotent by event_id)
                                       └─ recomputeProjectStatus(pid) → handoff_project_status.status (JSONB)
                                                                         ↑
                                       daemon pull GET /api/projects/:id/status
                                                                         ↓
                                       cache/brief.md → session-start hook → stdout <synapse-brief>
```

The pipeline is **at-least-once + idempotent + append-only**. Anything we can express as an event kind inherits these properties for free. Anything we can't (rate tables, waitlist queue) must be designed for those properties separately.

---

## Feature 1 — Worker Observability (REQ-BUG-01 unblocker, indirect dep of every other REQ)

### Why first

REQ-BUG-01 (Cloudflare 1101) is the P0 blocker. The escape happens *outside* `app.onError` so we currently get no stack trace in `wrangler tail`. Without observability we are guessing — and every other feature depends on a working backend. The fix-the-bug path and the see-future-bugs path are the same path.

### Integration point

| Existing file | Change |
|---------------|--------|
| `backend/src/index.ts:51-65` (`app.onError`) | Add `ctx.waitUntil(reportError(c, err))` before the `c.json(...)` return. |
| `backend/src/index.ts:96-105` (`scheduled` handler) | Wrap the `runDailyAggregation` / `runScheduledGoogleSync` calls in try/catch + `reportError`. |
| `backend/src/api/events-batch.ts:132` (`Promise.all(recompute...)`) | Two-part fix: (a) wrap each `recomputeProjectStatus` in its own try/catch so one bad project doesn't reject the whole batch; (b) cap concurrency to 1 (sequential `for` loop) so we stay under the Workers subrequest budget on large batches. This is the *actual* 1101 fix candidate. |
| `backend/src/durable-objects/compaction-scheduler.ts` (alarm) | Wrap alarm body in try/catch + `reportError`. |
| New `backend/src/lib/observability.ts` | `reportError(c, err)` and `report(level, fields)`. Initially: structured `console.error(JSON.stringify({...}))` lines. CF Workers Logs (already enabled, see `wrangler.jsonc:41-47`) ingests them into the dashboard searchable surface. No external SaaS needed for launch. |

### Why not Sentry / Baselime / Logflare today

- **Sentry on Workers** works via `@sentry/cloudflare` but adds a subrequest per error (cost + latency budget) and needs an HMAC-signed transport. Not free, adds ops surface. *Defer.*
- **Baselime** was acquired by Cloudflare and folded into Workers Logs. The new home is already the dashboard's "Logs" tab. *Use what's there.*
- **Logflare / Axiom** require an HTTP shipping step from inside the worker → again, a subrequest. *Defer.*

For launch, the bar is "if `wrangler tail` is not running, can we still find a stack trace 4 hours later?". Workers Logs with `head_sampling_rate: 1` and `invocation_logs: true` (both already on) answers yes for the next 7 days of retention on the free plan. Good enough.

### Data flow

```
Worker request → handler throws → app.onError catches OR escapes
                                        │
                                        ├─ if caught: ctx.waitUntil(reportError(c, err))
                                        │           → console.error(JSON.stringify({ level, ts, req_id, route, method, user_id?, tier?, err_name, err_message, err_stack }))
                                        │           → ingested by Workers Logs (head sampling 100%)
                                        │
                                        └─ if escapes (the 1101 case): nothing we can do from JS; the wrap-and-cap fix above is what prevents the escape
```

### Schema sketch

Nothing in Postgres. All data lives in Workers Logs (Cloudflare-managed).

Optional (P1, post-launch): a `worker_errors` table for self-serve dashboard error browsing, populated by `ctx.waitUntil(db.from("worker_errors").insert(...))`. Not in scope this week — adds a write per error which is itself a failure mode during a backend outage.

### Risks

- **Subrequest budget.** Workers Free plan caps at 50 subrequests per invocation (Paid: 1000). The current batch endpoint already does up to N+2 subrequests per call (1 `project_members` select, N `projects` selects/inserts for placeholders, N+1 `project_members` inserts, 1 `handoff_events` upsert, N `recomputeProjectStatus` selects + N upserts). For a batch with N=10 cwd-hash projects, that's ~40 subrequests — uncomfortably close. **Mitigation:** the sequential loop in the fix avoids parallel kicks that would otherwise stack on top.
- **CPU time.** Workers Free: 10ms CPU (NOT wall-clock — 1101 is *not* a CPU timeout per se, but a generic unhandled exception). Paid: 30s. We're likely on Paid (the custom domain + DO migrations imply). Confirm in `wrangler whoami` before relying on the 30s budget. *Confidence MEDIUM — verify.*
- **Log volume.** 100% sampling at launch traffic (single dogfood user) is free. Past ~10k req/day it warrants down-sampling errors-only.
- **PII.** Don't log `user.email` or full request bodies. Log `user.id` (uuid) and the route only.

---

## Feature 4 — Waitlist Throttle (REQ-LAUNCH-01..02) — second priority

### Why before telemetry

The telemetry features (2, 3) need real users to generate signal. The waitlist is what *lets* users in. Building telemetry before the gate would mean shipping signal-gathering against zero traffic. Worse: if we open signups without a gate and the backend has a regression we missed, the blast radius is uncapped.

### Integration point

| Existing | Change |
|----------|--------|
| `backend/src/api/auth.ts:90` (`auth.post("/signup")`) | New behavior: instead of immediately creating a Supabase auth user, INSERT into `waitlist` and return `{ queued: true, position }`. Existing `findUserByEmail` short-circuit stays. |
| New `backend/src/api/waitlist.ts` | Mounted at `/api/admin/waitlist` (admin-only via `X-Admin-Secret`). `GET` lists queued users. `POST /:id/admit` runs the *original* signup path (create Supabase auth user + send invite email + delete waitlist row + record `granted_at`). |
| `frontend/src/routes/signup/+page.svelte` | After successful POST, show "You're #N on the waitlist — we'll email you when it's your turn" instead of redirecting to `/login`. |
| `frontend/src/routes/(app)/admin/waitlist/+page.svelte` (new) | List + "Admit batch of N" button. Behind the existing admin-secret cookie gate (or a new server-only auth check). |
| New migration `supabase/migrations/018_waitlist.sql` | See schema below. |
| `frontend/src/routes/login/+page.svelte` | Login attempt for non-existent user → friendly "Your spot is queued, we haven't emailed you yet" message instead of generic auth failure. |

### Data flow — signup

```
landing /signup form
    ↓ POST /auth/signup { email }
backend: SELECT 1 FROM waitlist WHERE email=$1
                                 OR FROM users WHERE email=$1
       ├─ if either present → 409 (existing behavior preserved)
       └─ else → INSERT INTO waitlist (email, source, queued_at) RETURNING id, position
              → return { queued: true, position }
frontend: show "You're #N on the waitlist"
```

### Data flow — admit

```
admin dashboard "Admit next 5"
    ↓ POST /api/admin/waitlist/admit?n=5  (X-Admin-Secret header)
backend:
  for each next 5 in waitlist ordered by queued_at asc, status='queued':
    1. supabase.auth.admin.inviteUserByEmail(email) — sends Supabase magic-link
    2. UPDATE waitlist SET status='admitted', granted_at=now() WHERE id=$1
    3. (the supabase auth.users → public.users trigger from migration 014 handles user-row creation when they click the link)
    return { admitted: 5, emails: [...] }
```

The clever choice here is **piggyback on Supabase Auth's existing invite email**. Supabase Auth's `auth.admin.inviteUserByEmail` sends a templated email with a magic-link, the user clicks, trigger from migration 014 creates the `public.users` row, and they land in the dashboard signed in. **No new email-sender integration (Resend / Postmark) needed.** Customize copy via `supabase/templates/invite.html` (already a directory we have for auth templates).

### Schema sketch — `018_waitlist.sql`

```sql
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  source text not null default 'landing',  -- 'landing' | 'admin_add' | future
  status text not null default 'queued',   -- 'queued' | 'admitted' | 'declined'
  queued_at timestamptz not null default now(),
  granted_at timestamptz null,
  notes text null
);

create index if not exists waitlist_status_queued_at_idx
  on waitlist (status, queued_at asc)
  where status = 'queued';

alter table waitlist enable row level security;
-- No public RLS policies; service-role-only writes from the Worker.
-- Admin reads via X-Admin-Secret-gated /api/admin/* (no JWT path).
```

`citext` extension is already enabled in `001_initial_schema.sql` for `users.email`. Reuse it.

### Position semantics

`position` = `(SELECT count(*) FROM waitlist WHERE status='queued' AND queued_at <= NEW.queued_at)`. Computed at INSERT-time and returned, not stored — it's monotonic over deletes. Don't display it after the user leaves the page (it'd drift); just confirm "you're in".

### Risks

- **Race on admit.** Concurrent admin clicks could double-invite. Mitigate with `UPDATE waitlist SET status='admitted' WHERE status='queued' AND id IN (...) RETURNING email` — only the rows that actually flipped get the email send.
- **RLS-as-defense.** The `waitlist` table has RLS on but no policies — so only the service role can read. Frontend has no anon-key path to the table. Good.
- **Supabase invite-email throttle.** Supabase free tier limits transactional emails to ~30/hour. Batch admit beyond that needs throttling or a true ESP (Resend free: 100/day, 3k/month). For a launch where we admit 5-20 a day, Supabase Auth is fine. *Note for post-launch.*
- **Existing users.** If `users` row exists for the email (e.g. team member already invited via `project_invites`), short-circuit to "you already have an account, sign in". Existing `findUserByEmail` handles this.
- **No Stripe-style "the waitlist is the dashboard".** Cold sign-ups land on a static "you're in" page, not a logged-in shell. Trying to use the dashboard before admission means they can't sign in — explicit "queued, not admitted yet" copy on `/login` is important.

---

## Feature 2 — Brief Rating (REQ-MEASURE-01) — third priority

### Why third (not first)

Telemetry on top of a broken pipe yields zero data. After Feature 1 (observability + 1101 fix) the pipe works; after Feature 4 (waitlist) at least one user is on it. Now rating data is worth collecting.

Also: ratings are the *deeper* feedback signal. Time-to-context is mechanical; ratings are intentional. Build the deeper one first while the dogfood loop is fresh.

### Integration point — capture

| Existing | Change |
|----------|--------|
| `packages/shared/src/handoff/events.ts` | Add `BriefRated = "brief_rated"` to the `EventKind` enum. |
| `packages/shared/src/handoff/types.ts:80` (`ProjectStatus`) | Add `brief_ratings: Array<{ session_id, rating: "good"\|"bad", note?: string, rated_at }>` and `rating_summary: { good: number, bad: number, last7: { good, bad } }` (or compute `last7` in the frontend — keep `ProjectStatus` shape minimal). |
| `packages/shared/src/handoff/reducer.ts:41` (switch) | New `case EventKind.BriefRated:` — append to `brief_ratings`, increment `rating_summary`. Bounded list (last 50? — match `recent_activity` pattern). |
| New `mcp/src/cli/handoff-commands.ts` export `runRateCmd(args)` | Parses `y\|n [note]`, calls `appendEvent({ kind: BriefRated, payload: { rating, note, brief_session_id }, attached_to: { type: "session", id: current_session_id } })`, then `signalFlush()`. |
| `mcp/src/cli/handlers.ts` `HANDLERS` map | Register `"rate": runRateCmd`. |
| `mcp/src/cli/init.ts:40` `SLASH_COMMANDS` | Add `/synapse:rate` → `synapse rate "$ARGUMENTS"`. |

### Integration point — surface

| Existing | Change |
|----------|--------|
| `frontend/src/routes/(app)/projects/[name]/+page.server.ts` | The `ProjectStatus` already comes back from `GET /api/projects/:id/status`. Just render `rating_summary`. |
| `frontend/src/lib/components/projects/RatingWidget.svelte` (new) | "Last 7 days: 8 :+1: / 2 :-1: (80%)" with sparkline. |

### Why slash command (and *not* a dashboard click, daemon push, or hook auto-prompt)

- **Hook auto-prompt** (e.g. ask after every SessionEnd): adds friction, dilutes signal, breaks the "hooks must never break Claude Code" invariant.
- **Dashboard click**: forces a context switch and decouples the rating from the moment of judgement. Low fidelity.
- **Slash command**: zero extra UI, lives in the same Claude Code surface the brief is displayed in, and reuses the entire existing capture pipeline (event → daemon → backend → reducer → projection). Marginal cost: ~20 lines in `init.ts` and `handoff-commands.ts`, one new EventKind, one reducer case.

### Data flow

```
/synapse:rate y "great context, missed the migration TODO"
    → synapse rate y "..."
    → appendEvent(events.jsonl, { kind: BriefRated, payload: { rating: "good", note: "..." }, attached_to: {session_id} })
    → signalFlush
    → daemon picks up → POST /api/events/batch (existing endpoint, no change)
    → upsert handoff_events
    → recomputeProjectStatus(pid) (existing path)
    → handoff_project_status.status.brief_ratings updated
    → daemon pull → cache/project_status.json → dashboard reads via API
```

### Schema sketch

None. The event lives in `handoff_events.payload` and the projection lives in `handoff_project_status.status` (JSONB). Both already exist.

### Risks

- **Reducer bloat.** `brief_ratings[]` grows unbounded with usage. Cap at 50 (matching `recent_activity`) and compute `rating_summary` as the running counter for the lifetime. The shared reducer is pure, so the cap is enforced by the reducer itself, not by the writer.
- **Attribution.** Which brief did this rate? Use `attached_to.session_id` = the *current* session's id (the session the user is in while typing `/synapse:rate`). The brief was shown at the SessionStart of *that* session. Resolvable from `handoff_events` by joining `attached_to.session_id` → the `BriefShown` event in that session (see Feature 3 below).
- **Spam / accidental double-rate.** Allow it. Reducer takes the *last* rating per `session_id`, not all of them. The event log still keeps the history for audit.

---

## Feature 3 — Time-to-Context (REQ-MEASURE-02) — fourth

### Why fourth

It depends on the existing hook surface and on Feature 2's reducer extension (for the dashboard view, REQ-MEASURE-03). Ship after ratings are flowing so the dashboard view ships them together.

### Integration point — capture

| Existing | Change |
|----------|--------|
| `packages/shared/src/handoff/events.ts` | Add `BriefShown = "brief_shown"` and `FirstNonOrientationPrompt = "first_non_orientation_prompt"`. |
| `mcp/src/hooks/session-start.ts:22` (where the brief is emitted) | After writing the `<synapse-brief>` block to stdout, append `BriefShown` event with `payload: { shown_at, brief_lines, brief_session_id: session_id }`. (When no brief exists — first session — emit anyway with `brief_lines: 0` so we still get a session start timestamp.) |
| `mcp/src/hooks/user-prompt-submit.ts:31` | Check `~/.synapse/projects/<id>/.first_prompt_logged` flag for the current session. If not present, append `FirstNonOrientationPrompt` event with `payload: { prompt_at, prompt_chars, brief_session_id: session_id }`, then touch the flag. |
| `packages/shared/src/handoff/reducer.ts` | Two cases. `BriefShown` stores `last_brief_shown_at` per session. `FirstNonOrientationPrompt` computes `time_to_context_ms = prompt_at - last_brief_shown_at`. Append to `ProjectStatus.time_to_context: Array<{ session_id, ms, recorded_at }>` (bounded 50). |
| `packages/shared/src/handoff/types.ts` | Add `time_to_context` field; same shape as `brief_ratings`. |

### Why hook-emitted (not daemon-emitted)

- **Daemon doesn't observe stdout.** It can't know when the brief lands in the user's terminal.
- **Hook fires synchronously with the user-visible event.** The `shown_at` timestamp from inside `session-start.ts` is the closest we can get to "the user saw the brief".
- **Reentry guard already there.** Both hooks short-circuit on `SYNAPSE_DAEMON_SESSION=1` so the inference daemon's own claude-haiku spawn won't contaminate the metric.

### What counts as "non-orientation"

Phase 1: every `UserPromptSubmit` past the first is "non-orientation". Crude but unambiguous.

Phase 2 (post-launch refinement): the first prompt whose body isn't a literal `/synapse:*` slash command or shorter than 10 chars. Keeps a `/synapse:doctor` immediately after the brief from being counted as "first real prompt".

### Schema sketch

Same as Feature 2: nothing new. Events in `handoff_events.payload`, projection in `handoff_project_status.status`.

### Risks

- **Clock skew between client write and shown_at.** Both happen on the same machine in `session-start.ts` so they share the same clock. The existing `SKEW_LIMIT_MS = 5min` skew guard in `events-batch.ts` will clamp `occurred_at` if a machine clock is wildly off, but we record `time_to_context_ms` as the *delta between two events on the same clock*, so we're robust to that.
- **First-session-ever has no brief.** `BriefShown.brief_lines: 0` is fine; the reducer should skip `time_to_context_ms` computation when `brief_lines === 0` (otherwise we'd report "100ms to context!" on the first-ever session, which is meaningless).
- **Sessions without a follow-up prompt.** If the user opens Claude Code, sees the brief, and walks away, there's no `FirstNonOrientationPrompt`. That's correct — they didn't get to context. Excluded from the metric.
- **Multiple sessions per project per day.** Each session_id is its own measurement. Aggregate by median (not mean) on the dashboard — distribution will be long-tailed.

### Data flow

```
SessionStart hook
    ↓
appendEvent({ kind: BriefShown, shown_at: now, brief_session_id: s_xxx })
    ↓ flush → backend → reducer
    handoff_project_status.status.time_to_context.last_shown[s_xxx] = shown_at

UserPromptSubmit hook (first time this session, .first_prompt_logged absent)
    ↓
appendEvent({ kind: FirstNonOrientationPrompt, prompt_at: now, brief_session_id: s_xxx })
    ↓ flush → backend → reducer
    delta = prompt_at - last_shown[s_xxx]
    handoff_project_status.status.time_to_context.measurements.push({ session_id: s_xxx, ms: delta })
```

---

## REQ-MEASURE-03 — Dashboard observability view

After Features 2 + 3, the data is already on `ProjectStatus`. The dashboard work is a single component:

| File (new) | Purpose |
|------------|---------|
| `frontend/src/lib/components/projects/TelemetryCard.svelte` | "Last 7 days: rating 80% good, median time-to-context 42s" with two micro-charts. |
| `frontend/src/routes/(app)/projects/[name]/+page.svelte` | Render the card above the existing brief/activity panels. |

Reads from the same `GET /api/projects/:id/status` response the rest of the page already loads. No new server work needed.

---

## Build Order — rationale

```
1. Worker observability + 1101 root cause           (unblocks everything)
  ↓
2. Waitlist throttle + Supabase invite email path   (gates traffic)
  ↓
3. Brief rating slash command + reducer + widget    (deeper signal first)
  ↓
4. Time-to-context hooks + reducer + dashboard card (mechanical signal,
                                                     bundled with the same view)
  ↓
5. Dogfood for ≥3 days                              (proves the loop end-to-end)
```

**Why this order, articulated:**

- Observability first → "we cannot iterate without a stack trace". This is the only feature in the milestone whose absence prevents us from working on the others.
- Waitlist second → no point in collecting telemetry against zero users. Also, opening signups before the backend is debugged is the *one* thing that turns a 1-user incident into an N-user incident.
- Ratings before time-to-context → ratings need a slash command (new surface), time-to-context just instruments existing hooks. Ratings is the higher-risk, higher-information piece; build it while attention is fresh.
- Dashboard view last → it composes the previous two and has no value before either lands.
- Dogfood last → REQ-DOGFOOD-01 is a *trust-but-verify* run, not a build task. It happens in real time after the build is done.

REQ-BUG-02, 03, 04 (P1 install bugs) are independent and can interleave with any of the above. They don't sit in the dependency graph.

---

## Component Boundary Summary (what extends, what's new)

### Extends (in place)

- `packages/shared/src/handoff/events.ts` — three new `EventKind` literals
- `packages/shared/src/handoff/reducer.ts` — three new `case` blocks
- `packages/shared/src/handoff/types.ts` — `ProjectStatus` gains `brief_ratings`, `rating_summary`, `time_to_context`
- `mcp/src/hooks/session-start.ts` — append `BriefShown` after stdout
- `mcp/src/hooks/user-prompt-submit.ts` — append `FirstNonOrientationPrompt` on first call per session
- `mcp/src/cli/handoff-commands.ts` — `runRateCmd`
- `mcp/src/cli/handlers.ts` — register `rate`
- `mcp/src/cli/init.ts` — slash command `/synapse:rate`
- `backend/src/index.ts` — onError observability wrap, scheduled try/catch
- `backend/src/api/events-batch.ts:132` — sequential recompute + per-project try/catch (the 1101 fix)
- `backend/src/api/auth.ts:90` (`auth.post("/signup")`) — divert to waitlist insert
- `frontend/src/routes/signup/+page.svelte` — "queued" success state
- `frontend/src/routes/login/+page.svelte` — "queued, not yet admitted" copy

### New

- `backend/src/lib/observability.ts` — `reportError`, structured logger
- `backend/src/api/waitlist.ts` — admin-only list + admit endpoints
- `supabase/migrations/018_waitlist.sql` — waitlist table + index + RLS
- `supabase/templates/invite.html` (customize copy on existing template)
- `frontend/src/routes/(app)/admin/waitlist/+page.{server.ts,svelte}` — admit UI
- `frontend/src/lib/components/projects/RatingWidget.svelte`
- `frontend/src/lib/components/projects/TelemetryCard.svelte`

### Untouched (load-bearing — do not modify)

- Daemon flush/pull loop (`mcp/src/capture/daemon.ts`, `handoff-sync.ts`)
- Hook dispatch (`mcp/src/cli/hook-dispatch.ts`)
- Events log writer (`mcp/src/capture/events-log.ts`)
- RLS policies on `handoff_*` tables
- Streamable HTTP MCP transport (`backend/src/mcp/`)
- Creem billing (`backend/src/api/billing.ts`)

---

## Cloudflare Worker Constraint Audit (per the quality gate)

| Constraint | Value | Where it bites in this milestone |
|------------|-------|-----------------------------------|
| CPU time | Free: 10ms. Paid: 30s wall, 30s CPU. | `recomputeProjectStatus` reads ALL events per project + runs `reduce()` — O(events) per batch per project. With N projects in one batch this is the leading 1101 candidate. **The sequential-loop fix bounds the *peak concurrent* compute, not the total; if a single project has 10k events the same call still times out.** *Tracked as P4 BUGS.md #11.* |
| Subrequest count | Free: 50. Paid: 1000. | Current batch path uses ~3 + 2N + 2K subrequests (auth, members select, K project-create-pairs, events upsert, N recompute selects + upserts). Tight on Free. Mitigation: confirm Paid plan. |
| Request body size | 100 MB | Not a constraint — batches are bounded by daemon flush size (~1k events). |
| Response body size | unlimited streaming, but `c.json` buffers | OK at current scale. |
| Workers Logs retention | 7 days head-sampled | OK for stabilize-for-launch. |
| Durable Object alarm CPU | Same as Worker CPU | `CompactionScheduler` alarm wraps an LLM call; if Anthropic is slow it can eat CPU budget. Already gated by Plus tier (no Free-tier impact). |
| Cron handler CPU | Same | `runDailyAggregation` at 03:00 UTC + Google sync at `*/5`. Wrap in try/catch + observability. |
| Cold start cost | ~5ms | Negligible. |

**Verify before launch (HIGH priority):** Are we on Workers Paid? `wrangler whoami` will say. If not, upgrade — Free tier's 10ms CPU / 50 subrequests is unsafe for the batch endpoint regardless of which bug we fix.

---

## Risks per Integration Point (consolidated)

| Integration | Risk | Mitigation |
|-------------|------|------------|
| Sequential `recomputeProjectStatus` | A batch with 50 projects × 1k events each could hit the 30s CPU limit. | Cap N per batch at backend (return 413 + ask daemon to chunk). Daemon already chunks at flush time but doesn't cap project count. Add a `MAX_PROJECTS_PER_BATCH = 20` constant. |
| New `EventKind`s in reducer | If a *future* client sends a kind the reducer's switch doesn't recognise, it falls through silently (existing behavior). Forward-compat preserved. | None needed. |
| Waitlist `auth.admin.inviteUserByEmail` | Returns 422 if email already in `auth.users`. | Pre-check via `findUserByEmail` (already in `auth.post("/signup")`). |
| Waitlist `citext` constraint | Case-insensitive uniqueness — emails differing in case dedupe. | Desired behavior; matches `users.email` semantics. |
| RLS on `waitlist` | Service-role-only; admin reads via `X-Admin-Secret`. Frontend admin route must use service-role-backed Worker calls, not anon-key Supabase. | Wire admin page through the existing `/api/admin/*` pattern. |
| `BriefShown`/`FirstNonOrientationPrompt` clock skew | Same machine, same clock → robust. | None needed. |
| Hook adds an extra `appendEvent` per session | Two extra writes per session to a local jsonl file. | Trivial perf cost; already amortised by the daemon. |
| Rating slash command in a deep `claude` subprocess | `SYNAPSE_DAEMON_SESSION=1` reentry guard would suppress it if the daemon spawned the rating somehow. Users never rate from inside the daemon. | Document — not a real path. |
| Observability `console.error` JSON lines | At high traffic the log volume could outgrow free retention. | We're at single-user dogfood scale; reassess post-launch. |
| Supabase invite email rate limit | ~30/hour on free Supabase tier. | Admit in batches ≤ 25. Move to Resend post-launch if needed. |

---

## Open Questions (flag for roadmap / phase research)

1. **Workers plan confirmation.** Is this account on Workers Paid? If Free, the 1101 fix may still leave us within budget — but only by luck. (Quick check, not a phase.)
2. **Rating attribution semantics.** When a user rates *after* a new session has started (rated yesterday's brief while in today's session), should the rating attach to `session_id` of the rating-time session or to the brief-time session? Tentative answer: rating-time session, because `attached_to` already points there, and reducer can find the previous session's brief via the most-recent `BriefShown` event. Confirm during build.
3. **Time-to-context outliers.** What's the cap on a "valid" measurement before we treat it as an abandoned session? Suggest 30 min (matches `IDLE_THRESHOLD_MS` from the reducer). Anything past that → drop, not "infinity".
4. **Waitlist landing copy.** Who writes it? Defaults to bare "you're in" — that's fine for soft launch, but a roadmap item.
5. **Admin UI auth.** Reuse `X-Admin-Secret` (which is per-request and not session-based) or build a proper admin-session cookie? For one developer, reuse. For "give CI a button", build the session. Suggest: defer the session work, ship the header path now.

---

## Sources

- `/Users/Tanmai.N/Documents/synapse/.planning/codebase/ARCHITECTURE.md` — primary
- `/Users/Tanmai.N/Documents/synapse/.planning/codebase/INTEGRATIONS.md` — primary
- `/Users/Tanmai.N/Documents/synapse/.planning/codebase/STRUCTURE.md` — primary
- `/Users/Tanmai.N/Documents/synapse/.planning/PROJECT.md` — primary
- `/Users/Tanmai.N/Documents/synapse/docs/BUGS.md` — primary
- `/Users/Tanmai.N/Documents/synapse/backend/src/index.ts` — primary
- `/Users/Tanmai.N/Documents/synapse/backend/src/api/events-batch.ts` — primary
- `/Users/Tanmai.N/Documents/synapse/backend/src/lib/handoff-reducer.ts` — primary
- `/Users/Tanmai.N/Documents/synapse/backend/src/api/auth.ts` — primary (signup flow)
- `/Users/Tanmai.N/Documents/synapse/backend/wrangler.jsonc` — primary (observability config, current state)
- `/Users/Tanmai.N/Documents/synapse/mcp/src/capture/daemon.ts` — primary (flush/pull loop)
- Supabase migration history (`supabase/migrations/000..017`) — primary (RLS + auth-trigger patterns)
- Cloudflare Workers Limits documentation (training data, MEDIUM confidence — verify the 50-subrequest / 30s-CPU numbers with `wrangler whoami` and the dashboard before relying on them at launch)
