---
quick_id: 260531-0as
description: BUGS.md 5a round 2 — invites + project-events pure helpers
date: 2026-05-31
status: complete
---

# Summary — 260531-0as

## What changed

1. **New file** `backend/src/api/invites-pure.ts` — 5 pure helpers + 2 constants:
   - `generateInviteToken()` — relocated from invites.ts. 24-byte (192-bit) crypto-random → 32-char base64url string.
   - `parseInviteRequestBody(rawBody)` — JSON parse + email validation. Returns `{ ok: true; email } | { ok: false; status: 400; reason }`. Replaces inline try/catch + `body.email.trim()` chain.
   - `isInviteExpired(invite, now)` — `expires_at < now` boundary check (strict less-than = one-tick grace).
   - `isInviteAccepted(invite)` — `accepted_at != null` state check.
   - `computeInviteExpiresAt(now, ttlMs?)` — ISO timestamp at `now + TTL`.
   - `buildJoinUrl(token)` — `JOIN_URL_BASE + "/" + token`.
   - Constants: `INVITE_TTL_MS` (7 days), `JOIN_URL_BASE` (prod URL).

2. **Refactored** `backend/src/api/invites.ts` — POST `/projects/:id/invites` now reads raw text + calls `parseInviteRequestBody`; both handlers use `isInviteAccepted` / `isInviteExpired` / `computeInviteExpiresAt` / `buildJoinUrl`. Behavior unchanged.

3. **New file** `backend/src/api/project-events-pure.ts` — 2 helpers + 3 constants:
   - `parseEventsLimit(raw)` — coerces `?limit=` query param. Handles null, NaN, over-cap (1000), under-floor (1), decimals.
   - `computeNextSince(events, fallbackSince)` — cursor advancement; preserves caller's `since` on empty page.
   - Constants: `DEFAULT_EVENTS_LIMIT` (200), `MAX_EVENTS_LIMIT` (1000), `MIN_EVENTS_LIMIT` (1).

4. **Refactored** `backend/src/api/project-events.ts` — handler imports + calls the helpers. Inline `Math.min(parseInt(...))` removed.

5. **New tests** `backend/test/api/invites-pure.test.ts` — 21 tests:
   - `generateInviteToken` (4): 32-char length, url-safe charset (100 samples), high-entropy distinctness (1000 samples, ≤10 collisions), never empty
   - `parseInviteRequestBody` (6): malformed JSON, non-object, missing email, whitespace email, valid email trimmed, extra fields ignored
   - `isInviteExpired` (4): future, past, exact moment (grace), 1ms past
   - `isInviteAccepted` (3): null, non-null, undefined (defensive)
   - `computeInviteExpiresAt` (3): TTL pin, default, custom override
   - `buildJoinUrl` (2): composition, JOIN_URL_BASE pin

6. **New tests** `backend/test/api/project-events-pure.test.ts` — 13 tests:
   - `parseEventsLimit` (7): null/empty default, NaN default, over-cap clamp, under-floor floor, valid integers, decimal truncation, constants pinned
   - `computeNextSince` (5): non-empty last event_id, empty page preserves fallback, empty with null fallback, single event, no crash on empty

7. **Updated** `docs/BUGS.md` §5a — status note: round 2 done for invites + project-events. Path (a) flagged as preferred for project-status, auth-me, projects-delete, projects-merge (low path-(b) surface).

## Why this matters

**invites:** Token generation is the most security-relevant code in the invite flow. Charset relaxation (`+/=` slipping in) breaks URL safety; entropy regression (someone swapping in `Math.random()`) opens guessing attacks. Body validation guards against fuzzing for stub invites. Expiry boundary math is the gate between "valid" and "410 Gone" — getting it wrong means re-redeemable tokens or invalidated in-flight redemptions. None of these need a DB to test.

**project-events:** The limit-clamp logic guards against cost-of-service attacks (`?limit=99999999`). The cursor preservation logic is load-bearing for the daemon's idle-poll — if it regresses, the daemon re-reads all events on every poll. Neither needs a DB to verify.

## Tests

- `invites-pure.test.ts` — 21/21 pass
- `project-events-pure.test.ts` — 13/13 pass
- Full backend — 477/503 (was 443 last commit → +34 new)
- Full repo typecheck + lint — clean (1 pre-existing warning in unrelated mcp file)

## Path (b) status across all 5a endpoints

| Endpoint | Status | Why |
|---|---|---|
| `events-batch` | ✅ done (round 1) | 28 tests |
| `events-batch-auto-create` | ✅ effectively done | Pure logic IS in events-batch-pure.ts |
| `invites` | ✅ done (round 2) | 21 tests |
| `project-events` | ✅ done (round 2) | 13 tests |
| `project-status` | ⚠️ path (a) preferred | 21-line handler is all DB |
| `auth-me` | ⚠️ path (a) preferred | 5-line handler; tests assert public.users JOIN |
| `projects-delete` | ⚠️ path (a) preferred | Cascade ordering is inherently DB |
| `projects-merge` | ⚠️ path (a) preferred | Owner-check + RPC are DB-bound |

**Net effect:** path (b) has exhausted its useful surface for 5a. The remaining 4 endpoints need path (a) (Supabase test secrets) to gain meaningful test coverage. The `.skip`'d integration tests for those endpoints stay skipped until secrets land.

## Out of scope

- Refactoring the 4 path-(a)-preferred endpoints (no benefit)
- Live-DB integration tests (path (a) — requires you)
- Changing handler responses or URL shapes

## Followups

None for path (b). Optional: when Supabase test secrets are configured, the 26 `.skip`'d integration tests run alongside the pure-helper tests with no further refactoring needed — different bug classes, complementary coverage.
