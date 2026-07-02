import { describe, expect, it } from "vitest";
import { CaptureRateTracker } from "../../src/capture/ingest/capture-rate.js";

describe("CaptureRateTracker", () => {
  it("flags a host with heartbeats but zero captures (the broken-adapter case)", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.heartbeat("claude.ai", 1000); // tab active, adapter emitted nothing
    t.heartbeat("claude.ai", 2000);
    expect(t.staleHosts(3000)).toContain("claude.ai");
  });

  it("does not flag a host that is capturing turns", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.heartbeat("claude.ai", 1000);
    t.capture("claude.ai", 1500); // a real turn landed
    expect(t.staleHosts(2000)).not.toContain("claude.ai");
  });

  it("does not flag a host with no activity at all (user just isn't using it)", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    expect(t.staleHosts(5000)).not.toContain("claude.ai");
  });

  it("forgets heartbeats older than the window (recovered host)", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.heartbeat("claude.ai", 1000);
    // far past the window — the old heartbeat should be pruned, nothing stale now
    expect(t.staleHosts(1_000_000)).not.toContain("claude.ai");
  });
});
