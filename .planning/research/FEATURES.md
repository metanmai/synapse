# Feature Research — Launch-Readiness Milestone

**Domain:** AI coding session capture & handoff tooling (brownfield, pre-launch stabilization)
**Researched:** 2026-05-19
**Confidence:** MEDIUM-HIGH (HIGH on patterns/peer products; MEDIUM on specific implementation choices for a 5-day window)
**Scope:** Five target feature areas only — brief rating, time-to-context telemetry, waitlist-throttled signup, activation email, backend error observability. **Not** new product surface area.

---

## Reading Guide

Each feature area below answers:

1. **Spectrum in the wild** — what peer products actually ship (Sentry/PostHog/Linear/Cursor/Copilot/etc.)
2. **Table stakes** — the floor; missing this → product feels broken or amateur
3. **Differentiators** — meaningful design choices that earn signal beyond the floor
4. **Anti-features** — surface-attractive options that look good in planning but cost more than they yield in the launch window
5. **Complexity (T-shirt)** — XS (< 1 hour) · S (1-3 hr) · M (half-day) · L (1+ day)
6. **Dependencies**

Two cross-cutting axes apply to every feature:

- **Public surface vs internal measurement.** A thumbs-up button users see is different from a backend timestamp users never see. Both are "shipped" but the design tradeoffs differ. Where relevant this is called out as **[USER-FACING]** vs **[INTERNAL]**.
- **Signal-to-noise at small N.** With ≤ ~50 users in the first batch, statistical machinery (cohort analysis, funnels, A/B tests) is premature. What works at small N is a) raw event logs you can eyeball, b) named individuals you can ask. Anything else is over-engineering.

---

## Feature Area 1 — Brief Quality Ratings (REQ-MEASURE-01)

**Goal:** Signal that ratings actually correlate with brief usefulness. The brief is the product's core value; quality must be observable.

### Spectrum in the wild

| Pattern | Examples | When it fits |
|---------|----------|--------------|
| **Binary thumbs (👍/👎) on every AI output** | ChatGPT, Microsoft Copilot, GitHub Copilot Chat, Claude Artifacts | When AI output is the unit of work; user is already evaluating it; cost of click is low |
| **Optional star/scale rating** | Many internal LLM eval tools | When you need granularity and users are evaluators (not consumers) |
| **Thumbs + free-text follow-up on negative** | ChatGPT (down → "tell us more"), Copilot Studio (configurable reason picker) | When you need to learn *why*, not just *how often* |
| **Implicit signals only** (regenerate / dismiss / time-on-output) | Cursor inline suggestions, GitHub Copilot ghost-text | When asking explicitly would interrupt flow |
| **Periodic surveys (NPS/CSAT)** | Linear, Vercel | For product-level satisfaction, not per-output |
| **No rating, telemetry only** | Most early-stage tools pre-PMF | When N is too small for ratings to be informative |

Industry consensus across the [Copilot Studio guidance](https://learn.microsoft.com/en-us/power-platform/release-plan/2025wave1/microsoft-copilot-studio/collect-thumbs-up-or-down-feedback-comments-agents) and [AI Chat UI best practices](https://thefrontkit.com/blogs/ai-chat-ui-best-practices): **thumbs are the floor**, *reason-on-negative* is the differentiator, and *forced* feedback (modal that blocks) is the anti-pattern.

### Table stakes [USER-FACING]

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Binary thumbs-up / thumbs-down on each brief | Every contemporary AI product has it. Absence reads as "they don't care about quality." | **S** | Two buttons on the brief surface. Where the brief surfaces is the question: in `<synapse-brief>` block (no native UI) vs dashboard view of recent briefs |
| Server-side persistence keyed by `(project_id, brief_hash_or_id, user_id)` | Without persistence the rating is theatre | **S** | Schema: extend `handoff_*` or new `brief_ratings` table. Hash of brief content is enough as the brief ID — briefs are not currently identified |
| Idempotent (re-rating overwrites, not appends) | Users will misclick | **XS** | `upsert on (brief_id, user_id)` |
| One rating per brief, not per-session | Otherwise rating volume = session volume = noise | **XS** | Dedup at write time |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| **Surface the rating control in two places** — the brief itself (when displayed in dashboard) AND as a slash command (`/synapse-rate-brief 👍`) | Users live in the editor, not the dashboard. Slash command is the only way to capture in-context | **M** | Slash command emits a `BriefRated` event via existing append-event path. Dashboard reads it back. Adds an `EventKind` to the reducer |
| **Optional reason on thumbs-down only** (free text or 3-4 preset reasons: "stale", "wrong focus", "missing context", "other") | Negative ratings without a reason are unactionable. Reason on positive is noise — they already rated it | **S** | Reason captured as `payload.reason` on the same event |
| **"Brief identity" — hash the brief content** so the same brief isn't re-rated and you can correlate ratings to brief versions | Otherwise you can't tell if quality is improving or staying the same | **S** | `sha256(brief.md content)` as `brief_hash`; track distinct hashes per project over time |
| **Dashboard view: rating rate (% briefs rated) + thumbs-up rate (% positive of rated)** | The two-metric pair surfaces both *engagement with rating* and *quality*. Either alone misleads | **M** | Simple aggregation query; ships in REQ-MEASURE-03 |

### Anti-features

| Feature | Why it looks good | Why it isn't | Alternative |
|---------|-------------------|--------------|-------------|
| **Star rating (1-5)** | "More granularity = better signal" | At N=50 users, distinguishing 3.4 from 3.6 is meaningless. Cognitive cost is higher. ChatGPT and Copilot both chose binary; this is empirical, not arbitrary | Binary thumbs |
| **Forced rating modal at session end** | Maximises rating volume | Tanks the user experience; users learn to dismiss; data becomes biased toward annoyance | Optional, persistent, visible-but-ignorable button |
| **NPS for the product overall** | Industry standard | Wrong unit. Brief is the atom — measure that. NPS is for after PMF | Per-brief rating; defer NPS |
| **Sentiment analysis of brief content** to predict rating | Looks impressive | Pre-PMF, you don't have enough data to train anything. And it doesn't replace the actual user signal | Just collect the user signal |
| **Public ratings visible to other team members** | "Social proof" | At launch there are no teams to share within. Adds RLS / permissions surface area for zero gain | Defer until teams matter |
| **Rate every event, not just briefs** | "More data!" | Briefs are the product. Other events are infrastructure. Rating fatigue kills the actual signal | Brief only |

### Dependencies

- Requires **brief identity (hash)** before rating-rate trends are meaningful
- Feeds into **REQ-MEASURE-03 dashboard view** (depends on this + time-to-context)
- Independent of waitlist / email / observability work

---

## Feature Area 2 — Time-to-Context Auto-Tracking (REQ-MEASURE-02)

**Goal:** Quantify "how fast does the next session become productive?" Pair with rating to crossplot quality × speed.

### Spectrum in the wild

This is **Time to Value (TTV)** applied at the session level rather than the account level. The literature ([Onboard.io](https://onboard.io/blog/onboarding-metrics-days-to-launch-time-to-value), [Amplitude TTV](https://amplitude.com/blog/time-to-value-drives-user-retention), [Product School](https://productschool.com/blog/product-strategy/time-to-value)) consistently treats it this way:

| Pattern | What's measured | Examples |
|---------|-----------------|----------|
| **Time-to-first-action** | seconds between "user lands" and "user does *anything*" | Most onboarding flows |
| **Time-to-first-valuable-action** | seconds between landing and the first action that delivers value (commit, message, deploy) | Linear (first issue), Vercel (first deploy), GitHub (first push) |
| **Time-to-magic-moment** | richer; specific to the product's "aha" | Slack: 2k messages sent; Dropbox: file shared with another user |
| **OpenTelemetry time-to-first-span** | for instrumentation onboarding specifically | [OneUptime / OTel](https://opentelemetry.io/docs/concepts/instrumentation/) |

For Synapse, the equivalent is **seconds between SessionStart and the first user prompt that is *not* about orientation** — i.e., the user has read/skimmed the brief and is now doing real work.

### Defining "first non-orientation message" — the load-bearing decision

Three operationalizations, each with tradeoffs:

| Definition | Pros | Cons | Verdict |
|------------|------|------|---------|
| **First `UserPromptSubmit` after `SessionStart`** | Trivial to instrument | Catches "what does this brief mean?" prompts as productive | Too noisy |
| **First `UserPromptSubmit` whose tokenised content is not in a stop-list ("what is", "explain the brief", "where are we", "summarize")** | Filters obvious orientation | List is arbitrary; misses non-English; over-fits | Brittle |
| **First `UserPromptSubmit` followed within 30s by a `ToolUsed` event (especially Edit/Write/Bash)** | Behavioral; doesn't depend on prompt content | Defines "productive" as "tool-use" which is a defensible proxy for real work in Claude Code | **Recommended** |

Verdict: behavioral definition. Productive = the user told Claude to do something, and Claude reached for a tool. This already maps to existing `EventKind.UserPrompted` + `EventKind.ToolUsed` in the reducer.

### Table stakes [INTERNAL]

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `SessionStart` timestamp captured | Already exists as `EventKind.SessionOpened` `occurred_at` | **XS** | No work |
| "First productive message" timestamp captured | The other endpoint of the interval | **S** | A new `EventKind.SessionProductiveStart` (or computed at-read time from existing events) — recommend computed at read time in the reducer, so historical sessions also get a value |
| Server-side derived `time_to_context_seconds` per session | The metric itself | **S** | Derived in `reduce()` from the event pair; lives in `ProjectStatus` or new `handoff_session_metrics` table |
| Sensible nulls — if a session never reached productivity, `time_to_context_seconds = null` (not 0, not max) | Honest stats | **XS** | Don't impute |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| **Per-session and per-project median** (not mean) on the dashboard | At small N, mean is dominated by outliers (the user who left a tab open for 8 hours). Median is robust | **S** | One SQL `percentile_cont(0.5)` |
| **Crossplot with brief rating** — "fast and useful" vs "fast but useless" vs "slow but eventually useful" vs "slow and useless" | Each quadrant points to a different problem. Single metric doesn't. This is the [PROJECT.md decision rationale](#) — "surfaces 'fast but inaccurate' vs 'slow but useful' modes" | **M** | Once both are persisted, a 2×2 chart on the dashboard. Don't fight pretty plotting at this stage — a table of buckets is enough |
| **"Brief was read" signal** vs "brief was ignored" — distinguish sessions where the user actually engaged with the brief content from those where they bulldozed through | **HARD; defer** | Synapse has no way to detect this client-side without invasive instrumentation in Claude Code. Cursor/Copilot don't do it either. Don't try | n/a |
| **Outlier flagging** — sessions where `time_to_context > 30min` get a flag on the dashboard, inviting the user to share what went wrong | The long tail is where you learn | **S** | Threshold + dashboard list view |

### Anti-features

| Feature | Why it looks good | Why it isn't | Alternative |
|---------|-------------------|--------------|-------------|
| **Sub-second precision** | Engineering reflex | Session timestamps are wall-clock; clock skew is already a known issue (`SKEW_LIMIT_MS = 5 min` in the codebase). Sub-second is noise on top of noise | Seconds resolution |
| **A/B test brief variants automatically** | "Optimise the brief!" | At N=50, A/B is statistically dead-on-arrival. Run a test with 5 users and 1000 with the same variant — neither gives you a signal | Wait for traffic |
| **Replace heuristic brief with LLM for everyone** based on early TTV signal | "Improvement!" | One week of post-launch data isn't a basis. PROJECT.md explicitly defers brief improvements to post-signal | Collect, observe, then decide |
| **Aggressive client-side reporting** of TTV (separate beacon endpoint) | "Real-time dashboards!" | Existing append-event path with daemon batching already carries this. Don't add a parallel path | Use existing pipeline |
| **Track time-to-rating** (how long until the user rates the brief) | More data | Not actionable. If users rate at all, you have signal | Drop |

### Dependencies

- Sits on top of existing `EventKind.SessionOpened`, `UserPrompted`, `ToolUsed` (no new capture surface)
- Reducer change to derive the metric is on the **critical path** for REQ-MEASURE-03 dashboard
- Independent of rating UX work — they can ship in parallel

---

## Feature Area 3 — Waitlist-Throttled Public Signup (REQ-LAUNCH-01)

**Goal:** Accept new users but at a pace controllable by the operator (you). Don't let a HN spike create 500 unmanaged accounts on day one.

### Spectrum in the wild

The [SaaS waitlist playbook landscape](https://waitlister.me/growth-hub/guides/saas-product-launch-waitlist) and [LaunchList](https://getlaunchlist.com/blog/waitlist-referral-program-guide) writeups distinguish three families:

| Family | What it is | Examples | Fit for Synapse |
|--------|-----------|----------|-----------------|
| **Marketing waitlist** (pre-launch demand gen) | Collect emails before product exists; convert at launch | Robinhood, Superhuman | **No** — Synapse is launching, not pre-launching |
| **Throttled access** (capacity control) | Product exists; access is gated to limit blast radius | Linear early days, Raycast Pro features, OpenAI API access | **Yes** — this is what's needed |
| **Viral / referral waitlist** (gamified growth) | Position in line is the carrot; sharing moves you up | Dropbox '08, Robinhood, Clubhouse | **No** — viral mechanics are for demand creation, not for the soft launch of a dev tool |

The waitlist tools market is huge (Waitlister, LaunchList, KickoffLabs, Prefinery, Beyondlabs, Stormy, etc.) but **all of them are over-built for "accept signups, manually approve in batches."** They're marketing infrastructure for a marketing problem. Synapse has a capacity-control problem.

[Supabase's invite-only signup pattern](https://github.com/orgs/supabase/discussions/4296) — sign-ups disabled by default, `inviteUserByEmail` API for admins, magic link delivery — is the standard implementation and it's already available in this stack. The [`before-user-created` hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) gives a custom gate.

### Two operationally distinct shapes

The "throttle" can take two forms, with very different implementation costs:

**Shape A — Pure invite-only.** Signup is disabled. Operator imports email addresses into Supabase and `inviteUserByEmail` for each. User receives magic link, lands on dashboard authenticated, can immediately run wizard. This is the cleanest model. **No waitlist UI is needed on the marketing site** — just a "request access" form that emails the operator.

**Shape B — Waitlist with operator approval.** Public signup form writes to a `waitlist` table. Operator periodically marks rows as `approved`, which triggers magic-link delivery. The user then completes signup. This adds a queue + activation flow but lets people self-serve onto the list.

Shape B is what REQ-LAUNCH-01 + REQ-LAUNCH-02 jointly describe ("signups queued, granted access in controlled batches"). Shape A is a strict subset that ships faster.

**Recommendation:** Ship Shape B but build it as Shape A under the hood — i.e., the waitlist row is just a stash of email + timestamp, and "approve" calls `inviteUserByEmail`. Don't build a second auth surface.

### Table stakes [USER-FACING]

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Public form on synapsesync.app: email → "you're on the waitlist" | Without this, there's no way for traffic to convert | **S** | One Svelte route + one form action + one DB insert |
| Confirmation that the email was received (page state, not just toast) | Otherwise users resubmit | **XS** | Standard form pattern |
| Operator path to approve a batch | Without this, the waitlist is a black hole | **S** | Two options: (a) admin route in dashboard with a list + checkbox + approve button; (b) just SQL — `update waitlist set approved_at = now() where id in (...)` plus a trigger or cron that sends the invites. **(b) is faster to ship and operator (you) is fine with SQL** |
| Duplicate-email handling (idempotent — re-submit doesn't error or double-queue) | Trivial UX correctness | **XS** | Unique constraint + upsert |
| Position-in-queue is **not shown** (just "we'll email you") | Showing it commits you to a fairness model you can't keep | **XS** | Just don't render it |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| **Capture install-intent signal** on the waitlist form: "what editor do you use?" (Claude Code / Cursor / Windsurf / Other) | Lets you prioritize approvals to users whose editor is best-supported. Also signals to you what to invest in next | **XS** | One radio field |
| **Operator notification on each new waitlist signup** | At launch volumes you'll want to know. Auto-cap once volume justifies disabling | **XS** | Same email service as activation; send to your own address |
| **"Why you'll like this" landing copy** above the form | Conversion. The form is a checkpoint; the copy is the reason to fill it | Already exists per PROJECT.md ("Marketing landing polish... ships as-is unless they actively block install") | Leave landing alone; just add the form |
| **Soft auto-approve under a small daily cap** (e.g., first 5 signups/day auto-approve, rest queued) | Avoids manual intervention for the first wave while preserving the throttle | **S** | Cron or scheduled task. Risk: bug in auto-approval lets in too many → manual is safer for week one |

### Anti-features

| Feature | Why it looks good | Why it isn't | Alternative |
|---------|-------------------|--------------|-------------|
| **Referral/viral mechanics** ("move up by sharing") | Dropbox / Robinhood case studies | Those are marketing-waitlist patterns, not throttled-access patterns. Synapse needs to *limit* admits, not *grow* the list. Building referral mechanics on a queue you don't want to grow is incoherent | Drop entirely |
| **Public count of "X people in line ahead of you"** | "Social proof" | Sets an implicit SLA on approval rate. Commits to fairness/FIFO ordering. Visible to competitors. None of these are wanted | Don't show position |
| **Estimated time to admission** | "Sets expectations" | Same problem; you don't know your own admission rate yet. Promises you can't keep are worse than no promise | "We'll email you when we have capacity" |
| **In-product waitlist for existing users** ("waitlist for Plus tier") | Conflates two unrelated decisions | Plus tier is already shipped via Creem billing. This isn't that problem | Already solved |
| **A whole admin dashboard for waitlist management** | "Operator UX" | You are the operator; you have direct SQL access; for 50 invites the admin UI is a multi-hour task that saves you nothing | SQL or a single approve-by-id endpoint |
| **CAPTCHA / signup abuse mitigation** | "Bot protection" | At 0 → 50 sign-ups/day, bot abuse is irrelevant; you'll see it in the queue. Add when needed | Skip pre-launch |
| **Tiered waitlists** ("priority access for Pro", etc.) | "Monetisation" | Premature; Plus tier exists but the waitlist is for *access*, not for *tier*. Conflating them confuses both | One waitlist |

### Dependencies

- Pure substrate; no upstream deps on rating / TTV / observability
- **Required before REQ-LAUNCH-02** (activation email) — the email is the activation event
- **Required before REQ-LAUNCH-03** (landing-to-installed-daemon path verified) — without the waitlist gate the landing path is incomplete

---

## Feature Area 4 — Email Notification on Waitlist Activation (REQ-LAUNCH-02)

**Goal:** When operator approves a waitlist entry, the user gets a usable email — link to sign in, clear next action.

### Spectrum in the wild

Transactional email infra is a mature market. The [Postmark transactional guide](https://postmarkapp.com/blog/what-is-transactional-email-and-how-is-it-used) and [Courier ESP comparison](https://www.courier.com/blog/top-6-email-service-providers-for-transactional-notifications-in-2025) cover the field.

| Provider | Fit |
|----------|-----|
| **Resend** | Developer-first DX (React Email components), generous free tier (3k/mo), API-only. Most popular among indie devs in 2025-2026 |
| **Postmark** | Best deliverability + dedicated transactional streams; free trial limited; paid from $15/mo |
| **AWS SES** | Cheapest at scale; setup pain (domain verification, sandbox lift, bounce handling) |
| **Supabase Auth built-in email** | Already in stack; rate-limited (4/hour in default config); not for marketing |

The pattern itself is unambiguous: **single transactional email + magic link / sign-in link**.

### Two distinct events that need email

| Event | Audience | Purpose | Required at launch? |
|-------|----------|---------|---------------------|
| **Waitlist confirmation** ("we got your signup") | New waitlist entry | Reassurance, no resubmission | Nice-to-have; can fold into form-response page |
| **Waitlist activation** ("you're in, here's your link") | Approved entry | The actual handoff to the product | **Yes — this is REQ-LAUNCH-02** |

### Table stakes [USER-FACING]

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Activation email triggered on approve | The whole point | **S** | One server function called from the approve action |
| Clear subject line and first sentence ("You're in. Sign in here.") | Email best practice; users skim | **XS** | Plain text fine; HTML optional |
| Magic-link / sign-in link that doesn't expire in < 24 hours | Users don't read email immediately | **XS** | Supabase magic links default 1 hour — extend or use a longer-lived invite token |
| Sender domain from synapsesync.app, SPF/DKIM passing | Otherwise lands in spam | **S** | DNS records. Resend / Postmark configure this in 10 minutes |
| One link, one next action ("Sign in → run wizard") | Multiple CTAs reduce conversion | **XS** | Don't over-design |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| **Reply-to is your real email** | Approved-waitlist users are your best feedback channel; let them reply | **XS** | Header config |
| **Include the install command in the email body** (`curl ... | sh` or `npx synapsesync init`) | The activation email is the user's first onboarding moment. Don't make them dig | **XS** | Verbatim from README |
| **Plain-text version alongside HTML** | Deliverability + readability in TUI mail clients | **XS** | Standard MIME multipart |
| **Email open / link-click telemetry** | Would tell you activation-email-to-first-session conversion | **S** but **defer** | Adds tracking pixels and click-redirect domain; not worth the complexity at launch. Just check waitlist → first-event-from-this-user latency in the DB |

### Anti-features

| Feature | Why it looks good | Why it isn't | Alternative |
|---------|-------------------|--------------|-------------|
| **HTML email with brand styling / hero image** | "Looks professional" | More likely to land in spam, harder to render across clients, slower to ship. Top transactional senders (Stripe, Linear) often send near-plaintext intentionally | Spartan HTML or plain text |
| **Drip sequence after activation** (day 1, day 3, day 7 follow-ups) | "Onboarding nurture" | Premature. You don't know yet what users get stuck on. Sending nudges before knowing is annoying noise | Wait for signal |
| **Bulk re-engagement campaigns** ("we miss you, come back") | "Reactivation revenue" | Anti-pattern for transactional ESPs; will get domain reputation flagged; also irrelevant pre-launch | Drop |
| **Slack / Discord notifications** to operator instead of email-to-user | "Faster ops feedback" | Wrong direction; the bottleneck is informing the user, not informing you | Use the same provider for both: send-to-user *and* send-to-self |
| **Send the brief in the email** | "Show value immediately" | Brief is per-project, requires daemon + capture loop. Email-prebrief makes no sense | The link → wizard → install → first session → first brief is the chain |

### Dependencies

- **Depends on REQ-LAUNCH-01** (waitlist exists and has an approval state to trigger from)
- **Depends on** sender-domain DNS — SPF/DKIM/DMARC must be set up. This is operational, not code, and can be done in parallel
- Independent of rating / TTV / observability

### Provider recommendation

**Resend.** Reasons: indie-dev-friendly DX, free tier covers launch (3k/mo), API surface is small, integrates with React Email if HTML wanted later, no overhead. Postmark is the alternative if deliverability becomes an issue post-launch. Don't use Supabase Auth's built-in mailer for the activation email — it's rate-limited and not designed for it.

---

## Feature Area 5 — Backend Worker Error Observability (REQ-MEASURE / implied by BUGS.md #1)

**Goal:** Never again ship for a week without realising `/api/events/batch` is 100% broken. The Cloudflare 1101 went undetected because nothing alerted on it.

### Spectrum in the wild

The [Cloudflare Workers observability landscape](https://developers.cloudflare.com/workers/observability/) has consolidated rapidly in 2025-2026 around four options:

| Option | What you get | Cost | Setup time |
|--------|-------------|------|-----------|
| **Cloudflare Workers Observability (native, free)** | Logs, basic metrics, request analytics in the CF dashboard. No alerting on error rate. No external destination | Free | ~10 min |
| **`wrangler tail` live stream** | Real-time log viewing during debugging | Free | 0 min, already available |
| **Sentry via `@sentry/cloudflare`** | Errors + stack traces + source maps + alerts + grouping | Free tier: 5k errors/mo | ~30 min |
| **Sentry / Honeycomb / Axiom / Baselime via OTLP export** | Full telemetry; traces; metrics | Free tier varies; Cloudflare requires Workers Paid plan to export OTLP per the CF docs | ~1-2 hours |

The [Sentry Cloudflare guide](https://docs.sentry.io/platforms/javascript/guides/cloudflare/) and the [Cloudflare → Sentry observability docs](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/sentry/) both confirm `@sentry/cloudflare` is the lowest-friction path.

[Baselime](https://baselime.io/for/cloudflare) was acquired by Cloudflare in 2024; some functionality has moved into native Workers Observability, some persists as Baselime-the-product. For new setup, native + Sentry is the simpler choice.

### What "launch-ready observability" actually means at small N

Three jobs the observability stack must do:

1. **Tell you the backend is broken before users do.** This is the primary failure that BUGS.md #1 exposed.
2. **Give you a stack trace when something throws.** So you can fix it without spelunking through `wrangler tail`.
3. **Tell you which endpoint is slow / failing.** Lower priority pre-launch.

Job 1 + 2 are table stakes. Job 3 is differentiator.

### Table stakes [INTERNAL]

| Feature | Why expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Error capture with stack trace on every uncaught exception** in the Worker | The 1101 went undetected because `app.onError` swallowed nothing — but nothing was *also* reporting unhandled rejections. Sentry's `withSentry` wrapper captures both | **S** | `wrap(app, { dsn })` in `backend/src/index.ts` |
| **Source-mapped traces** (line numbers map to source, not bundled output) | Without this, traces are noise | **S** | Wrangler supports source maps; configure once in `wrangler.jsonc` + upload via `@sentry/cli` or the Sentry build plugin |
| **Alerting on error rate spike** (e.g., > 5 errors in 5 minutes → email/Slack you) | Without alerting, the dashboard is theatre. You won't check it | **XS** | Sentry has this built in; configure threshold |
| **Native Cloudflare Workers Observability enabled** (it's free and provides log search even if Sentry catches errors) | Belt-and-suspenders; sometimes the failure mode is "Sentry itself fails" — see CPU/subrequest limits in BUGS.md #1 | **XS** | Already on by default for new Workers; verify enabled |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| **Tag errors by endpoint + user_id + project_id** (when known) | Filters errors by user — answers "is one user causing this?" in seconds | **S** | `Sentry.setTag()` in the auth middleware |
| **Capture the `Promise.all` rejection path** in `recomputeProjectStatus` (the exact thing BUGS.md #1 suspects) | Targeted fix for the failure pattern that bit you once | **S** | Wrap the `.map()` body in `try/catch` + explicit `Sentry.captureException` so per-project failures surface even when the outer promise resolves |
| **Health check endpoint + uptime monitoring** (UptimeRobot / BetterStack free tier, hit `/health` every minute) | Catches "backend deployed but Worker is throwing on every request" which Sentry alone may miss because no requests get far enough to error | **S** | One route + one external monitor |
| **Slow-route reporting** (`/api/events/batch` > 100ms warning) | The reducer reads all events per call (BUGS.md #11) — this will get slower over time. Seeing it trend is useful | **S but defer** | Sentry Performance has request-timing; turn on after launch when you have real traffic |
| **Daemon-side error reporting** (the CLI / MCP server in `mcp/`, not just backend) | Captures install-time failures, hook handler crashes, daemon crashes. BUGS.md is full of these | **M** | `@sentry/node` in the MCP package. Pre-launch nice-to-have; the CLI already writes a local log file so users can grep |

### Anti-features

| Feature | Why it looks good | Why it isn't | Alternative |
|---------|-------------------|--------------|-------------|
| **OpenTelemetry traces with distributed propagation across daemon → backend → DB** | "Full observability!" | Three days of setup. Requires OTLP exporter on Workers (Paid plan). Not worth it for a Worker that does one HTTP roundtrip per call | Sentry errors only |
| **Custom metrics dashboards** (StatsD / Prometheus / Grafana) | Engineering reflex | Sentry already exposes error-rate, latency. Don't build a second one | Use Sentry's |
| **Log every request body** for debugging | "I'll know everything!" | PII risk (auth payloads, project content), storage cost, alert noise | Log on error only |
| **Replay all errored requests automatically** | "Self-healing!" | The errors that need replay are the dangerous ones; auto-replay can cascade. Manual replay (re-POST from `events.jsonl` watermark) is already the design | Manual replay via daemon watermark |
| **Frontend error tracking (Sentry SvelteKit)** | Symmetry with backend | Frontend is mostly server-rendered + small client surface; current burden is svelte-check warnings (BUGS.md #13), not runtime errors. Defer | Backend first |
| **Multiple observability vendors in parallel** ("for redundancy") | "Defense in depth" | Operator overhead, duplicate alerts, conflicting dashboards | Pick one, ship it |
| **Anomaly detection / ML alerting** | "Catches the unknown" | Useless at low traffic. False-positive heavy. Sentry's static threshold is fine | Static threshold |

### Dependencies

- Independent of all other launch-readiness work; can ship in parallel with everything
- **Should ship before REQ-LAUNCH-01** so the launch traffic itself is observed
- **Closes BUGS.md #1's underlying gap** even if the specific 1101 is fixed via a code change

### Provider recommendation

**Sentry via `@sentry/cloudflare`** (SDK, not OTLP export). Reasons: free tier sufficient for launch (5k errors/month is plenty when error rate should be ~0), one-line setup, doesn't require Workers Paid, source-map support is native, alerting included. Native Cloudflare Workers Observability stays on as the log layer.

---

## Cross-Feature Dependencies

```text
                        ┌──────────────────────────┐
                        │ Brief identity (hash)    │
                        │ — derived in reducer     │
                        └────────────┬─────────────┘
                                     │
            ┌────────────────────────┼──────────────────────────┐
            ▼                        ▼                          ▼
  ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐
  │ REQ-MEASURE-01       │  │ REQ-MEASURE-02       │  │ REQ-MEASURE-03        │
  │ Brief rating         │  │ Time-to-context     │  │ Dashboard view of    │
  │ (thumbs + reason)    │  │ (session timing)    │  │ both metrics + cross │
  │ Public + DB write    │  │ Internal derivation │  │ plot                 │
  └──────────┬───────────┘  └──────────┬──────────┘  └──────────┬───────────┘
             │                         │                        │
             └─────────────────────────┴────────────────────────┘
                              both feed dashboard
                                       │
                                       ▼
                         (independent of launch path)


  ┌─────────────────────┐
  │ REQ-LAUNCH-01       │
  │ Waitlist signup     │
  │ + operator approve  │───┐
  └──────────┬──────────┘   │ produces "approved" state
             │              │ that triggers …
             ▼              ▼
        ┌──────────────────────┐
        │ REQ-LAUNCH-02        │
        │ Activation email     │     ─── depends on Resend / DKIM setup
        │ (Resend)             │     (operational, parallel)
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ REQ-LAUNCH-03        │
        │ Landing → installed   │
        │ daemon path verified │
        └──────────────────────┘


  ┌─────────────────────────────────────┐
  │ Backend error observability         │
  │ (Sentry via @sentry/cloudflare)     │
  │                                     │
  │ Independent of all other features.  │
  │ Should land BEFORE REQ-LAUNCH-01    │
  │ so launch traffic is observed.      │
  └─────────────────────────────────────┘
```

### Critical dependency notes

- **Brief identity (content hash) is a hidden prerequisite for both REQ-MEASURE-01 and REQ-MEASURE-03.** Without it, ratings can't be deduplicated and the rating-rate metric is uncomputable. This is a quick reducer change but should not be missed.
- **Waitlist (REQ-LAUNCH-01) and activation email (REQ-LAUNCH-02) form a two-step but they ship best as one PR.** Splitting risks shipping a waitlist that's a black hole.
- **Backend observability has no functional dependency on anything else** but is the riskiest thing to ship *last* — a launch-time bug under observability gives you the second BUGS.md #1.
- **REQ-MEASURE-03 dashboard** is the consumer of -01 and -02. Build -01 + -02 first, then the dashboard last. A dashboard with one metric (just rating, while TTV is still landing) is fine for a few hours.
- **Brief rating and time-to-context can be developed fully in parallel** by separate sessions / branches; they only converge in the dashboard view.

---

## MVP Definition for the Launch-Readiness Milestone

### Must ship (P1 — launch blockers)

- [ ] **REQ-MEASURE-01a** Binary thumbs UI on brief in dashboard view (`S`)
- [ ] **REQ-MEASURE-01b** Slash command `/synapse-rate-brief` for in-editor rating, emits event (`M`)
- [ ] **REQ-MEASURE-01c** `brief_hash` derived in reducer; ratings keyed by `(brief_hash, user_id)` (`S`)
- [ ] **REQ-MEASURE-02a** TTV derived from existing events: `first ToolUsed within 30s of first UserPrompted after SessionOpened` (`S`)
- [ ] **REQ-MEASURE-02b** `time_to_context_seconds` persisted per session in `ProjectStatus` or sibling table (`S`)
- [ ] **REQ-MEASURE-03** Dashboard tile: rating rate, thumbs-up rate, median TTV, with the cross-bucket table (`M`)
- [ ] **REQ-LAUNCH-01a** Public waitlist form on synapsesync.app — email + editor field (`S`)
- [ ] **REQ-LAUNCH-01b** Idempotent insert into `waitlist` table (`XS`)
- [ ] **REQ-LAUNCH-01c** Approve-by-id endpoint or SQL recipe documented in `docs/` (`XS`)
- [ ] **REQ-LAUNCH-02a** Resend integration with `synapsesync.app` sender domain + DKIM (`S`)
- [ ] **REQ-LAUNCH-02b** Activation email triggered on approve with magic link + install command (`S`)
- [ ] **Backend observability** Sentry via `@sentry/cloudflare` with error capture + source maps + email alert on > 5 errors / 5 min (`S`)

**Estimated total:** ~3-4 dev days of focused work, fits the 5-day window with buffer.

### Add post-launch (P2 — signal-dependent)

- [ ] **Reason picker on thumbs-down** (3-4 preset reasons + free text) — add once you see N enough thumbs-down to understand the modal failure
- [ ] **Outlier flagging on TTV > 30min sessions** — add when there's enough session volume to find them
- [ ] **Daemon-side Sentry** in `mcp/` — when the MCP package itself shows install-time crashes in user reports
- [ ] **Soft auto-approve under daily cap** for the waitlist — add when manual approval becomes a daily chore (not before)

### Future / deferred (P3 — wait for PMF or signal)

- [ ] **NPS / CSAT periodic surveys** — only meaningful after a stable user base
- [ ] **A/B test of brief variants** — needs statistical N; deliberately deferred per PROJECT.md
- [ ] **Referral / viral mechanics** on waitlist — wrong shape for this product
- [ ] **Frontend error tracking with Sentry SvelteKit** — frontend isn't the bottleneck
- [ ] **OpenTelemetry distributed tracing** — pay-only feature on Workers; overkill for current architecture
- [ ] **Email drip / re-engagement sequences** — premature
- [ ] **Admin dashboard for waitlist management** — SQL is faster

---

## Peer-Product Citations Summary

Internal vs. user-facing surface, with a peer-product anchor for each design decision:

| Feature decision | Peer-product anchor |
|------------------|----------------------|
| Binary thumbs (not 5-star) | ChatGPT, GitHub Copilot Chat, Microsoft Copilot Studio |
| Reason-on-negative only | ChatGPT down-vote follow-up; Copilot Studio configurable reasons |
| Time-to-value as the session metric | Amplitude TTV framework; Onboard.io customer onboarding metrics; OTel time-to-first-span |
| Pure throttled-access (not viral) waitlist | Linear early access; OpenAI API access; Raycast Pro |
| Resend over SES for transactional | Indie-dev market consensus; React-Email integration; free-tier coverage |
| Sentry via `@sentry/cloudflare` over OTLP | Cloudflare's own integration docs; doesn't require Workers Paid |
| Static error-rate threshold over anomaly detection | Sentry's own default; small-N traffic patterns make ML alerting useless |
| Magic-link activation, not registration | Supabase auth invite-only pattern; standard transactional flow |

---

## Sources

- [Microsoft Copilot Studio — thumbs up/down feedback](https://learn.microsoft.com/en-us/power-platform/release-plan/2025wave1/microsoft-copilot-studio/collect-thumbs-up-or-down-feedback-comments-agents) — HIGH confidence
- [AI Chat UI Best Practices 2026 — thefrontkit](https://thefrontkit.com/blogs/ai-chat-ui-best-practices) — MEDIUM
- [Microsoft Agent Academy — collecting user feedback](https://microsoft.github.io/agent-academy/operative/11-obtain-user-feedback/) — HIGH
- [Amplitude — Time to Value drives retention](https://amplitude.com/blog/time-to-value-drives-user-retention) — HIGH
- [Product School — Time to Value metric](https://productschool.com/blog/product-strategy/time-to-value) — HIGH
- [Onboard.io — onboarding metrics](https://onboard.io/blog/onboarding-metrics-days-to-launch-time-to-value) — MEDIUM
- [OpenTelemetry — instrumentation concepts](https://opentelemetry.io/docs/concepts/instrumentation/) — HIGH
- [Waitlister — SaaS waitlist playbook 2026](https://waitlister.me/growth-hub/guides/saas-product-launch-waitlist) — MEDIUM
- [LaunchList — referral waitlist guide](https://getlaunchlist.com/blog/waitlist-referral-program-guide) — MEDIUM
- [Supabase — Before User Created Hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) — HIGH (official)
- [Supabase — invite-only signup discussion #4296](https://github.com/orgs/supabase/discussions/4296) — HIGH
- [Postmark — what is transactional email](https://postmarkapp.com/blog/what-is-transactional-email-and-how-is-it-used) — HIGH (vendor)
- [Courier — top transactional ESPs 2025](https://www.courier.com/blog/top-6-email-service-providers-for-transactional-notifications-in-2025) — MEDIUM
- [Cloudflare Workers — Observability docs](https://developers.cloudflare.com/workers/observability/) — HIGH (official)
- [Cloudflare Workers — Export to Sentry](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/sentry/) — HIGH (official)
- [Sentry — Cloudflare integration docs](https://docs.sentry.io/platforms/javascript/guides/cloudflare/) — HIGH (official)
- [Baselime — Cloudflare observability blog](https://baselime.io/blog/cloudflare-observability-with-baselime) — MEDIUM
- [PostHog — vs Mixpanel for startups](https://posthog.com/blog/posthog-vs-mixpanel) — MEDIUM (vendor, but useful framing)

---
*Feature research for: launch-readiness milestone, AI coding session capture & handoff product*
*Researched: 2026-05-19*
