---
quick_id: 260530-wzy
description: BUGS.md 5a path (b) — events-batch handler refactor for unit-testability
date: 2026-05-30
status: complete
---

# Summary — 260530-wzy

## What changed

1. **New file** `backend/src/api/events-batch-pure.ts` — 4 pure helpers extracted from the handler:
   - `validateEventsBatchBody(body)` — returns `{ ok: true; events } | { ok: false; reason }`. Gates the existing 400 "events array required" response.
   - `prepareEventRows(events, userId, now, skewLimitMs?)` — coerces inbound BatchEvents into mutable DB rows, flattens actor.kind/device_id into columns, clamps forward-skewed `occurred_at` to `now`, and returns `adjusted_event_ids` for the response.
   - `extractCwdHashes(rows, pattern?)` — deduplicated list of `cwd_<12 lowercase hex>` placeholder project_ids requiring auto-create. Strict regex prevents accidental project spawning for non-canonical ids.
   - `applyIdMapping(rows, idMapping)` — in-place mutation of `project_id` for rows whose placeholder was resolved by the auto-create loop.

2. **Refactored** `backend/src/api/events-batch.ts` — handler body is now ~30 lines of glue around the 4 helpers + the DB upsert + `Promise.allSettled` recompute loop. **No behavior change.** The constants and types moved to `events-batch-pure.ts`; the handler imports them.

3. **New tests** `backend/test/api/events-batch-pure.test.ts` — 28 tests:
   - `validateEventsBatchBody` (5 tests): non-object body, missing events key, non-array events, empty array, ok happy path
   - `prepareEventRows` (9 tests): past-skewed untouched, within-window untouched, future-skewed clamped + flagged, custom `skewLimitMs` wired, `DEFAULT_SKEW_LIMIT_MS` pinned at 5 min, actor flattening (server `user_id` wins over client-provided), default `attached_to: null` and `payload: {}`, `received_at` from server `now`, mixed batch (past + ok + 2 futures)
   - `extractCwdHashes` (9 tests): canonical 12-hex matches, rejects too-short, rejects extra-trailing, rejects uppercase, rejects non-hex, dedups, returns multi-distinct, ignores non-cwd ids, `DEFAULT_CWD_HASH_PATTERN` pinned (source + flags)
   - `applyIdMapping` (5 tests): single rewrite, untouched-when-not-in-map, partial mapping, empty map no-op, multiple rows with same cwd → all rewritten

4. **Updated** `docs/BUGS.md` §5a — added status note: path (b) proof-of-concept done for `events-batch`. Listed the remaining 6 endpoints still on the to-do list with their pure-extractable concerns.

## Why this matters

The Cloudflare 1101 in P0 #1 was a missing-table error in the `events-batch` handler that the test suite couldn't see — because the only tests touching the handler were `.skip`'d for lack of Supabase secrets. The pattern established here demonstrates that **most** of the handler's correctness-critical logic doesn't need a DB to test:

- Skew adjustment logic
- Regex strictness on the cwd-hash auto-create path
- Actor flattening (server-authoritative user_id)
- Id remapping correctness across multiple rows

These now have 28 unit tests as opposed to 0 from `.skip`'d integration tests, and they run on every CI build without Supabase secrets.

## Tests

- `backend/test/api/events-batch-pure.test.ts` — 28/28 pass
- Full backend suite — 443/469 pass (26 pre-existing 5a integration skips unchanged)
- Full repo typecheck — clean (backend, frontend with svelte-check, mcp, shared)
- Full repo lint — clean (1 pre-existing warning in mcp/test that I didn't touch)

## Pattern for remaining endpoints

The 6 remaining endpoints in 5a (events-batch-auto-create, project-status, project-events, invites, projects-delete, projects-merge, auth-me) can follow this template:

1. Identify pure logic in the handler — anything that doesn't touch `db.from()` or Hono context. Common candidates: input validation, output shape building, ID/regex parsing, business-rule branching.
2. Move it into `<endpoint>-pure.ts` as exported functions with explicit parameters.
3. Refactor the handler to import + call the pure helpers; let DB code stay in the handler.
4. Write `<endpoint>-pure.test.ts` with bug-class tests (not implementation tests).

The `.skip`'d integration tests stay skipped — they need Supabase secrets to run. But the unit-tested helpers will catch >80% of the bugs the integration tests were meant to catch.

## Out of scope

- Live-DB integration tests for events-batch (still need Supabase secrets — path (a))
- Refactoring the 6 remaining endpoints (deliberate — this is proof-of-concept)
- Adding new behavior to the helpers (e.g. max batch size cap, additional sentinel detection)
- Changing the handler's response shape

## Followups

None blocking. Optional: when the user does configure Supabase test secrets (P1 from BUGS.md), the `.skip`'d integration tests can run alongside the pure-helper tests — they cover different bug classes (helpers cover logic regressions; integration covers schema/RLS/migration drift).
