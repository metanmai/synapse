// Wave 0 stub — fill in Plan 01-02 (BUGS.md #12 — daemon flush exponential backoff).
// Exports the type contract that Wave 2 production code will implement and Wave 1
// RED tests can import. The two delay constants carry real values from Wave 0
// (the tests assert against them); `computeNextDelay` throws "not implemented
// — Wave 2" until Plan 01-02 fills the body and wires it into `startHandoffLoop`.

/** Base flush delay in milliseconds — the first delay used after a success, and the floor of the schedule. */
export const BASE_DELAY_MS = 10_000;

/** Maximum flush delay in milliseconds — the schedule caps here on repeated failures (~5 min). */
export const MAX_DELAY_MS = 300_000;

/**
 * Pure function: given the previous delay and whether the last cycle succeeded,
 * return the next delay (after applying ±25% multiplicative jitter).
 *
 * Schedule (Wave 2 will implement):
 *   - lastSucceeded === true:  return BASE_DELAY_MS, jittered
 *   - lastSucceeded === false: return min(prevDelayMs * 2, MAX_DELAY_MS), jittered
 *
 * Pure: no side effects, no I/O, no timers. Plan 01-02 wires this into
 * `startHandoffLoop`'s self-rescheduling `setTimeout` cycle.
 *
 * @param _prevDelayMs    delay used for the just-completed cycle
 * @param _lastSucceeded  whether the just-completed cycle's flush succeeded
 * @returns               next delay in ms, with jitter applied
 */
export function computeNextDelay(_prevDelayMs: number, _lastSucceeded: boolean): number {
  throw new Error("not implemented — Wave 2");
}
