import { describe, expect, it } from "vitest";
import { BASE_DELAY_MS, MAX_DELAY_MS, computeNextDelay } from "../../src/capture/daemon-backoff.js";

// VALIDATION row mapping (01-VALIDATION.md "Per-Task Verification Map"):
//   BUGS.md #12 → "Backoff starts at base delay (10s)"
//   BUGS.md #12 → "Backoff doubles on each failure (10→20→40→80→160→300)"
//   BUGS.md #12 → "Backoff caps at MAX_DELAY (300s)"
//   BUGS.md #12 → "Backoff resets to base on first success"
//   BUGS.md #12 → "Jitter is within ±25% of the current delay (assert range)"
//
// Tests the pure `computeNextDelay(prevDelayMs, lastSucceeded): number` helper
// directly. NO fake timers. NO loop driving. NO setInterval collisions. Each
// case is a direct call → numeric assertion in a tight loop. RED until Plan
// 01-02 (Wave 2) fills in the function body.
//
// Jitter contract per CONTEXT.md `<specifics>` + RESEARCH §"Pattern 5":
//   multiplicative ±25%, i.e. return ∈ [target * 0.75, target * 1.25].

describe("computeNextDelay (BUGS.md #12 — daemon flush backoff)", () => {
  it("returns BASE_DELAY_MS ± 25% jitter when lastSucceeded is true (any prevDelayMs)", () => {
    const samples: number[] = [];
    // prevDelayMs is intentionally large to prove the success branch IGNORES it.
    for (let i = 0; i < 200; i++) samples.push(computeNextDelay(40_000, true));

    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(BASE_DELAY_MS * 0.75); // 7_500
      expect(s).toBeLessThanOrEqual(BASE_DELAY_MS * 1.25); // 12_500
    }
    // Sanity: jitter is actually applied (not a fixed value masquerading as random).
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeLessThan(9_000);
    expect(max).toBeGreaterThan(11_000);
  });

  it("doubles prevDelayMs when lastSucceeded is false", () => {
    // prev=10s → target 20s → return ∈ [15s, 25s]
    const a: number[] = [];
    for (let i = 0; i < 200; i++) a.push(computeNextDelay(10_000, false));
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(15_000);
      expect(s).toBeLessThanOrEqual(25_000);
    }

    // prev=40s → target 80s → return ∈ [60s, 100s]
    const b: number[] = [];
    for (let i = 0; i < 200; i++) b.push(computeNextDelay(40_000, false));
    for (const s of b) {
      expect(s).toBeGreaterThanOrEqual(60_000);
      expect(s).toBeLessThanOrEqual(100_000);
    }
  });

  it("caps at MAX_DELAY_MS (300s) ± 25% upper bound", () => {
    // prev=200s → target = min(400s, 300s) = 300s → return ∈ [225s, 375s]
    const a: number[] = [];
    for (let i = 0; i < 200; i++) a.push(computeNextDelay(200_000, false));
    for (const s of a) {
      expect(s).toBeGreaterThanOrEqual(MAX_DELAY_MS * 0.75); // 225_000
      expect(s).toBeLessThanOrEqual(MAX_DELAY_MS * 1.25); // 375_000
    }

    // prev=1_000_000ms → unjittered cap is 300_000 → max return MUST be < 375_001
    const b: number[] = [];
    for (let i = 0; i < 200; i++) b.push(computeNextDelay(1_000_000, false));
    const max = Math.max(...b);
    expect(max).toBeLessThan(375_001);
  });

  it("resets to BASE_DELAY_MS band on success after a long backoff", () => {
    // After being at the cap, a single success returns to base-band immediately.
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) samples.push(computeNextDelay(300_000, true));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(BASE_DELAY_MS * 0.75); // 7_500
      expect(s).toBeLessThanOrEqual(BASE_DELAY_MS * 1.25); // 12_500
    }
  });

  it("jitter is multiplicative ±25% — range [0.75x, 1.25x] of the pre-jitter target", () => {
    // prev=80s → target=160s → return ∈ [120s, 200s]
    const target = 160_000;
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) samples.push(computeNextDelay(80_000, false));

    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(target * 0.75); // 120_000
      expect(s).toBeLessThanOrEqual(target * 1.25); // 200_000
    }
    // Sanity: distribution actually spans the band, not clustered at one end.
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeLessThan(130_000);
    expect(max).toBeGreaterThan(190_000);
  });
});
