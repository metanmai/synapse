---
phase: 02-real-user-identity
plan: 4
status: complete
wave: 3
completed: 2026-05-20
commits:
  - "10c9605 — partial: runFlushCycle filters _pulled marker (D-08, partial — CI-green unblocker)"
  - "ddbe959 — full: Slice B cross-device link + eager pull (D-06 + D-08 end-to-end)"
deferred_operator_action: "supabase db push for migration 018 to dogfood Supabase"
---

# Plan 02-04 — Cross-Device Link + Eager Pull (Slice B) — SUMMARY

> End-to-end cross-device same-user discovery + history backfill. When a user installs on machine B in the same git repo they're already syncing on machine A, the daemon's first flush auto-links to the existing project via `git_remote_url`, and `runEagerPullCycle` bootstraps machine B's local `events.jsonl` with the project's recent history. SessionStart on machine B renders briefs that surface machine A's activity + hostname.

## What shipped

### DB schema (D-06) — `ddbe959`

- **NEW** `supabase/migrations/018_projects_git_remote_url.sql` — additive + idempotent. Adds nullable `git_remote_url text` column to `projects`; partial index `projects_user_remote_url_idx` on `(owner_id, git_remote_url) where git_remote_url is not null`. No RLS changes.

> **OPERATOR ACTION DEFERRED.** The file lands here; `supabase db push` against dogfood Supabase is a separate manual step. Tests don't require the push — structural assertions pass without the column existing in live DB; live-DB integration cases stay `.skip`'d per existing convention.

### Backend matcher (D-06) — `ddbe959`

- `backend/src/api/events-batch.ts` — extends `cwd_<hash>` auto-create flow. Reads `payload.git_remote_url` alongside `payload.git_basename`.
  - **URL-first match**: `WHERE git_remote_url = $1 AND id IN (memberProjectIds)`.
  - **Falls back** to name-match (status quo).
  - **Opportunistic backfill**: on name-match success AND existing row has NULL `git_remote_url` AND event carries one → `UPDATE` the row with the URL.
  - **On create**: inserts with both `name` and `git_remote_url`.
  - **Pitfall 9 guard PRESERVED VERBATIM**: `actor_user_id: user.id` override at line 60 — the cross-user merge-leak guard from RESEARCH stays exactly where it was.

### MCP daemon-side capture (D-06) — `ddbe959`

- `mcp/src/cli/hook-dispatch.ts` — adds module-level `gitRemoteCache` Map + `getGitRemoteUrl(cwd)` helper. Wraps `git config --get remote.origin.url` in try/catch; per-cwd cache (in-memory, not persisted). `readHookPayloadFromStdin` now passes `git_remote_url` to handlers.
- `mcp/src/hooks/session-start.ts` — `SessionStartArgs` extended with `git_remote_url?: string`; payload spread mirrors `git_basename` pattern.

### MCP eager pull (D-08) — `ddbe959`

- `mcp/src/capture/handoff-sync.ts` — exports `runEagerPullCycle(args)`. Fetches `GET /api/projects/:id/events?limit=500`, appends each event with `_pulled: true` marker to `events.jsonl`, advances `.watermark` to highest `event_id`. Empty response → no-op. 5xx → throws.
- `mcp/src/capture/daemon.ts` — calls `runEagerPullCycle` ONLY inside the `if (flush.canonical_project_id) { ... }` branch (first-time link), BEFORE the existing `runPullCycle`. Idempotent: subsequent flushes reuse the canonical UUID so `canonical_project_id` is never re-set after the first link.

### Feedback-loop guard (D-08, partial) — `10c9605`

- `mcp/src/capture/handoff-sync.ts` — `runFlushCycle` now filters `_pulled: true` events out of the outbound POST body while still advancing the watermark past them.

> **Why split?** This filter was shipped first as a CI-green unblocker after the Wave 2 commits flipped 2 RED tests. It addresses Phase 2 Pitfall 4 (events pulled FROM backend re-echoed back to `/events/batch`). Belt-and-suspenders over watermark-only filtering.

## RED → GREEN flips

- ✅ `handoff-sync.test.ts`: 2 RED tests on `_pulled` filtering (`10c9605`).
- ✅ `handoff-sync.test.ts`: 3 previously-`.skip`'d `runEagerPullCycle` cases (writes `_pulled` + advances watermark / empty pull no-op / 5xx throws) activated GREEN (`ddbe959`).
- ✅ `e2e/handoff.e2e.test.ts`: second assertion restored — the full handoff text round-trip (machine A → machine B brief) now passes. Plus a kind-fix from `"handoff"` (not a real EventKind) to `EventKind.NextStepSet` (what `runHandoffCmd` actually emits + what the reducer maps to `current_next_step`).
- ✅ `e2e/stub-backend.ts`: extended to serve `GET /api/projects/:id/events` (returns events ascending by `event_id`, matching backend contract). Required to make the e2e handoff test land green.

## Test suite state after commit

- backend: 380 passing, 20 skipped, 0 failing
- packages/shared: 72 passing
- mcp: 372 passing, 164 skipped, 0 failing (up from 369/167)
- frontend: unchanged (last touched in Phase 1; identity changes don't bleed into the UI yet — that's Plan 02-05)

**Plan-01 RED tests fully cleared.** Phase 2 leaves no intentional RED in mcp/backend after this commit.

## Quality gates

- **TypeScript:** all 4 workspaces `tsc --noEmit` clean.
- **Biome:** lint passes (1 pre-existing `any`-use warning in `handoff-sync.ts:77` carried from Plan 01 — not introduced here).
- **Vitest:** `npm test` exits 0 across all workspaces.
- **Pre-push hook:** standard verify (lint + typecheck + test) green.

## Deviations from plan

**Split delivery (partial + full).** The plan called for a single coherent Wave 3 commit. In practice, the `_pulled` filter (D-08 partial) shipped first as a green-CI unblocker (`10c9605`) so metanmai CI stayed green between Wave 2 (`e6a4847` + `8d34d7b` + `ad1953c`) and the full Wave 3 push. Net behaviour is identical — both commits are atomic; both have full test coverage. Per `feedback_ci_must_stay_green.md`.

**Migration applied to file only.** Plan called migration write + `supabase db push` as a coupled step. In practice, the push is a privileged operation against dogfood Supabase that requires operator network access; deferred to a separate manual action. File commit + structural test coverage land here; activation requires the push.

**E2E test kind correction.** During the e2e restore, the test was using `kind: "handoff"` (not a real EventKind). Fixed to `EventKind.NextStepSet` — what `runHandoffCmd` actually emits and what the reducer maps to `current_next_step`. This is a Phase 2-internal test-fidelity fix, not a contract change.

## Next steps

- **Operator action (deferred):** apply migration 018 to dogfood Supabase via `supabase db push` from a CF-enabled machine. The matcher code is live; activation requires the schema apply.
- **Plan 02-05 (Wave 4):** Manual Link UI — merge_projects RPC + POST /:id/merge-into/:target_id + LinkPicker.svelte + Settings page mount. Closes IDENT-02 by giving the user a manual override when auto-link is wrong.
- **Plan 02-06 (Wave 5):** Playwright e2e for the LinkPicker UI surface.
