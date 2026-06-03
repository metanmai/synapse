// Pure helpers for the project-events handler. BUGS.md 5a path-(b) round 2.
//
// Two small but real bug-class guards. The handler reads pagination
// parameters from the query string and computes a cursor for the next
// page; both surfaces have edge cases (`parseInt` returning NaN,
// negative numbers slipping through, the cursor being lost when the
// page is empty) that the original inline code didn't pin down.

// Default and ceiling for the events page size. Default matches the
// daemon's typical pull batch; ceiling guards against a runaway request
// that asks for "limit=99999999" and causes the Worker to ship MB of
// JSON. Caller still has to pay attention — too-low values get silently
// promoted to 1 (no zero-row pages).
export const DEFAULT_EVENTS_LIMIT = 200;
export const MAX_EVENTS_LIMIT = 1000;
export const MIN_EVENTS_LIMIT = 1;

// Coerce a raw `?limit=` query value into a sane integer in
// [MIN, MAX]. Edge cases:
//   - missing (`null` / `undefined`)        → DEFAULT_EVENTS_LIMIT
//   - non-numeric string ("abc")            → DEFAULT_EVENTS_LIMIT
//   - negative or zero                      → MIN_EVENTS_LIMIT
//   - over MAX_EVENTS_LIMIT                 → MAX_EVENTS_LIMIT
//   - decimals                              → truncated by parseInt
//
// Bug class: someone wraps `parseInt` in `Math.min(...)` without a
// floor or NaN guard, so `Math.min(parseInt("abc", 10), 1000)` returns
// NaN, the DB query .limit(NaN) errors, and the user sees an opaque
// 500. The function below handles all the edges and pins them in tests.
export function parseEventsLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_EVENTS_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_EVENTS_LIMIT;
  if (parsed < MIN_EVENTS_LIMIT) return MIN_EVENTS_LIMIT;
  if (parsed > MAX_EVENTS_LIMIT) return MAX_EVENTS_LIMIT;
  return parsed;
}

// Compute the `next_since` cursor for the response.
// - Non-empty page: the last row's event_id (caller's next page starts
//   strictly after this).
// - Empty page: echo the caller's `since` so they can poll with the same
//   cursor and still detect new events when they arrive.
//
// Bug class: someone changes the empty-page fallback to `null`, breaking
// the daemon's idle-poll path — the daemon would forget its cursor and
// re-read the entire history on the next non-empty page.
export function computeNextSince(
  events: ReadonlyArray<{ event_id: string }>,
  fallbackSince: string | null,
): string | null {
  if (events.length === 0) return fallbackSince;
  return events[events.length - 1].event_id;
}
