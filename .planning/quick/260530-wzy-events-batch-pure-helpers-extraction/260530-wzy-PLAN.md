---
quick_id: 260530-wzy
description: BUGS.md 5a path (b) — events-batch handler refactor for unit-testability
date: 2026-05-30
status: in-progress
---

# Quick Task 260530-wzy: events-batch Pure-Helper Extraction (5a Proof-of-Concept)

**BUGS.md reference:** `docs/BUGS.md` §5a — "Backend integration tests skip the actual handler logic for events-batch + 6 other endpoints"

## Problem

10+ `.skip`'d tests across `backend/test/api/` cover the happy paths for 7 endpoints — `events-batch`, `events-batch-auto-create`, `project-status`, `project-events`, `invites`, `projects-delete`, `projects-merge`, `auth-me`. They're gated on "requires valid auth token + DB" because the Supabase test secrets aren't configured in CI.

**The damage:** the Cloudflare 1101 error in P0 #1 was caused by a missing `handoff_events` table that the handler tried to query. The skipped tests would have caught it on the first build. Path-(a) fix (configure Supabase secrets) needs human action. Path-(b) fix (refactor handlers for unit-testability) is autonomous.

## Approach

This task is the proof-of-concept for path (b) on the single highest-impact endpoint — `events-batch`. The pattern established here is the template for the remaining 6 endpoints.

**Refactor shape:**
- Extract pure (no DB, no Hono context) logic into a sibling `events-batch-pure.ts` file
- Handler imports + calls the helpers; handler becomes thin glue around DB calls (`upsert`, `recompute`) and Hono response building
- Unit tests target the helpers directly — no Supabase, no auth, no Worker runtime
- Live-DB tests (the skipped ones) remain skipped — the helpers cover the bug classes that previously had ZERO coverage outside the skipped tests

**The four pure helpers:**

1. `validateEventsBatchBody(body) → { ok: true; events: BatchEvent[] } | { ok: false; reason: string }`
   - Pulls the existing inline check `if (!Array.isArray(body.events) || body.events.length === 0) return c.json({ error: "events array required" }, 400)` into a testable predicate.
   - Bug class: "input validation regressed (e.g. accepts empty array, rejects valid one)" — currently uncovered.

2. `prepareEventRows(events, userId, now, skewLimitMs?) → { rows: RowMutable[]; adjusted_event_ids: string[] }`
   - The skew-adjustment + actor-flattening loop from the handler.
   - `skewLimitMs` defaults to `5 * 60 * 1000` (matches `SKEW_LIMIT_MS` constant).
   - Bug class: "skew adjustment fails to flag future events" OR "incorrectly flags past events" — currently the only test for this is `adjusted` being returned in response, which the skipped tests never reach.

3. `extractCwdHashes(rows, pattern?) → string[]`
   - The `[...new Set(rows.filter(r => CWD_HASH_PATTERN.test(r.project_id)).map(r => r.project_id))]` line.
   - `pattern` defaults to `/^cwd_[a-f0-9]{12}$/` (matches `CWD_HASH_PATTERN`).
   - Bug class: "regex loosened accidentally so `cwd_short` or `cwd_aabbcc_extra` slip through as if they were valid cwd-hash ids, causing the auto-create path to spawn projects with garbage names."

4. `applyIdMapping(rows, idMapping) → rows` (mutating helper; consistent with the existing in-place pattern)
   - The `for (const r of rows) { const remapped = idMapping.get(r.project_id); if (remapped) r.project_id = remapped; }` loop.
   - Bug class: "id-remapping loop drops rows" — happens if someone refactors and forgets to actually mutate the row, or uses the wrong key.

## must_haves

- `backend/src/api/events-batch-pure.ts` exists, exports the 4 helpers
- `backend/src/api/events-batch.ts` imports + calls them; handler body is purely glue (DB upsert + recompute + response)
- `backend/test/api/events-batch-pure.test.ts` exists, 12+ tests, all passing
- `npm run typecheck` clean
- `npm run lint` clean  
- `npm run test` for backend passes (no regression on the existing tests)
- `docs/BUGS.md` 5a entry updated to mark events-batch done + pattern doc
- Atomic commit + push

## Out of scope

- Live-DB integration tests (those need Supabase secrets — path (a))
- Refactoring the 6 OTHER endpoints (this is proof-of-concept; pattern is documented)
- Removing the existing `Promise.allSettled` defensive layer
- Renaming the helpers' parameters or changing types (RowMutable interface stays internal)
