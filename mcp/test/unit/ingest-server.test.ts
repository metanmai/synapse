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

describe("ingest server CORS preflight (extension capture)", () => {
  const start = () =>
    startIngestServer({
      port: 0,
      token: "secret",
      sync: vi.fn().mockResolvedValue(true),
      rateTracker: new CaptureRateTracker({ windowMs: 60_000 }),
      log: () => {},
    });

  it("answers the OPTIONS preflight for a chrome-extension origin with CORS + private-network headers", async () => {
    const srv = await start();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/capture`, {
        method: "OPTIONS",
        headers: {
          origin: "chrome-extension://abc",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,x-synapse-ingest-token",
          "access-control-request-private-network": "true",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
      expect(res.headers.get("access-control-allow-methods")).toContain("POST");
      expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("x-synapse-ingest-token");
      expect(res.headers.get("access-control-allow-private-network")).toBe("true");
    } finally {
      await srv.close();
    }
  });

  it("does not grant CORS to a non-extension origin", async () => {
    const srv = await start();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/capture`, {
        method: "OPTIONS",
        headers: { origin: "https://evil.com" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await srv.close();
    }
  });

  it("echoes Allow-Origin on the actual capture POST so the extension can read the response", async () => {
    const srv = await start();
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/capture`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-synapse-ingest-token": "secret",
          origin: "chrome-extension://abc",
        },
        body: JSON.stringify({ host: "claude.ai", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc");
    } finally {
      await srv.close();
    }
  });
});
