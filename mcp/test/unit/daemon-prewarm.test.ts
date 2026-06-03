import { describe, expect, it } from "vitest";
import { PREWARM_MIN_INTERVAL_MS, shouldPrewarm } from "../../src/capture/daemon.js";

/**
 * Bug class under test: "the daemon's pull-handoff pre-warm fires
 * unthrottled and either burns money / saturates the LLM rate-limit, or
 * never fires at all because the debounce is too strict."
 *
 * Tests the PURE `shouldPrewarm(lastPrewarmAt, projectId, now, intervalMs)`
 * helper directly — no fake timers, no spawn mocking. Each case is a direct
 * call → boolean assertion. Mirrors the testing posture established in
 * daemon-backoff.test.ts (pure-function tests, no loop driving).
 */
describe("shouldPrewarm — daemon pull-handoff debounce", () => {
  it("returns true for a never-pre-warmed project", () => {
    const map = new Map<string, number>();
    expect(shouldPrewarm(map, "p1", Date.now(), PREWARM_MIN_INTERVAL_MS)).toBe(true);
  });

  it("returns false within the interval after a recent pre-warm", () => {
    const map = new Map<string, number>();
    const t0 = 1_000_000;
    map.set("p1", t0);
    // 1ms after the last warm — must be debounced.
    expect(shouldPrewarm(map, "p1", t0 + 1, PREWARM_MIN_INTERVAL_MS)).toBe(false);
    // Just under the boundary — still debounced.
    expect(shouldPrewarm(map, "p1", t0 + PREWARM_MIN_INTERVAL_MS - 1, PREWARM_MIN_INTERVAL_MS)).toBe(false);
  });

  it("returns true exactly at the interval boundary (>= semantics)", () => {
    // Boundary check: at exactly intervalMs we MUST re-warm. The "<" vs "<="
    // bug class would silently shift the throttle by one cycle — measurable
    // here even though imperceptible in production.
    const map = new Map<string, number>();
    const t0 = 1_000_000;
    map.set("p1", t0);
    expect(shouldPrewarm(map, "p1", t0 + PREWARM_MIN_INTERVAL_MS, PREWARM_MIN_INTERVAL_MS)).toBe(true);
  });

  it("returns true after the interval has elapsed", () => {
    const map = new Map<string, number>();
    const t0 = 1_000_000;
    map.set("p1", t0);
    expect(shouldPrewarm(map, "p1", t0 + PREWARM_MIN_INTERVAL_MS + 1, PREWARM_MIN_INTERVAL_MS)).toBe(true);
    expect(shouldPrewarm(map, "p1", t0 + 60 * 60 * 1000, PREWARM_MIN_INTERVAL_MS)).toBe(true);
  });

  it("debounces independently per project", () => {
    // Bug class: a single global timestamp instead of per-project. Would
    // cause project B to silently inherit project A's throttle window.
    const map = new Map<string, number>();
    const t0 = 1_000_000;
    map.set("p1", t0);
    // p1 throttled, p2 untouched — must be allowed.
    expect(shouldPrewarm(map, "p1", t0 + 1000, PREWARM_MIN_INTERVAL_MS)).toBe(false);
    expect(shouldPrewarm(map, "p2", t0 + 1000, PREWARM_MIN_INTERVAL_MS)).toBe(true);
  });

  it("simulates the documented launch-eve scenario: two batch-syncs within the interval fire one warm only", () => {
    // This is the acceptance-criterion check from docs/HANDOFF-2026-05-28.md
    // Priority 1: "assert that 2 batch-syncs within PREWARM_MIN_INTERVAL_MS
    // only fire one pull-handoff."
    const map = new Map<string, number>();
    let fires = 0;
    const now1 = 1_000_000;
    if (shouldPrewarm(map, "p1", now1, PREWARM_MIN_INTERVAL_MS)) {
      map.set("p1", now1);
      fires++;
    }
    // Second batch arrives 30 seconds later (well inside the 5-min window).
    const now2 = now1 + 30_000;
    if (shouldPrewarm(map, "p1", now2, PREWARM_MIN_INTERVAL_MS)) {
      map.set("p1", now2);
      fires++;
    }
    expect(fires).toBe(1);

    // Third batch arrives after the window — must fire.
    const now3 = now1 + PREWARM_MIN_INTERVAL_MS + 5_000;
    if (shouldPrewarm(map, "p1", now3, PREWARM_MIN_INTERVAL_MS)) {
      map.set("p1", now3);
      fires++;
    }
    expect(fires).toBe(2);
  });

  it("PREWARM_MIN_INTERVAL_MS is 5 minutes (production cost-cap contract)", () => {
    // Locking the constant — if someone bumps it down to seconds, this
    // test fails loud rather than the LLM bill failing quiet.
    expect(PREWARM_MIN_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
