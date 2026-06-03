/** Base flush delay in milliseconds — the first delay used after a success, and the floor of the schedule. */
export const BASE_DELAY_MS = 10_000;

// MAX_DELAY_MS is the deliberate 5-minute ceiling; it masks long outages by
// design (BUGS.md #12 follow-up: surface backoff state via daemon.log
// readback in slice 1b). Reviewer-checklist: any change to this value must
// be intentional, justified, and reflected in the cap-test bands in
// `mcp/test/capture/daemon-backoff.test.ts`.
export const MAX_DELAY_MS = 300_000;

/**
 * Pure function: given the previous delay and whether the last cycle succeeded,
 * return the next delay (after applying ±25% multiplicative jitter).
 *
 *   - lastSucceeded === true:  target = BASE_DELAY_MS
 *   - lastSucceeded === false: target = min(prevDelayMs * 2, MAX_DELAY_MS)
 *   - return target * (0.75 + Math.random() * 0.5)
 *
 * No side effects, no I/O, no timers, no `Date.now()`. Only `Math.random()`
 * for jitter. This isolation is the BLOCKER #5 fix — `daemon-backoff.test.ts`
 * tests this helper directly without `vi.useFakeTimers()`, eliminating
 * collisions with the two preserved `setInterval` calls in `startHandoffLoop`.
 */
export function computeNextDelay(prevDelayMs: number, lastSucceeded: boolean): number {
  const target = lastSucceeded ? BASE_DELAY_MS : Math.min(prevDelayMs * 2, MAX_DELAY_MS);
  return target * (0.75 + Math.random() * 0.5);
}
