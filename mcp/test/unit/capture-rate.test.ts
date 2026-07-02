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

describe("drift signal", () => {
  it("driftHosts returns hosts with a drift event in the window", () => {
    const t = new CaptureRateTracker({ windowMs: 1000 });
    t.drift("claude.ai", 1000);
    expect(t.driftHosts(1500)).toEqual(["claude.ai"]);
  });

  it("prunes drift events outside the window", () => {
    const t = new CaptureRateTracker({ windowMs: 1000 });
    t.drift("claude.ai", 1000);
    expect(t.driftHosts(2500)).toEqual([]); // 1500ms later, outside the 1000ms window
  });

  it("does not conflate drift with the zero-capture (stale) signal", () => {
    const t = new CaptureRateTracker({ windowMs: 60_000 });
    t.drift("claude.ai", 1000);
    // a drift event is neither a heartbeat nor a capture → it alone is not 'stale'
    expect(t.staleHosts(2000)).not.toContain("claude.ai");
    expect(t.driftHosts(2000)).toEqual(["claude.ai"]);
  });
});
