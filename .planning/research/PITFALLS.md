# Pitfalls Research — Synapse Stabilize-for-Launch Milestone

**Domain:** AI coding session capture & handoff tool launching with telemetry + waitlist throttle on a 5-day timeline.
**Researched:** 2026-05-19
**Confidence:** HIGH for items grounded in this codebase (BUGS.md, CONCERNS.md, retros). MEDIUM for general launch / waitlist / telemetry patterns synthesized from external sources.

Pitfalls below are ordered by expected blast radius for *this milestone*. Every pitfall has an observable warning sign with a measurable signal (log line, metric, file artifact) — not vibes. Prevention strategies reference specific files in the repo so the roadmap can map each pitfall to a phase that touches that file.

---

## Critical Pitfalls

### Pitfall 1: Re-deploy backend "fix" for the 1101 without reproducing the exception locally first

**What goes wrong:**
The 1101 escapes Hono's `app.onError` boundary (per BUGS.md #1) — meaning blind `try/catch` patches at `backend/src/api/events-batch.ts:37` won't catch the real cause. A developer guesses (subrequest limit? CPU? reducer throw?), ships a wrapper, daemon flush still fails the same way, and now there's no way to tell whether the original cause was fixed because the new try/catch swallows everything.

**Why it happens:**
Time pressure on a P0 with no test (BUGS.md #5a: `events-batch.test.ts:44-56` is `.skip`'d) makes "wrap everything in try/catch and ship" feel like progress. Cloudflare's 1101 page literally lists "wrap in try/catch" as solution #1, which it is *not* for promise-rejection-inside-Promise.all.

**How to avoid:**
1. **Before any code change**, run `cd backend && wrangler tail --name synapse --format pretty` in one terminal and trigger a real daemon flush against production from another. Capture the JS stack trace from `wrangler tail`. BUGS.md #1 spells out the diagnostic plan — do not skip it.
2. If `wrangler tail` doesn't reproduce, stand up `wrangler dev` with `backend/.dev.vars` populated from production secrets and hit the dev endpoint with one of the real captured payloads from `~/.synapse/projects/<id>/events.jsonl`.
3. Only after the stack trace identifies the throw site, write the fix. The likely site is `Promise.all(projectIds.map(pid => recomputeProjectStatus(db, pid)))` at `events-batch.ts:132` — the reducer falling through on an unexpected `tool_used` shape (per CONCERNS.md "Performance Bottlenecks" §1).
4. Add a non-skipped test at `backend/test/api/events-batch.test.ts` that injects the same payload shape via a mocked `db` so this can't silently regress.

**Warning signs (observable):**
- `wrangler tail` shows the same stack frame across multiple test invocations after the fix → real fix.
- Daemon log `~/.synapse/daemon.log` stops emitting "flush failed: 500" lines for ≥30 minutes during dogfood → fix held.
- Conversely: deploy ships, daemon log still shows ≥6 lines/min of flush errors (current rate per BUGS.md #12) → fix did not address the cause.

**Severity:** Critical — every other REQ on this milestone depends on the daemon being able to reach the backend.

**Phase to address:** Phase 1 (Stabilize: BUGS.md P0 fixes). Verification: `dashboard /api/projects/list` shows ≥1 project for this user with a `last_event_at` within the last 60s.

---

### Pitfall 2: Ship telemetry that itself breaks the capture loop

**What goes wrong:**
To get REQ-MEASURE-01 (thumbs Y/N) and REQ-MEASURE-02 (time-to-context timestamps), telemetry hooks into SessionStart and the first non-orientation message. If the telemetry write is synchronous, blocks SessionStart, or shares the events.jsonl append path with `appendEvent` (CONCERNS.md "Synchronous file IO in hot daemon paths"), a telemetry bug can stall or corrupt the very capture loop that's the product's Core Value.

**Why it happens:**
The reflex when adding instrumentation is "just add the call to the existing handler." `mcp/src/cli/hook-dispatch.ts` is the obvious place — but it runs inside Claude Code's process with the comment "Hooks must never break Claude Code" (`mcp/src/cli/commands.ts:186`). A thrown error or 30s network hang here is user-visible.

**How to avoid:**
1. **Telemetry must use a separate code path from event capture.** Define `recordTelemetry(kind, payload)` in a new file (suggest `mcp/src/capture/telemetry.ts`) that writes to a *separate* file `~/.synapse/projects/<id>/telemetry.jsonl` and is flushed by a *separate* call in `runFlushCycle`. The `events.jsonl` watermark and the `telemetry.jsonl` watermark must not share state.
2. **Telemetry writes must be wrapped in try/catch that logs to stderr and returns** — never throw out of a hook handler. The current `appendEvent` pattern (`mcp/src/capture/events-log.ts:26-37`) is the model but it currently *does* throw sync errors — fix that before reusing it.
3. **Time-to-context timestamp must be derived, not double-instrumented.** Don't add new hook calls. Compute `time_to_context = first_user_message.ts - session_start.ts` server-side from existing `SessionStart` and `UserPromptSubmit` events that are already captured. This is the cheapest, lowest-risk implementation and prevents drift between timer and event log.
4. **Thumbs Y/N must be opt-in user-initiated** (e.g. an inline slash command `/synapse rate Y` or `N`) rather than a hook that auto-fires. Auto-firing creates rating spam and skews the signal toward "users who didn't bother to dismiss it."

**Warning signs (observable):**
- `claude` (the editor) shows a stderr flash or hangs >200ms on SessionStart after telemetry lands → hook is blocking; revert.
- `~/.synapse/daemon.log` shows telemetry errors but events.jsonl flush rate is unchanged → isolation worked.
- `events.jsonl` byte size grows ≥2x post-telemetry → telemetry is being written to the wrong file; investigate.
- Brief usefulness dashboard shows >80% Y after 24h with N=10 → likely auto-firing bias, not real signal.

**Severity:** Critical — breaks Core Value if it goes wrong; useless signal even when it "works" if it auto-fires.

**Phase to address:** Phase 2 (Telemetry). Verification: kill-switch test — set `SYNAPSE_TELEMETRY_DISABLED=1`, confirm daemon log shows zero telemetry attempts AND capture loop is unaffected. Also: a 24h dogfood window where Y/N submissions ≤ session count (no auto-fires).

---

### Pitfall 3: Waitlist throttle with no admission signal becomes a dead letter office

**What goes wrong:**
REQ-LAUNCH-01 puts new signups in a queue. REQ-LAUNCH-02 sends an email when admitted. But: (a) email goes to spam; (b) user signed up 3 weeks ago and forgot why; (c) the "admitted" email links to `/login` but the user has no account because they only joined the waitlist; (d) the wizard runs into BUGS.md #3 (npx blocked) on their corporate network and they bounce. Net result: queue fills, admissions go out, no one converts, and the only signal we have ("X people on waitlist") is meaningless.

**Why it happens:**
"Waitlist" is one word in REQ-LAUNCH-01 but it's actually a 4-step user journey: signup → wait → notification → activation → install success. Each step has a drop-off and we have no measurement on any of them yet.

**How to avoid:**
1. **Instrument the funnel before opening the door.** Add a `waitlist_state` enum on the user (`pending`, `admitted`, `signed_in_after_admit`, `wizard_completed`, `daemon_alive_first_flush`) and increment on each transition. This is one DB column + ~5 write sites. Without this, "the waitlist is working" is unmeasurable.
2. **Admission email must contain the next concrete action** — not "you're in!" but "run this one command: `curl -fsSL https://synapsesync.app/install.sh | sh`" (or whatever the install path is). The email is the only handhold this user has between signup and first value. Test it against the proxy-blocked case (REQ-BUG-03): if `npx` is the install path, the email must mention the global-install fallback.
3. **Cap admission batch size at something you can manually unblock.** For a solo dogfood-only milestone with a 5-day deadline, batch=5/day is plenty. The point of throttle is "if something is wrong, the wrongness is contained." 50/day defeats that.
4. **Set a hard waitlist size cap** (e.g. 200) at the signup form. If the waitlist hits cap, the form says "waitlist full — check back next week." Better than silently queueing 5000 people you'll never admit before this product pivots.
5. **Send a "you're still on the waitlist, here's where things stand" email at signup + 7 days** so the eventual admit isn't cold.

**Warning signs (observable):**
- After admission batch: `waitlist_state = admitted` count rises but `signed_in_after_admit` doesn't catch up within 48h → admission email is going to spam, or the link is broken, or the user lost interest. All actionable.
- `signed_in_after_admit` rises but `wizard_completed` doesn't → install pipeline (still BUGS.md #3 / #4) is broken for these users.
- `wizard_completed` rises but `daemon_alive_first_flush` doesn't → P0 #1 silently regressed for non-dogfood users, OR the daemon is failing on a platform we didn't dogfood (Linux, intel mac, etc.).

**Severity:** High — bad first impression with waitlisted users is unrecoverable; without instrumentation, the entire launch signal is invisible.

**Phase to address:** Phase 3 (Waitlist). Verification: synthetic test account walks the full funnel; each `waitlist_state` row gets written; admission email lands in a real Gmail / Outlook inbox (not just localhost SMTP). Solo dogfood (REQ-DOGFOOD-01) must include at least one rehearsal where the dogfooder uses the waitlist link from the admission email instead of bypassing it.

---

### Pitfall 4: Solo dogfood as the only signal — confirmation bias and <30-min-user blindness

**What goes wrong:**
The dogfooder (REQ-DOGFOOD-01) is the person who built the tool. They know the working install path. They know which network to use to bypass the proxy. They auto-pattern-match around UX gaps. Their session length skews toward hours, not the 5-30 minute "evaluate this tool" sessions a new user runs. Their brief-usefulness ratings reflect *their* mental model of the brief, not a fresh user's. Net: dogfood "works" for 3 days, launch goes out, and the actual user signal is wildly off.

**Why it happens:**
The decision to skip friend/external pre-launch testing (PROJECT.md "Out of Scope" + Key Decision: "Solo dogfood is the only pre-launch user signal") was the right call for speed. But the cost is real — and unmitigated, the signal collected during dogfood is meaningless for predicting real-user behavior.

**How to avoid:**
1. **Adversarial dogfood rules.** Before each dogfood session, the dogfooder writes down: (a) what they expect to happen, (b) what time it is, (c) which network they're on. After: did the brief match what they wrote down? If yes 3 days in a row → suspicious (confirmation bias). The brief should occasionally be wrong; if it's never wrong, the rating signal is noise.
2. **Run one "cold-laptop" rehearsal** (REQ-LAUNCH-03 already covers this) — fresh user account, fresh machine, on the corporate proxy. This single 30-minute exercise will find more launch-blockers than 3 days of normal dogfood. Schedule it for day 4 of the 5-day window so there's a buffer day for the inevitable breakage.
3. **Pre-commit specific failure conditions** that abort the launch. Examples (per the current bug list): "if daemon log shows flush errors >3/hr during dogfood, launch is paused"; "if any of REQ-BUG-01 through 04 has a regression in the 24h before launch, ship date slips." Without these, the dogfooder will rationalize launching with broken stuff because "it's mostly working."
4. **Mute your own ratings.** The Y/N thumbs from REQ-MEASURE-01 should record `actor = "developer"` for the dogfooder so the dashboard can filter them out of the aggregate. Otherwise the first 50 ratings are all the same person and biased.

**Warning signs (observable):**
- Dogfood log shows zero failed flushes for 3 days → either P0 is genuinely fixed OR the dogfooder is hitting only the happy path. Cross-check with `wrangler tail` showing zero 1101 across the same window before believing it.
- Y/N ratings during dogfood are >90% Y → likely confirmation bias; tighten the "is the brief actually useful?" test (e.g. cover the brief and try to predict what's in it before reading).
- Cold-laptop rehearsal turns up >0 install-time failures → BUGS.md P1 items are not actually fixed for real users.

**Severity:** High — silent because the failure mode is "we thought we were ready and we weren't." Maps directly to launch quality.

**Phase to address:** Phase 4 (Dogfood / Launch readiness). Verification: dogfood notes file with day-by-day predict/observe entries; cold-laptop rehearsal log; pre-commited abort conditions checked off before push.

---

### Pitfall 5: "One more thing" scope creep eats the 5-day window

**What goes wrong:**
Day 3 of 5, the dogfooder notices the brief has a typo / the dashboard could use a chart / the 409 device picker would be nice / the unused-CSS warnings are bothering them (BUGS.md #13). They fix one — it takes 4 hours. Now there are 2 days left, REQ-BUG-04 still isn't done, telemetry is half-shipped, and the waitlist throttle hasn't been tested end-to-end. Launch slips a week.

**Why it happens:**
Solo developers have no PM saying no. The "Out of Scope" list in PROJECT.md is explicit but the brain reads "P2-P4 not blocking launch" as "P2-P4 if I have time" — and there's always 30 minutes that feels like time.

**How to avoid:**
1. **Make the Out of Scope list a hard gate.** Every day, before any commit, the dogfooder lists the day's planned work and cross-checks each item against PROJECT.md "Out of Scope". If any line item is in Out of Scope, it doesn't ship today. This is a 60-second ritual.
2. **A new `BUGS.md` entry is the answer to every "one more thing".** Drop-in entry, severity-labeled, file location captured, ship later. The repo already does this (it's the canonical pattern). Use it.
3. **Pre-commit hook check (advisory).** A check that `git diff --stat` doesn't touch files outside the active milestone's REQ areas. Not a block — just a prompt. Files in scope this milestone: `backend/src/api/events-batch.ts`, `mcp/src/capture/handoff-sync.ts`, `mcp/src/cli/init.ts`, `mcp/src/cli/editors/io.ts`, plus the new telemetry + waitlist code. Anything outside → prompt "this looks out of scope, continue?"
4. **Time-box research / debugging.** If REQ-BUG-01 isn't fixed after 4 hours of focused work, that's a signal to ask for help / change approach, not "push through." A bad fix shipped because you ran out of time is worse than a slipped milestone.
5. **No new milestone-mid features.** REQ-MEASURE-03 (dashboard observability) is the riskiest item — it's UI work that's easy to expand. Ship the minimal-viable version (one chart, no filters) and resist any "while I'm here…"

**Warning signs (observable):**
- `git log --since='1 day ago' --stat` shows commits touching files outside the milestone's REQ areas → scope creep happening.
- Day 4 status: more than one P0/P1 still open → cut a P1 or slip the launch. Don't try to "push through."
- More than 2 hours spent on any single P2 / P3 / P4 item → stop, file in BUGS.md, move on.

**Severity:** High — the most likely cause of missing the 5-day window.

**Phase to address:** Every phase. Phase plans should include explicit "out of scope for this phase" lists and acceptance criteria that don't drift.

---

## Moderate Pitfalls

### Pitfall 6: Telemetry retroactively breaks the cache contract

**What goes wrong:**
REQ-MEASURE-02 wants a time-to-context timestamp written server-side. If the new fields land in `handoff_project_status` (the materialized view in `backend/src/lib/handoff-reducer.ts`) but the `renderBriefFromCache` consumer (`mcp/src/capture/handoff-brief.ts:32`) isn't updated for the new shape — or worse, an old daemon talking to a new backend gets a JSON shape it doesn't know how to parse — briefs go blank. The cache contract is asymmetric: backend ships first, daemons update on user-upgrade-cadence (which can be never).

**Why it happens:**
The codebase doesn't version `ProjectStatus`. The MCP package version and the backend version drift independently. CONCERNS.md "MCP SDK version skew" flags this for the SDK already; same risk applies to internal data shapes.

**How to avoid:**
1. **All new telemetry fields on `ProjectStatus` must be optional** (TypeScript optional + DB nullable) for at least the first deploy. The old daemons should silently ignore them.
2. **Add a `schema_version` field to `ProjectStatus`** as part of this milestone if it's not there already. If the cache version doesn't match what the renderer expects, log a hint and use the version-N renderer fallback. CONCERNS.md "Brief renderer fails open when cache is missing" §4 already shows the pattern for graceful degrade.
3. **Test the cross-version case explicitly.** Deploy backend, do not upgrade local daemon, run a session. Brief should still render with whatever fields the old daemon knows about.

**Warning signs (observable):**
- Brief output suddenly missing sections that were there yesterday → schema break.
- Daemon log: `JSON.parse` error in `runPullCycle` after backend deploy → contract broke.
- Dashboard observability chart shows `null` time-to-context for users on old daemon versions → expected; document it.

**Severity:** Medium — recoverable but visible to users.

**Phase to address:** Phase 2 (Telemetry). Verification: deploy backend without upgrading the dogfood machine's daemon; brief still renders something sensible.

---

### Pitfall 7: Adding more daemon events overwhelms `recomputeProjectStatus`

**What goes wrong:**
CONCERNS.md "Performance Bottlenecks" §1 already flags `recomputeProjectStatus` as O(events_per_project) per flush. Telemetry adds at minimum 2 new event types (rating-submitted, first-non-orientation-message). If the reducer grows from N=6 to N=8 cases and is called more often per session, the 50ms Workers CPU budget gets squeezed — and that may *be* the 1101 we're chasing right now.

**Why it happens:**
The cost is invisible at small scale (the dogfooder's local project has <1k events). It hits a wall when a power user hits 10k+ events in one project, or when a batch flushes 4 projects at once. Both are realistic post-launch scenarios.

**How to avoid:**
1. **Telemetry events should not flow through `handoff_events`** if at all possible. Use a separate table (`telemetry_ratings`, `telemetry_timestamps`) with its own simple insert path that bypasses the reducer. The reducer's job is the project-state model; telemetry is a sidecar.
2. **If telemetry events must be in `handoff_events`** (e.g. because the reducer needs to know whether a rating was given to fold into status), add the watermarked-incremental-reduce that CONCERNS.md §1 recommends. The short-term fix sketched there is sufficient: store `last_reduced_event_id` and only fold new events.
3. **Cap projects per batch.** Add a `projectIds.length > 20` guard at `backend/src/api/events-batch.ts:131` that returns 400. Better to fail explicit than to 1101.

**Warning signs (observable):**
- `wrangler tail` shows `Worker exceeded CPU time` warnings → reducer is hitting the budget.
- Specific project consistently times out → that project has the long event history, treat as the canary.
- 1101 rate spikes after telemetry deploy → very likely the reducer.

**Severity:** Medium — capacity wall, but might masquerade as the original P0.

**Phase to address:** Phase 2 (Telemetry). Verification: synthetic 5000-event project flushes successfully; `wrangler tail` shows no CPU-time warnings.

---

### Pitfall 8: Waitlist email goes from `noreply@` and gets junked

**What goes wrong:**
REQ-LAUNCH-02 requires an email when waitlist activates. The cheapest implementation is "use Supabase auth's built-in email" or "send from `noreply@synapsesync.app` via a transactional provider." Both have a real chance of going to spam, especially on Gmail's strict bulk-sender rules. The user never sees the email, the activation signal looks broken, and we waste days investigating "why doesn't anyone activate?"

**Why it happens:**
Email deliverability is the most-underestimated launch problem. Even with SPF/DKIM/DMARC set up correctly, brand-new sending domains have low reputation and get junked.

**How to avoid:**
1. **Send from a configured transactional provider** (Resend, Postmark, AWS SES) with SPF + DKIM + DMARC set up at the DNS layer. This is one afternoon of config but it's the difference between 80% inbox and 20% inbox.
2. **Use a personal-ish from-address** ("Tanmai from Synapse <tanmai@synapsesync.app>") rather than `noreply@`. Higher deliverability + sets expectation that replies are read.
3. **Send a tiny "you're on the waitlist" email at signup time** to warm up the sender reputation and confirm the address is valid. Pre-validates the deliverability path.
4. **Provide an in-dashboard "your status" view** so the user has a non-email signal of their state. The email is a notification, not the only channel.
5. **Manually verify deliverability** — send a test admission email to a Gmail, Outlook, iCloud, and Fastmail address. Check that it lands in inbox, not promotions or spam.

**Warning signs (observable):**
- The dogfooder's test address shows the email in spam → fix before launch.
- Postmark / Resend dashboard shows bounces or complaints >1% → reputation problem.
- Activation rate (`signed_in_after_admit / admitted`) is <50% in the first week → likely deliverability, *or* the install-after-admit experience is broken — instrument the funnel (Pitfall 3) to disambiguate.

**Severity:** Medium — easy to fix if caught in dogfood; expensive to debug post-launch.

**Phase to address:** Phase 3 (Waitlist). Verification: test email lands in real Gmail / Outlook inboxes (not just sender's own inbox); SPF/DKIM/DMARC verified via `mxtoolbox` or equivalent.

---

### Pitfall 9: BUGS.md #12 — daemon hammers a broken backend with no backoff

**What goes wrong:**
This is already documented in BUGS.md #12 but it's worth elevating in the pitfall list because launching with telemetry adds load to the same broken flow. If REQ-BUG-01 regresses post-launch (Pitfall 1 above), every active user's daemon hits the dead endpoint every 10s indefinitely, fills their `daemon.log` (~6 lines/min), and bursts on recovery. With 50 waitlist-admitted users at launch, that's potentially 300 invocations/minute against a sick backend — which might prolong the outage.

**Why it happens:**
The daemon was built for the optimistic case. The retry loop at `mcp/src/capture/daemon.ts:164` doesn't differentiate "backend dead" from "transient failure."

**How to avoid:**
1. **Implement exponential backoff with jitter** as BUGS.md #12 sketches — 10s → 20s → 40s → cap 5min, reset on first 2xx. This is a ~30-line change in `runFlushCycle` / `startHandoffLoop`.
2. **Circuit-breaker the dashboard observability views** (REQ-MEASURE-03) so they don't make a Supabase query on every render if the backend is degraded. A 60s in-memory cache on read paths buys headroom during incidents.
3. **Cap daemon log size** with rotation (the file currently grows unboundedly per CONCERNS.md "Scaling Limits"). Users finding their disk full because of a backend outage = bad first impression.

**Warning signs (observable):**
- Backend deploy: 1101 rate spikes for several hours instead of seconds → user daemons are bursting on recovery, no backoff implemented.
- User report "my disk is full" → daemon log grew unbounded during an outage.
- Cloudflare invocations metric shows constant high baseline → daemons hammering when backend is degraded.

**Severity:** Medium — masks itself as "the backend can't recover" but is actually clients DDOSing recovery.

**Phase to address:** Phase 1 (Stabilize) — alongside the P0 fix. Verification: simulate a 5-minute backend outage; daemon logs show progressively spaced retries; recovery shows a single retry, not a burst.

---

## Minor Pitfalls

### Pitfall 10: Mixing per-device key minting with rapid sign-ins during dogfood

**What goes wrong:**
The per-device CLI keys feature (shipped `a8ecf98` + `34de058`) is new. Dogfood that involves running `synapse init` from multiple shells / multiple machines could hit BUGS.md #5 (no 409 picker UI), giving a confusing 500 error mid-dogfood. The dogfooder thinks the install pipeline is broken when it's actually working as designed but lacking UI for the edge case.

**Why it happens:**
The dogfooder is a Plus-tier user and won't hit the 3-device limit. But if they're testing the waitlist user journey from a clean account (per Pitfall 4), they're on the free tier and might.

**How to avoid:**
1. Use a different test account for cold-laptop rehearsal so the dogfooder's main account device count isn't burned through.
2. If a 409 is hit during rehearsal, manually revoke an old key via the dashboard before retrying. Document this in the rehearsal log so a real user's hitting it is a known followup, not a launch blocker.
3. Don't try to ship the 409 picker UI this milestone. PROJECT.md "Out of Scope" already lists it; honor that.

**Warning signs (observable):**
- Cold-laptop rehearsal hits a generic 500 from `Continue as…` → likely 409 underneath. Check `wrangler tail` for the HTTP code.

**Severity:** Low — known and tracked.

**Phase to address:** Phase 4 (Dogfood) — process discipline, not code.

---

### Pitfall 11: `synapse init` overwrites a user-customized service file

**What goes wrong:**
CONCERNS.md "Fragile Areas" §5: `writeServiceFile` overwrites the launchd plist / systemd unit unconditionally. A dogfood-with-custom-tweaks workflow (e.g., the dogfooder set their own `KeepAlive` policy or `nice` value) will lose those edits the next time `init` runs as part of testing REQ-BUG-04.

**Why it happens:**
The fix in commit `d3cd771` made `init` more aggressive about writing service files (correct, because before it wasn't even `launchctl load`ing them). Aggressive overwrite is now the default path.

**How to avoid:**
1. **Don't rely on local plist customizations during dogfood.** Reset to canonical state before each rehearsal so the test reflects what a real user sees.
2. **If a customization is needed, document it** in the dogfood log so it's not silently lost.
3. **Out of scope for this milestone** to add the "ask before overwrite" UX. File as a follow-up after launch.

**Warning signs (observable):**
- After `synapse init`, `~/Library/LaunchAgents/app.synapsesync.daemon.plist` contains different content than before → expected, plan accordingly.

**Severity:** Low — only affects the dogfooder if they've customized.

**Phase to address:** Phase 1 (BUGS.md fixes) — call out in the REQ-BUG-04 implementation note.

---

### Pitfall 12: Frontend deployed without `API_URL` in env

**What goes wrong:**
CONCERNS.md "Known Bugs" §2 + "Tech Debt" §6: `frontend` reads `API_URL` at runtime from `$env/dynamic/private`. A misdeploy where the env var fails to propagate yields HTTP 500 on every request — and there's no boot-time check. If this happens during the launch window, the dashboard is dark for every user from minute 1.

**Why it happens:**
Vercel and Cloudflare Pages both have ways to lose env vars during config changes — for example, deploying from a different branch, or a typo in the dashboard config UI. Runtime-resolved env makes this a runtime failure, not a build failure.

**How to avoid:**
1. **Add a boot-time assertion** in `frontend/src/hooks.server.ts`: `if (!env.API_URL) throw new Error("API_URL must be set")`. Crashes the worker at boot, which is loud and obvious — better than 500-on-first-request which can hide for hours.
2. **Manually verify the env var is set** in both Vercel/Cloudflare Pages settings AND in `wrangler.jsonc` for backend, in the 24h before launch.
3. **Smoke test the deployed URL** before announcing to the waitlist. Hit `https://synapsesync.app` and confirm the home page renders without 500s.

**Warning signs (observable):**
- First request to deployed frontend returns 500 with `"API_URL is not configured"` → env var missing.
- `wrangler tail` for the frontend shows the same error every request → worker did boot but env is empty.

**Severity:** Low (with prevention), High (without). The boot-time assertion is the difference.

**Phase to address:** Phase 4 (Launch readiness). Verification: env var presence check in pre-launch checklist.

---

## Technical Debt Patterns

Shortcuts that may seem reasonable on a 5-day timeline. Note which are acceptable and which aren't.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip writing tests for the events-batch fix (BUGS.md #5a stays `.skip`) | Saves ~2h | This bug class can silently regress; we'd be relying on dogfood as the only signal | **Never** for this fix — the 1101 escaped tests once already. Bare minimum: one mocked-DB test covering the failing payload shape. |
| Telemetry writes share `events.jsonl` with capture events | Saves ~1h of new file/watermark plumbing | Couples telemetry bugs to capture-loop bugs; CONCERNS.md "Two parallel daemon families share a directory" shows what happens when this is done at the directory level | Never. Pitfall 2's whole point. |
| Manually deploy backend instead of fixing the auto-deploy gap (BUGS.md #10) | Saves ~30min | Production drifts from main; rollback requires explicit re-deploy of an older SHA | Acceptable for this milestone — auto-deploy is in Out of Scope. Mitigate with a deploy-checklist that includes "tag the deployed SHA." |
| Use Supabase's built-in transactional email instead of Resend/Postmark | Saves ~3h of provider setup | Higher spam rate, less control over the from-address, worse first impression for waitlist activation | Acceptable IF the dogfooder verifies deliverability to ≥3 real inboxes before launch. Pitfall 8. |
| Ship the dashboard observability view (REQ-MEASURE-03) as plain numbers with no chart | Saves 4-6h of charting library work | Looks barren in a screenshot; less compelling for early users seeing the dashboard | Acceptable. A table of `project | rating_rate | median_time_to_context` is good enough for the dogfood signal. |
| Hardcode synapsesync.app URLs in 3 more places (CONCERNS.md "Hardcoded production URLs") | Saves ~30min | Cannot point to staging without rebuild; new contributors blocked | Acceptable only in code added this milestone — but don't add new hardcoded URLs. Use the existing `API_URL` / `APP_URL` env vars. |
| Skip the `schema_version` field on `ProjectStatus` | Saves ~30min | Brief renders blank or wrong on daemon ↔ backend version skew | **Never** if adding new fields to `ProjectStatus`. Always optional + versioned. Pitfall 6. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cloudflare Workers `app.onError` | Assuming it catches everything | It does NOT catch unhandled promise rejections inside `Promise.all` or thrown CPU-budget violations. Use `wrangler tail` for real stack traces (BUGS.md #1). |
| Cloudflare Workers subrequest limit | Adding new DB calls per batch without counting | 50 subrequest cap. The current events-batch is right at the edge (2N for N projects). Don't add more synchronous DB calls in the hot path; defer to a queue or DO. |
| Supabase + service role | Treating RLS as authoritative | RLS is bypassed by service role (CONCERNS.md "Security Considerations §1"). New endpoints MUST call `requireRole` / `resolveProject*`. Three endpoints in `backend/src/api/` already have this bug — don't add a fourth. |
| Supabase emails | Relying on Supabase's default email for transactional mail | Default emails from Supabase have a generic from-address and limited customization; deliverability suffers. Use Resend or similar for any user-facing transactional mail (admission, password reset, etc.). |
| `npx` install path on corporate networks | Assuming `npx synapsesync` works everywhere | Netskope and similar proxies block it (BUGS.md #3, project memory `feedback_npx_proxy.md`). Provide a fallback in install docs and in the wizard outro. |
| macOS launchd | Writing the plist but not `launchctl load`ing it | Fixed today in `d3cd771` but the pattern is fragile — the plist isn't the daemon, it's just a config file. The status check (BUGS.md #2) must consult `launchctl list`, not the PID file. |
| Email deliverability | Brand-new domain sending bulk mail | SPF + DKIM + DMARC at DNS, warm up with a low-volume welcome email per signup, prefer personal-ish from-address. |
| Stripe-style metadata in checkout | Forgetting to validate metadata in webhook | Always pass internal user_id in checkout metadata; log + alert if missing in the webhook handler (deployment-payments-retro.md). |

---

## Performance Traps

Patterns that work at solo-dogfood scale but break with waitlist users.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `recomputeProjectStatus` full re-fold per batch (CONCERNS.md Perf §1) | `wrangler tail` shows CPU-time warnings; 1101 spikes; specific projects slower than others | Incremental reduce with `last_reduced_event_id` watermark; OR move recompute to a queue | ~10k events in one project, OR ~20 distinct projects in a single batch |
| `readEvents` re-loads whole events.jsonl per cycle (CONCERNS.md Perf §2) | Daemon CPU rises over session lifetime; daemon log shows slow flush cycles | Track byte offset of last read; rotate `events.jsonl` after N events | ~10k events in one project (~5MB file, daemon re-reads every 10s) |
| `Promise.all(recomputeProjectStatus)` (CONCERNS.md Perf §3) | Workers subrequest limit hit; 1101 on multi-project flushes | Cap N to ≤20 per batch; reject with 400 if exceeded | ~25 distinct projects in a single batch (multi-project dev) |
| Synchronous file IO in hook handlers (CONCERNS.md Perf §4) | Claude Code feels sluggish on SessionStart / PostToolUse | Migrate to `fs.promises.appendFile` with a write queue | >100 events/sec — currently not a problem, but adding telemetry into the same path could push it |
| Telemetry events flowing through the reducer | 1101 returns after telemetry deploy | Use a sidecar table for telemetry (Pitfall 7) | First waitlist user with >5k existing events submits a rating |
| Daemon log unbounded growth | User reports disk full; `~/.synapse/daemon.log` is gigabytes | Log rotation with `journalctl`-style retention; capped retry loop | Backend outage lasting hours combined with no backoff (Pitfall 9) |
| Dashboard observability view N+1 queries | `/api/projects/list` page slow as waitlist grows | One query with joins or one summary endpoint, not one query per project | ~50 admitted users |

---

## Security Mistakes

Beyond OWASP basics — issues specific to this domain at this milestone.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Adding telemetry endpoint without project-membership check | Cross-tenant telemetry pollution; rating spam | New telemetry endpoints MUST call `requireRole(db, project_id, user.id)` before any write. Mirrors CONCERNS.md Security §2-§4. |
| Waitlist endpoint accepts arbitrary email | Bot signups inflate the queue and burn admission capacity on noise | Captcha (hCaptcha / Cloudflare Turnstile) on the waitlist form; rate-limit per IP. |
| Admission email link is a bearer token good for anyone | Anyone with the link can claim the spot, not just the intended recipient | Token + email match check before activation (parallel to CONCERNS.md "Invite acceptance does not verify email match" §1 — the same bug class). |
| Telemetry rating endpoint accepts arbitrary scores | Spam ratings skew the signal | Allowlist Y / N only; rate-limit per project per hour; record `actor_user_id` for filtering. |
| API key in `~/.synapse/config.json` is world-readable | Local-process exfiltration (CONCERNS.md Security §7) | Out of scope this milestone but file as a follow-up; document in BUGS.md if not already. |
| Frontend env race exposes API URL or secret on misdeploy | Boot-time crash is preferable to a silent runtime exposure | Boot-time `assert(env.API_URL, ...)` in `frontend/src/hooks.server.ts` (Pitfall 12). |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Brief renders blank with "(no cached context yet — daemon will populate on next sync)" forever | User assumes the tool is broken; never returns (CONCERNS.md "Brief renderer fails open" §4) | If cache mtime > 5min old, append "Run `synapse doctor` to diagnose" to the brief. |
| Thumbs Y/N auto-fires every SessionStart | Rating fatigue; signal becomes noise of "didn't bother to rate" | Opt-in via a slash command, OR fire only after the user has actually engaged (e.g. after first non-orientation message). |
| Wizard says "all set!" but the daemon never reached the backend | False confidence; brief stays empty without explanation | After `synapse init`, do a synchronous test flush; show "✓ daemon connected, first events synced" or "⚠ daemon installed but couldn't reach backend — see `synapse doctor`". |
| Admission email is exciting but action-light ("you're in!") | User feels great but does nothing; doesn't install before excitement fades | Email contains the one command + the URL to copy/paste; ≤3 sentences. |
| `synapse capture status` lies about daemon state (BUGS.md #2) | User retries `init` repeatedly thinking it's broken; new file artifacts accumulate; eventual confusion | Fix the launchd / systemd consultation (REQ-BUG-02). |
| Dashboard observability view is barren on first visit | New users see "0 ratings, 0 sessions" and assume the tool isn't capturing | Show "Waiting for your first session" with a step-by-step rather than just empty fields. |
| Brief shows wrong actor because reducer order changed (CONCERNS.md "Brief renderer trusts actors[0]" §4) | Subtle attribution errors — hard to catch in dogfood | Reducer should expose `most_recent_actor` explicitly. Document the contract in `packages/shared/src/handoff/reducer.ts`. |

---

## "Looks Done But Isn't" Checklist

Things that often pass surface inspection but fail real verification.

- [ ] **REQ-BUG-01 (1101 fix):** Often missing the verification that `wrangler tail` shows zero exceptions for ≥30 min under real daemon load — not just curl tests. Verify with the actual dogfood machine's daemon flushing real events.
- [ ] **REQ-BUG-02 (capture status accuracy):** Often missing the systemd/Linux path — fix lands for launchd but Linux dogfood users (if any) still see stale state. Test by running `synapse capture status` after a fresh `systemctl --user start synapsesync.service`.
- [ ] **REQ-BUG-03 (proxy-blocked npx):** Often missing the wizard outro that mentions the global install fallback. Verify by reading the wizard's last screen — does it tell a Netskope user what to do?
- [ ] **REQ-BUG-04 (init writes `.mcp.json`):** Often missing the case where `.mcp.json` already exists with non-Synapse entries — does the new write preserve them? Test with a project that has Context7 or Firecrawl MCP servers already configured.
- [ ] **REQ-MEASURE-01 (Y/N rating):** Often missing the kill-switch (`SYNAPSE_TELEMETRY_DISABLED=1`). Verify capture loop is unaffected with telemetry disabled.
- [ ] **REQ-MEASURE-02 (time-to-context):** Often missing the cross-session reset — does the timer start fresh on each SessionStart or accumulate? Verify by running two sessions back-to-back.
- [ ] **REQ-MEASURE-03 (dashboard view):** Often missing the empty-state copy. Verify by loading the page as a fresh user with zero data.
- [ ] **REQ-LAUNCH-01 (waitlist signup):** Often missing the duplicate-signup case — same email twice should not create two waitlist entries. Verify.
- [ ] **REQ-LAUNCH-01 (waitlist signup):** Often missing the `waitlist_state` instrumentation (Pitfall 3). Without it, the funnel is invisible.
- [ ] **REQ-LAUNCH-02 (admission email):** Often missing real-inbox verification. Send a test admission to a Gmail AND Outlook address (not just the developer's own); confirm primary inbox, not spam/promotions.
- [ ] **REQ-LAUNCH-02 (admission email):** Often missing the action — email says "you're in" without the install command. Verify the email body links/copies the one-command install.
- [ ] **REQ-LAUNCH-03 (cold-laptop rehearsal):** Often skipped entirely or done from the same network as primary dogfood. Verify it ran on a corporate-proxy network where REQ-BUG-03 would matter.
- [ ] **REQ-DOGFOOD-01 (3-day solo dogfood):** Often missing the "predict / observe" log that catches confirmation bias (Pitfall 4). Without it, "I used it for 3 days and it worked" is unfalsifiable.
- [ ] **Backend deploy:** Often missing the `wrangler tail` watch session right after deploy to catch immediate exceptions. The "manual deploy" gap (BUGS.md #10) makes this discipline-based.
- [ ] **Frontend deploy:** Often missing the env-var sanity check — `API_URL` must be set on the deploy target (Pitfall 12).
- [ ] **Telemetry contracts:** Often missing the schema-version field on `ProjectStatus`, leading to silent breakage on daemon ↔ backend skew (Pitfall 6).
- [ ] **Email deliverability:** Often missing the SPF/DKIM/DMARC verification via mxtoolbox before launch.

---

## Recovery Strategies

When a pitfall fires despite prevention, how to recover with the least damage.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| 1101 returns post-launch | MEDIUM | (1) `wrangler tail` to capture stack. (2) If it's a single bad payload — find the project, archive its events.jsonl manually. (3) If reducer-wide — roll back the most recent backend deploy via `wrangler rollback` and re-deploy the previous SHA. (4) Daemon backoff (Pitfall 9) prevents user-side amplification during recovery. |
| Telemetry breaks the capture loop | HIGH | (1) Set `SYNAPSE_TELEMETRY_DISABLED=1` via env push to the deployed package (or document the manual override). (2) Backend-side: ignore telemetry events in the reducer. (3) Cut a hotfix that disables the telemetry write at the source. |
| Waitlist admissions go to spam | LOW | (1) Send a manual reminder from a personal-ish address ("Hi, you got admitted to Synapse — here's the link, it might have gone to spam"). (2) Add to the in-dashboard "your status" view so future admits aren't email-dependent. (3) Fix SPF/DKIM/DMARC for future emails. |
| Cold-laptop rehearsal finds a blocker on day 4 | MEDIUM | (1) Decide same-day: fix it or slip the launch by N days. Don't punt the decision to day 5. (2) If fixing: time-box to 4 hours; if it doesn't fit, slip. (3) Add the regression to BUGS.md so it's tracked even if fixed. |
| Scope creep ate day 3 | MEDIUM | (1) Cut a P1 — move it to "P2 follow-up" with a clear note. (2) Ship the milestone with reduced scope and document the cut in PROJECT.md "Out of Scope". (3) Resist the urge to "make it up" by working day 4 + 5 longer — that's how regressions ship. |
| Frontend deploy missing `API_URL` | LOW (with assertion), HIGH (without) | With boot-time assert: worker fails to boot, deploy is rejected, you notice immediately. Without: 500s for hours until someone notices. Always ship the assertion. |
| Daemon hammers a degraded backend | MEDIUM | (1) Push a backoff hotfix to the npm package; ask dogfood users to upgrade. (2) If the fleet of deployed daemons is still pre-backoff, accept the noisy invocation cost and mitigate at the backend (cache `503` responses, return cheap responses fast). |
| Confirmation-bias dogfood missed UX gaps | HIGH (post-launch) | (1) Roll back the broad admission. (2) Slow the admission batch to 1/day with manual handholding. (3) Reset the funnel measurements (Pitfall 3) and re-baseline. Painful — prevention via cold-laptop rehearsal is much cheaper. |

---

## Pitfall-to-Phase Mapping

How a roadmap built from this research should address each pitfall.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Re-deploy backend "fix" without reproducing | Phase 1 (Stabilize: BUGS.md P0/P1) | `wrangler tail` shows the original stack BEFORE the fix; post-deploy: 30min of clean tail logs under real daemon load. |
| 2. Telemetry breaks capture loop | Phase 2 (Telemetry) | `SYNAPSE_TELEMETRY_DISABLED=1` kill-switch test; telemetry writes to `telemetry.jsonl` (not `events.jsonl`); 24h dogfood window. |
| 3. Waitlist with no funnel instrumentation | Phase 3 (Waitlist) | `waitlist_state` column has rows in each state; dashboard view shows the funnel; synthetic test account walked end-to-end. |
| 4. Solo dogfood confirmation bias | Phase 4 (Launch readiness) | Predict/observe dogfood log; cold-laptop rehearsal on a different network; pre-committed abort conditions documented. |
| 5. Scope creep | Every phase (cross-cutting) | Daily out-of-scope audit; `git diff --stat` confined to scoped files; BUGS.md absorbs "one more thing" ideas. |
| 6. Telemetry breaks cache contract | Phase 2 (Telemetry) | New `ProjectStatus` fields are optional; `schema_version` field present; cross-version test (old daemon ↔ new backend). |
| 7. Reducer overload from telemetry events | Phase 2 (Telemetry) | Telemetry uses sidecar table, not `handoff_events`; OR incremental-reduce watermark in place; 5000-event synthetic test passes. |
| 8. Admission email deliverability | Phase 3 (Waitlist) | Transactional provider (Resend/Postmark) configured; SPF/DKIM/DMARC verified via mxtoolbox; tested to ≥3 real inboxes (Gmail/Outlook/iCloud). |
| 9. Daemon hammers broken backend | Phase 1 (Stabilize) — alongside P0 fix | Simulated 5min outage shows backoff in daemon log; recovery shows single retry, not burst. |
| 10. Per-device key edge during dogfood | Phase 4 (Dogfood) | Cold-laptop rehearsal uses a separate test account; 409 path documented as known follow-up. |
| 11. `synapse init` overwrites service file | Phase 1 (REQ-BUG-04 implementation) | Note in fix PR that overwrite is intentional; dogfood resets to canonical state before each rehearsal. |
| 12. Frontend deployed without `API_URL` | Phase 4 (Launch readiness) | Boot-time assertion in `frontend/src/hooks.server.ts`; env-var sanity check in pre-launch checklist; smoke test deployed URL. |

---

## Sources

- **In-repo, HIGH confidence:**
  - `/Users/Tanmai.N/Documents/synapse/.planning/PROJECT.md` — milestone scope, decisions, constraints.
  - `/Users/Tanmai.N/Documents/synapse/docs/BUGS.md` — P0–P4 bug list with code locations and fix sketches.
  - `/Users/Tanmai.N/Documents/synapse/.planning/codebase/CONCERNS.md` — full technical-debt + performance + security audit (2026-05-15).
  - `/Users/Tanmai.N/Documents/synapse/docs/retrospectives/auth-retrospective.md` — auth holes found and fixed in prior milestones.
  - `/Users/Tanmai.N/Documents/synapse/docs/retrospectives/deployment-payments-retrospective.md` — deploy + payments gotchas including webhook deliverability + secrets management patterns.
- **External, MEDIUM confidence:**
  - [Cloudflare Workers: Errors and exceptions](https://developers.cloudflare.com/workers/observability/errors/) — confirms `wrangler tail` is the right diagnostic path for 1101.
  - [Cloudflare Error 1101](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1101/) — confirms 1101 = uncaught JS exception (including unhandled promise rejection).
  - [@modelcontextprotocol/typescript-sdk #392 — Promise/async handling causes unhandled rejections](https://github.com/modelcontextprotocol/typescript-sdk/issues/392) — context that Promise.all + reducer-style code is a known offender pattern.
  - [Launching a Product Waitlist: A Complete Practical Playbook (unicornplatform.com)](https://unicornplatform.com/blog/how-to-launch-a-waitlist-and-build-hype-for-your-product/) — staged-rollout and activation-signal patterns informed Pitfall 3.
  - [Throttling in Message Queues (medium.com)](https://medium.com/@toshniwal.ak/mastering-throttling-in-message-queues-why-automatic-acknowledgement-might-be-hurting-your-app-53bb7b47ce35) — backoff / capacity patterns informed Pitfall 9.

---

*Pitfalls research for: Synapse stabilize-for-launch milestone (5-day, solo dogfood, waitlist + telemetry scope)*
*Researched: 2026-05-19*
