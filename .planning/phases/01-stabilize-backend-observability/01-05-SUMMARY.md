---
phase: 01-stabilize-backend-observability
plan: 05
subsystem: observability
tags: [sentry, cloudflare-workers, hono, privacy]
requires:
  - phase: 01-stabilize-backend-observability
    provides: Hono Worker application and centralized AppError handling
provides:
  - Sentry Hono middleware configured as the first request middleware
  - Payload scrubbing for Synapse events before error delivery
  - Optional Cloudflare SENTRY_DSN binding with explicit disabled mode
affects: [backend, production-operations, OBS-01]
tech-stack:
  added: ["@sentry/cloudflare@10.65.0", "@sentry/hono@10.65.0"]
  patterns: [beforeSend payload allowlisting, DSN-as-Worker-secret]
key-files:
  created:
    - backend/src/lib/observability.ts
    - backend/test/lib/observability.test.ts
    - backend/test/lib/observability-wiring.test.ts
  modified:
    - backend/package.json
    - backend/src/lib/env.ts
    - backend/src/index.ts
    - backend/wrangler.jsonc
key-decisions:
  - "Pinned both official Sentry packages to matching version 10.65.0 after the human package-legitimacy gate."
  - "Keep Sentry disabled unless SENTRY_DSN is present and store the DSN only as a Cloudflare Worker secret."
requirements-completed: []
requirements-code-complete: [OBS-01]
coverage:
  - id: D1
    description: Synapse payload bodies are removed before Sentry delivery while safe identifiers and stack traces remain.
    requirement: OBS-01
    verification:
      - kind: unit
        ref: backend/test/lib/observability.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Sentry is registered before every other Hono middleware and unknown server errors are captured.
    requirement: OBS-01
    verification:
      - kind: unit
        ref: backend/test/lib/observability-wiring.test.ts
        status: pass
      - kind: integration
        ref: cd backend && npx vitest run
        status: pass
    human_judgment: false
  - id: D3
    description: A production Worker exception reaches Sentry with its real stack trace within one minute.
    requirement: OBS-01
    verification:
      - kind: manual_procedural
        ref: deploy with SENTRY_DSN and execute SC#4 deliberate throw
        status: unknown
    human_judgment: true
    rationale: Requires access to a Sentry project, a production Worker secret, deployment, and inspection of the received event.
duration: 12 min
completed: 2026-07-18
status: code-complete-live-verification-pending
---

# Phase 1 Plan 05: Sentry Observability Summary

**Privacy-scrubbed Sentry error capture is implemented for the Cloudflare Worker; production activation and live delivery verification remain pending.**

## Performance

- **Duration:** 12 min active execution
- **Started:** 2026-07-18T16:36:00Z
- **Completed:** 2026-07-18T16:48:00Z
- **Tasks:** 3 completed in code; 1 external activation checkpoint remains
- **Files modified:** 8 production/test files plus planning records

## Accomplishments

- Added matching official Sentry Cloudflare and Hono SDKs at version `10.65.0`.
- Added a tested `beforeSend` scrubber that removes request and handoff payload bodies while preserving stack traces and safe correlation fields.
- Registered Sentry as the first Hono middleware, disabled it explicitly when no DSN exists, and added defensive capture for unknown 500 errors.

## Task Commits

1. **Install approved Sentry SDK packages** — `2b157cd0`
2. **Define and implement the payload privacy contract** — `68098f54` (RED), `2c742cea` (GREEN)
3. **Define and implement Worker middleware wiring** — `9b1413e4` (RED), `1b0727a1` (GREEN)

## Verification

- `cd backend && npx vitest run test/lib/observability.test.ts test/lib/observability-wiring.test.ts` — 7/7 tests passed.
- `cd backend && npx vitest run` — full backend suite passed.
- `npm run typecheck` — all workspaces passed.
- Targeted Biome checks for all changed source and test files passed.
- Root `npm run lint` remains polluted by pre-existing untracked `.planning/graphs/`, `graphify-out/`, and `supabase/.temp/` generated artifacts; none were edited or committed.

## Decisions Made

- Used `10.65.0`, the human-approved previous stable release, rather than the two-day-old `10.66.0`.
- Added `enabled: Boolean(env.SENTRY_DSN)` so local and unconfigured deployments are guaranteed to remain no-op.
- Kept `SENTRY_DSN` out of repository configuration and documented `wrangler secret put SENTRY_DSN` as the only production path.

## Deviations from Plan

### Auto-fixed Issues

**1. Current Sentry type contract requires an ErrorEvent-preserving callback**
- **Found during:** Task 3 typecheck
- **Issue:** The saved plan's concrete `Event -> Event` signature was too broad for Sentry 10.65.0's `beforeSend` callback.
- **Fix:** Made `scrubPayload` generic over `T extends Event`, preserving the input event subtype.
- **Verification:** Backend and workspace typechecks pass.

**2. Biome formats the first middleware across multiple lines**
- **Found during:** Task 3 formatting
- **Issue:** The old static assertion expected the literal single-line text `app.use(sentry(`.
- **Fix:** The test now accepts formatter whitespace while still proving the Sentry call is the first `app.use` occurrence.
- **Verification:** Wiring test passes and is robust to formatting.

**Total deviations:** 2 auto-fixed compatibility issues. **Impact:** No scope expansion; both changes make the saved plan compatible with the current SDK and repository formatter.

## Issues Encountered

The original Netskope/npm blocker no longer exists on this machine. The current npm metadata and package source were verified before the user approved version `10.65.0`.

## User Setup Required

See [01-USER-SETUP.md](./01-USER-SETUP.md). A Sentry project DSN must be retrieved by the user. The agent can then add it through Wrangler, deploy, and execute the controlled live verification.

## Next Phase Readiness

- The Plan 05 code portion is complete.
- OBS-01 remains pending until the live deliberate-throw event is visible in Sentry within one minute.
- OPS-01 also remains pending because Cloudflare Workers Paid-tier status still requires a dashboard check.
- **0 Phase 1 success criteria closed by this code-only slice; SC#4 closes only after deployment and live verification.**

## Self-Check: PASSED

All code artifacts exist, all five OBS-01 validation rows are green, changed files pass formatting/type checks, and the full backend suite passes.

---
*Phase: 01-stabilize-backend-observability*
*Completed in code: 2026-07-18*
