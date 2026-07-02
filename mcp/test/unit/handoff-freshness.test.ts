import { describe, expect, it } from "vitest";
import { FRESH_HANDOFF_WINDOW_MS, isHandoffFresh } from "../../src/capture/pull-compact.js";

/**
 * Bug class under test: "pull-handoff considers the most-recently-compacted
 * conversation stale and re-compacts it on every cycle, bumping updated_at
 * each time and starving multi-device bidirectional write-back of its own
 * conversation being newest."
 *
 * Root cause: the backend's POST /compact handler writes `metadata.handoff_at`
 * via one query, then `updated_at` via a SECOND query milliseconds later
 * (see updateCompaction + updateConversation in backend/db/queries/
 * conversations.ts). The strict comparison `handoff_at >= updated_at`
 * never holds — by microseconds.
 *
 * The fix: a small freshness window. If `updated_at - handoff_at` is below
 * the window, the LAST update WAS the compact itself; no real activity
 * happened since; cache is fresh.
 *
 * These tests pin the window boundary so future "tighten this check"
 * refactors don't silently regress the multi-device race. Pure-function
 * tests — no fakes, no clock manipulation.
 */
describe("isHandoffFresh — pull-handoff cache-freshness check", () => {
  const T0 = new Date("2026-05-29T12:00:00.000Z");
  const isoAt = (offsetMs: number) => new Date(T0.getTime() + offsetMs).toISOString();

  it("returns false when handoff_at is missing", () => {
    // Cache miss path: a conversation that's never been compacted.
    expect(isHandoffFresh(null, isoAt(0))).toBe(false);
  });

  it("returns true when handoff_at exactly equals updated_at (strict path)", () => {
    expect(isHandoffFresh(isoAt(0), isoAt(0))).toBe(true);
  });

  it("returns true when handoff_at is AFTER updated_at (strict path)", () => {
    // Defensive: should never happen in practice, but the strict semantics
    // already handle it.
    expect(isHandoffFresh(isoAt(1000), isoAt(500))).toBe(true);
  });

  it("returns true within the fresh-handoff window (the multi-device race fix)", () => {
    // THE ACTUAL BUG CLASS: handoff_at is 1ms older than updated_at because
    // updateCompaction → updateConversation race in the backend. Without
    // this branch, multi-device write-back fails on every run.
    expect(isHandoffFresh(isoAt(0), isoAt(1))).toBe(true);
    expect(isHandoffFresh(isoAt(0), isoAt(100))).toBe(true);
    expect(isHandoffFresh(isoAt(0), isoAt(2000))).toBe(true);
  });

  it("returns true just inside the window edge", () => {
    // diff = windowMs - 1: still fresh.
    expect(isHandoffFresh(isoAt(0), isoAt(FRESH_HANDOFF_WINDOW_MS - 1))).toBe(true);
  });

  it("returns false at the exact window boundary (< semantics)", () => {
    // diff = windowMs: NOT fresh. Pins the < vs <= boundary so future
    // refactors don't silently shift the throttle.
    expect(isHandoffFresh(isoAt(0), isoAt(FRESH_HANDOFF_WINDOW_MS))).toBe(false);
  });

  it("returns false when real new messages bumped updated_at far past handoff_at", () => {
    // 30 seconds since handoff — clearly real activity has occurred.
    expect(isHandoffFresh(isoAt(0), isoAt(30_000))).toBe(false);
    // 5 minutes — definitely stale.
    expect(isHandoffFresh(isoAt(0), isoAt(5 * 60_000))).toBe(false);
  });

  it("returns false for unparseable timestamps (no crash, no false positive)", () => {
    // Defensive: malformed ISO strings shouldn't crash pull-handoff or
    // accidentally mark stale handoffs fresh.
    expect(isHandoffFresh("not-a-date", isoAt(0))).toBe(false);
    expect(isHandoffFresh(isoAt(0), "not-a-date")).toBe(false);
  });

  it("honors the custom windowMs argument", () => {
    // Edge case: a test or specialized caller passes a tighter window.
    expect(isHandoffFresh(isoAt(0), isoAt(500), 100)).toBe(false);
    expect(isHandoffFresh(isoAt(0), isoAt(50), 100)).toBe(true);
  });

  it("FRESH_HANDOFF_WINDOW_MS is 5 seconds (multi-device race contract)", () => {
    // Lock in the constant. If someone halves this, the multi-device E2E
    // could go red again under slow-network conditions where CF
    // replication tail exceeds the new window. If someone bumps it past
    // a few seconds, real new-message activity could be mis-classified as
    // "fresh enough" and the handoff would silently stop refreshing.
    expect(FRESH_HANDOFF_WINDOW_MS).toBe(5_000);
  });
});
