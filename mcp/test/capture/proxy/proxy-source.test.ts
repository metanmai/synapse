// mcp/test/capture/proxy/proxy-source.test.ts
//
// Bug class: "the ProxySource (a) buffers captures but never emits
// sessions, (b) loses captures on stop, (c) emits one session per
// capture instead of grouping retries, (d) crashes when the
// reconstruction step throws, OR (e) returns the wrong cert path or
// fails to start cleanly."
//
// Tests drive the buffer/flush state machine directly via `ingest()`
// rather than spinning up real TLS clients — Layer 3b's connect-
// integration tests already prove the wire path. These tests focus
// on the ProxySource-specific concerns: buffering, debounce, flush
// timing, error containment.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProxySource } from "../../../src/capture/proxy/proxy-source.js";
import type { CapturedRequest } from "../../../src/capture/proxy/types.js";
import type { CapturedSession } from "../../../src/capture/types.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-proxy-source-"));
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* */
  }
});

/**
 * Build a synthetic anthropic /v1/messages capture with the given
 * user prompt + assistant reply. Two captures with the same `prompt`
 * are recognized as the same session by reconstructSessions.
 */
function mkAnthropicCapture(prompt: string, reply: string, timestamp: string): CapturedRequest {
  return {
    timestamp,
    endpoint: { provider: "anthropic", kind: "messages", capture: true },
    statusCode: 200,
    requestBody: {
      messages: [{ role: "user", content: prompt }],
    },
    responseBody: {
      role: "assistant",
      content: [{ type: "text", text: reply }],
    },
  };
}

function collectSessions(src: ProxySource): CapturedSession[] {
  const out: CapturedSession[] = [];
  src.on("session", (s: CapturedSession) => out.push(s));
  return out;
}

/** Wait until `cond()` returns true OR `timeoutMs` elapses. */
async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("ProxySource", () => {
  describe("lifecycle", () => {
    it("start() returns the bound port + the CA cert path; stop() shuts cleanly", async () => {
      const src = new ProxySource({
        port: 0,
        tlsManagerOptions: { caDir: tmpRoot },
      });
      const { port, caCertPath } = await src.start();
      expect(port).toBeGreaterThan(0);
      expect(caCertPath).toBe(path.join(tmpRoot, "ca.pem"));
      await src.stop();
    });

    it("start() twice throws — surfaces misuse rather than leaking a port", async () => {
      const src = new ProxySource({ port: 0, tlsManagerOptions: { caDir: tmpRoot } });
      await src.start();
      try {
        await expect(src.start()).rejects.toThrow(/already started/);
      } finally {
        await src.stop();
      }
    });

    it("stop() before start() is a no-op (idempotent shutdown)", async () => {
      const src = new ProxySource({ port: 0, tlsManagerOptions: { caDir: tmpRoot } });
      await expect(src.stop()).resolves.toBeUndefined();
    });
  });

  describe("buffering + flush", () => {
    it("a single capture flushes to exactly 1 session after idleMs elapses", async () => {
      const src = new ProxySource({ idleMs: 80, tlsManagerOptions: { caDir: tmpRoot } });
      const sessions = collectSessions(src);

      src.ingest(mkAnthropicCapture("hello", "world", "2026-05-30T00:00:00.000Z"));
      expect(sessions).toHaveLength(0); // not yet — buffer still hot
      expect(src.bufferedCount()).toBe(1);

      await waitFor(() => sessions.length > 0);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(src.bufferedCount()).toBe(0);
    });

    it("3 captures with the same first message (retry burst) collapse to 1 session", async () => {
      const src = new ProxySource({ idleMs: 80, tlsManagerOptions: { caDir: tmpRoot } });
      const sessions = collectSessions(src);

      // claude's 3× /v1/messages retry pattern — identical messages[0],
      // a few hundred ms apart.
      src.ingest(mkAnthropicCapture("ping", "p1", "2026-05-30T00:00:00.000Z"));
      src.ingest(mkAnthropicCapture("ping", "p2", "2026-05-30T00:00:00.200Z"));
      src.ingest(mkAnthropicCapture("ping", "p3", "2026-05-30T00:00:00.500Z"));

      await waitFor(() => sessions.length > 0);
      expect(sessions).toHaveLength(1);
      // The LAST capture is authoritative — its assistant reply ("p3") should appear.
      const assistantTurn = sessions[0].messages.find((m) => m.role === "assistant");
      expect(assistantTurn?.content).toBe("p3");
    });

    it("2 captures with different first messages produce 2 sessions", async () => {
      const src = new ProxySource({ idleMs: 80, tlsManagerOptions: { caDir: tmpRoot } });
      const sessions = collectSessions(src);

      src.ingest(mkAnthropicCapture("hello-A", "reply-A", "2026-05-30T00:00:00.000Z"));
      src.ingest(mkAnthropicCapture("hello-B", "reply-B", "2026-05-30T00:00:00.100Z"));

      await waitFor(() => sessions.length >= 2);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].messages[0].content).toBe("hello-A");
      expect(sessions[1].messages[0].content).toBe("hello-B");
      // Distinct session ids — no cross-conversation conflation.
      expect(sessions[0].id).not.toBe(sessions[1].id);
    });

    it("idle timer DEBOUNCES — each capture resets the timer, only quiet triggers flush", async () => {
      // If a 4th capture arrives while the timer is running, it must
      // RESET the timer; the flush should happen `idleMs` after the
      // LAST capture, not the first one. Otherwise rapid bursts get
      // split into multiple flushes.
      const src = new ProxySource({ idleMs: 100, tlsManagerOptions: { caDir: tmpRoot } });
      const sessions = collectSessions(src);

      src.ingest(mkAnthropicCapture("x", "1", "2026-05-30T00:00:00.000Z"));
      await new Promise((r) => setTimeout(r, 60)); // still inside the idle window
      expect(sessions).toHaveLength(0);

      // Second capture extends the window — flush must NOT have fired yet.
      src.ingest(mkAnthropicCapture("x", "2", "2026-05-30T00:00:00.080Z"));
      await new Promise((r) => setTimeout(r, 60)); // 60ms after 2nd → still inside window
      expect(sessions).toHaveLength(0);

      // Wait past idleMs from the second capture.
      await waitFor(() => sessions.length > 0);
      expect(sessions).toHaveLength(1);
    });

    it("empty buffer flush is a no-op — idle timer doesn't fire on empty state", async () => {
      const src = new ProxySource({ idleMs: 30, tlsManagerOptions: { caDir: tmpRoot } });
      const sessions = collectSessions(src);

      // Wait well past idleMs without any captures.
      await new Promise((r) => setTimeout(r, 150));
      expect(sessions).toHaveLength(0);

      // flushNow() on empty buffer is also a no-op.
      src.flushNow();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("stop() flushes pending buffer", () => {
    it("captures buffered at stop time emit as sessions during shutdown — none lost", async () => {
      // Bug class: a daemon shutting down mid-conversation must NOT
      // silently drop the in-flight session. Buffer flush is part of
      // graceful stop().
      const src = new ProxySource({
        port: 0,
        idleMs: 60_000, // long — would NOT fire during the test
        tlsManagerOptions: { caDir: tmpRoot },
      });
      const sessions = collectSessions(src);
      await src.start();

      src.ingest(mkAnthropicCapture("about to shut down", "ok", "2026-05-30T00:00:00.000Z"));
      expect(sessions).toHaveLength(0);
      expect(src.bufferedCount()).toBe(1);

      await src.stop();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages[0].content).toBe("about to shut down");
    });
  });

  describe("flushNow()", () => {
    it("flushes immediately without waiting for idle window", async () => {
      const src = new ProxySource({ idleMs: 60_000, tlsManagerOptions: { caDir: tmpRoot } });
      const sessions = collectSessions(src);

      src.ingest(mkAnthropicCapture("urgent", "now", "2026-05-30T00:00:00.000Z"));
      expect(sessions).toHaveLength(0);

      src.flushNow();
      expect(sessions).toHaveLength(1);
    });
  });
});
