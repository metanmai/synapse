import { describe, expect, it, vi } from "vitest";
import { CaptureRateTracker } from "../../src/capture/ingest/capture-rate.js";
import { startIngestServer } from "../../src/capture/ingest/ingest-server.js";

async function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res.status;
}

describe("ingest server (loopback)", () => {
  it("routes /capture with a valid token to sync and records a capture", async () => {
    const sync = vi.fn().mockResolvedValue(true);
    const rateTracker = new CaptureRateTracker({ windowMs: 60_000 });
    const srv = await startIngestServer({
      port: 0,
      token: "secret",
      sync,
      rateTracker,
      log: () => {},
      now: () => 1000,
    });
    try {
      const status = await post(
        srv.port,
        "/capture",
        { host: "claude.ai", messages: [{ role: "user", content: "hello", ts: "2026-06-11T00:00:00Z" }] },
        { "x-synapse-ingest-token": "secret" },
      );
      expect(status).toBe(200);
      expect(sync).toHaveBeenCalledOnce();
      // a real turn landed → not stale
      expect(rateTracker.staleHosts(2_000)).not.toContain("claude.ai");
    } finally {
      await srv.close();
    }
  });

  it("rejects /capture with a bad token (401) and does not sync", async () => {
    const sync = vi.fn().mockResolvedValue(true);
    const rateTracker = new CaptureRateTracker({ windowMs: 60_000 });
    const srv = await startIngestServer({
      port: 0,
      token: "secret",
      sync,
      rateTracker,
      log: () => {},
      now: () => 1000,
    });
    try {
      const status = await post(
        srv.port,
        "/capture",
        { host: "claude.ai", messages: [{ role: "user", content: "hello" }] },
        { "x-synapse-ingest-token": "WRONG" },
      );
      expect(status).toBe(401);
      expect(sync).not.toHaveBeenCalled();
    } finally {
      await srv.close();
    }
  });

  it("records a /heartbeat (200) so a silent host becomes stale", async () => {
    const sync = vi.fn().mockResolvedValue(true);
    const rateTracker = new CaptureRateTracker({ windowMs: 60_000 });
    const srv = await startIngestServer({
      port: 0,
      token: "secret",
      sync,
      rateTracker,
      log: () => {},
      now: () => 1000,
    });
    try {
      const status = await post(srv.port, "/heartbeat", { host: "claude.ai" }, { "x-synapse-ingest-token": "secret" });
      expect(status).toBe(200);
      // heartbeat but no capture → stale (broken-adapter signal)
      expect(rateTracker.staleHosts(2_000)).toContain("claude.ai");
    } finally {
      await srv.close();
    }
  });

  it("routes /drift with a valid token and records a drift host on the tracker", async () => {
    const rateTracker = new CaptureRateTracker({ windowMs: 5 * 60 * 1000 });
    const srv = await startIngestServer({
      port: 0,
      token: "secret",
      sync: vi.fn().mockResolvedValue(true),
      rateTracker,
      log: () => {},
      now: () => 1000,
    });
    try {
      const status = await post(
        srv.port,
        "/drift",
        { host: "claude.ai", eventNames: ["unknown"], byteLength: 10, sampleHash: "ab" },
        { "x-synapse-ingest-token": "secret", origin: "chrome-extension://abc" },
      );
      expect(status).toBe(200);
      expect(rateTracker.driftHosts(1000)).toEqual(["claude.ai"]);
    } finally {
      await srv.close();
    }
  });

  it("404s an unknown path", async () => {
    const rateTracker = new CaptureRateTracker({ windowMs: 60_000 });
    const srv = await startIngestServer({
      port: 0,
      token: "secret",
      sync: vi.fn().mockResolvedValue(true),
      rateTracker,
      log: () => {},
    });
    try {
      expect(await post(srv.port, "/nope", {}, { "x-synapse-ingest-token": "secret" })).toBe(404);
    } finally {
      await srv.close();
    }
  });
});
