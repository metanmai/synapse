// backend/test/api/project-events-pure.test.ts
//
// BUGS.md 5a path-(b) round 2: pure-helper coverage for project-events.
// Small but real bug classes — limit cap removal (cost explosion) and
// cursor regression on empty pages.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENTS_LIMIT,
  MAX_EVENTS_LIMIT,
  MIN_EVENTS_LIMIT,
  computeNextSince,
  parseEventsLimit,
} from "../../src/api/project-events-pure";

describe("parseEventsLimit — query-param coercion", () => {
  it("returns DEFAULT_EVENTS_LIMIT (200) when raw is null/undefined/empty", () => {
    // Bug class: someone removes the `?? "200"` fallback and calls
    // parseInt(null, 10), which returns NaN. The DB query .limit(NaN)
    // errors with an opaque "invalid query" 500.
    expect(parseEventsLimit(null)).toBe(DEFAULT_EVENTS_LIMIT);
    expect(parseEventsLimit(undefined)).toBe(DEFAULT_EVENTS_LIMIT);
    expect(parseEventsLimit("")).toBe(DEFAULT_EVENTS_LIMIT);
  });

  it("returns DEFAULT_EVENTS_LIMIT when raw is non-numeric (parseInt → NaN)", () => {
    // Bug class: caller sends ?limit=foo expecting an error; we'd rather
    // fall back to the default than 500. NaN check is the load-bearing
    // line — without it Math.min(NaN, 1000) = NaN.
    expect(parseEventsLimit("abc")).toBe(DEFAULT_EVENTS_LIMIT);
    expect(parseEventsLimit("not-a-number")).toBe(DEFAULT_EVENTS_LIMIT);
    expect(parseEventsLimit("undefined")).toBe(DEFAULT_EVENTS_LIMIT);
  });

  it("clamps over-cap requests to MAX_EVENTS_LIMIT (1000)", () => {
    // Bug class: the cap is REMOVED in a refactor, so a curl request
    // with ?limit=99999999 ships ~5MB of JSON back. The Worker has a
    // response-size budget and would crash on the way out. Pin the cap.
    expect(parseEventsLimit("1000")).toBe(1000);
    expect(parseEventsLimit("1001")).toBe(1000);
    expect(parseEventsLimit("99999999")).toBe(1000);
  });

  it("promotes under-floor requests to MIN_EVENTS_LIMIT (1)", () => {
    // Bug class: caller sends ?limit=0 (zero) and the DB query becomes
    // .limit(0), returning an empty page even though events exist. Push
    // to 1 so the caller can always make forward progress.
    expect(parseEventsLimit("0")).toBe(MIN_EVENTS_LIMIT);
    expect(parseEventsLimit("-1")).toBe(MIN_EVENTS_LIMIT);
    expect(parseEventsLimit("-99999")).toBe(MIN_EVENTS_LIMIT);
  });

  it("returns the parsed integer for valid in-range values", () => {
    expect(parseEventsLimit("1")).toBe(1);
    expect(parseEventsLimit("50")).toBe(50);
    expect(parseEventsLimit("500")).toBe(500);
  });

  it("truncates decimals via parseInt (10.7 → 10, not 11)", () => {
    // Pin: parseInt's truncation behavior is load-bearing. Bug class:
    // someone replaces parseInt with Number(), which would round 10.7
    // to 10.7 (a float) and the DB query .limit(10.7) errors.
    expect(parseEventsLimit("10.7")).toBe(10);
    expect(parseEventsLimit("999.999")).toBe(999);
  });

  it("DEFAULT/MAX/MIN constants are pinned at expected values", () => {
    // Pin: changing any of these is a behavior change that should
    // require a deliberate test edit.
    expect(DEFAULT_EVENTS_LIMIT).toBe(200);
    expect(MAX_EVENTS_LIMIT).toBe(1000);
    expect(MIN_EVENTS_LIMIT).toBe(1);
  });
});

describe("computeNextSince — cursor advancement", () => {
  it("returns the last event_id when events array is non-empty", () => {
    const events = [{ event_id: "e1" }, { event_id: "e2" }, { event_id: "e3" }];
    expect(computeNextSince(events, "since_a")).toBe("e3");
  });

  it("returns the fallbackSince when events array is empty (cursor preservation)", () => {
    // Bug class: someone changes the empty-page fallback to `null`. The
    // daemon polling at ?since=cursor_42 with no new events would forget
    // its cursor on the next poll, re-reading the entire history.
    expect(computeNextSince([], "cursor_42")).toBe("cursor_42");
  });

  it("returns null when events is empty AND fallback is null", () => {
    // First-ever fetch with no events: cursor stays null. The daemon
    // will start fresh on its next poll.
    expect(computeNextSince([], null)).toBeNull();
  });

  it("handles a single-event page (last == first == that event)", () => {
    expect(computeNextSince([{ event_id: "only_one" }], "anything")).toBe("only_one");
  });

  it("does NOT crash on an empty events array (defensive against undefined)", () => {
    // Bug class: a refactor accesses events[events.length - 1] without
    // the length guard, returning undefined for empty input.
    expect(() => computeNextSince([], null)).not.toThrow();
    expect(() => computeNextSince([], "x")).not.toThrow();
  });
});
