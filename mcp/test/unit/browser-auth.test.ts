import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock cliExchangeCode to avoid real HTTP requests
vi.mock("../../src/cli/api.js", () => ({
  cliExchangeCode: vi.fn(),
}));

import { cliExchangeCode } from "../../src/cli/api.js";
import { browserAuth } from "../../src/cli/browser-auth.js";

const mockedExchange = vi.mocked(cliExchangeCode);

// Helper: extract port and state from the auth URL passed to onUrl callback
function parseAuthUrl(url: string): { port: number; state: string; challenge: string } {
  const parsed = new URL(url);
  return {
    port: Number(parsed.searchParams.get("port")),
    state: parsed.searchParams.get("state")!,
    challenge: parsed.searchParams.get("challenge")!,
  };
}

// Helper: make a request to the local auth server
async function fetchLocal(port: number, urlPath: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${urlPath}`);
}

// Helper: start browserAuth, wait for URL, and return both the promise and parsed URL info.
// Attaches a no-op .catch() to prevent unhandled rejection warnings for tests that
// expect the promise to reject.
async function startAuth(): Promise<{
  promise: Promise<unknown>;
  port: number;
  state: string;
  challenge: string;
  url: string;
  autoOpened: boolean;
}> {
  let authUrl = "";
  let autoOpened = false;
  const promise = browserAuth({
    onUrl: (url, opened) => {
      authUrl = url;
      autoOpened = opened;
    },
  });
  // Prevent unhandled rejection for tests that intentionally expect rejection
  promise.catch(() => {});
  await vi.waitFor(() => {
    if (!authUrl) throw new Error("waiting for url");
  });
  const parsed = parseAuthUrl(authUrl);
  return { promise, ...parsed, url: authUrl, autoOpened };
}

// Helper: complete the auth flow to clean up a running server
async function completeFlow(port: number, state: string): Promise<void> {
  await fetchLocal(port, `/callback?state=${state}&code=cleanup-code`);
}

describe("browser-auth", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    mockedExchange.mockReset();
    // Save and clear SSH/CI env vars
    for (const key of ["SSH_TTY", "SSH_CONNECTION", "SSH_CLIENT", "CI", "CODESPACES"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Default mock: successful exchange
    mockedExchange.mockResolvedValue({
      ok: true,
      data: { api_key: "sk-default", email: "default@test.com" },
    });
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    vi.useRealTimers();
  });

  // ─── Server lifecycle ──────────────────────────────────────────────

  describe("server lifecycle", () => {
    it("starts an HTTP server on 127.0.0.1 with a random port", async () => {
      const { promise, port, state } = await startAuth();
      expect(port).toBeGreaterThan(0);

      await completeFlow(port, state);
      await promise;
    });

    it("calls onUrl callback with the auth URL and autoOpened boolean", async () => {
      const { promise, port, state, url, autoOpened } = await startAuth();

      expect(url).toContain("https://synapsesync.app/cli-auth");
      expect(url).toContain("challenge=");
      expect(url).toContain("state=");
      expect(url).toContain("port=");
      expect(typeof autoOpened).toBe("boolean");

      await completeFlow(port, state);
      await promise;
    });

    it("rejects after 120s timeout", async () => {
      vi.useFakeTimers();

      const promise = browserAuth({
        onUrl: () => {},
      });
      // Prevent unhandled rejection warning
      promise.catch(() => {});

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(120_001);

      await expect(promise).rejects.toThrow("timed out");
    });
  });

  // ─── Callback handling ─────────────────────────────────────────────

  describe("callback handling", () => {
    it("non-callback paths return 204 (Chrome preconnect handling)", async () => {
      const { promise, port, state } = await startAuth();

      // Hitting root or favicon should return 204
      const rootRes = await fetchLocal(port, "/");
      expect(rootRes.status).toBe(204);

      const faviconRes = await fetchLocal(port, "/favicon.ico");
      expect(faviconRes.status).toBe(204);

      // Complete flow
      await completeFlow(port, state);
      await promise;
    });

    it("callback with wrong state returns 400, server stays running", async () => {
      const { promise, port, state } = await startAuth();

      // Wrong state
      const badRes = await fetchLocal(port, "/callback?state=wrong-state&code=some-code");
      expect(badRes.status).toBe(400);

      // Server should still be running -- correct callback should work
      await completeFlow(port, state);
      await promise;
    });

    it("callback without code returns 400", async () => {
      const { promise, port, state } = await startAuth();

      // Correct state but no code
      const noCodeRes = await fetchLocal(port, `/callback?state=${state}`);
      expect(noCodeRes.status).toBe(400);

      // Complete flow properly
      await completeFlow(port, state);
      await promise;
    });

    it("callback with correct state+code triggers code exchange and resolves", async () => {
      mockedExchange.mockResolvedValue({
        ok: true,
        data: { api_key: "sk-exchanged-key", email: "user@test.com" },
      });

      const { promise, port, state } = await startAuth();

      const res = await fetchLocal(port, `/callback?state=${state}&code=auth-code-123`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Login successful");

      const result = await promise;
      expect(result).toEqual({ api_key: "sk-exchanged-key", email: "user@test.com" });

      expect(mockedExchange).toHaveBeenCalledWith("auth-code-123", expect.any(String));
    });

    it("rejects when code exchange fails", async () => {
      mockedExchange.mockResolvedValue({
        ok: false as const,
        message: "Invalid code",
      });

      const { promise, port, state } = await startAuth();

      await fetchLocal(port, `/callback?state=${state}&code=bad-code`);

      await expect(promise).rejects.toThrow("Login failed: Invalid code");
    });

    it("rejects when code exchange throws", async () => {
      mockedExchange.mockRejectedValue(new Error("Network error"));

      const { promise, port, state } = await startAuth();

      await fetchLocal(port, `/callback?state=${state}&code=code`);

      await expect(promise).rejects.toThrow("Login failed: Network error");
    });
  });

  // ─── PKCE ──────────────────────────────────────────────────────────

  describe("PKCE", () => {
    it("generated verifier is 128 hex characters (64 bytes)", async () => {
      let capturedVerifier = "";
      mockedExchange.mockImplementation(async (_code: string, verifier: string) => {
        capturedVerifier = verifier;
        return { ok: true as const, data: { api_key: "sk-test", email: "t@t.com" } };
      });

      const { promise, port, state } = await startAuth();
      await fetchLocal(port, `/callback?state=${state}&code=test-code`);
      await promise;

      expect(capturedVerifier.length).toBe(128);
      expect(/^[0-9a-f]+$/.test(capturedVerifier)).toBe(true);
    });

    it("challenge is SHA-256 hex of verifier", async () => {
      const crypto = await import("node:crypto");
      let capturedVerifier = "";
      mockedExchange.mockImplementation(async (_code: string, verifier: string) => {
        capturedVerifier = verifier;
        return { ok: true as const, data: { api_key: "sk-test", email: "t@t.com" } };
      });

      const { promise, port, state, challenge } = await startAuth();
      await fetchLocal(port, `/callback?state=${state}&code=test-code`);
      await promise;

      const expectedChallenge = crypto.createHash("sha256").update(capturedVerifier).digest("hex");
      expect(challenge).toBe(expectedChallenge);
    });
  });

  // ─── SSH/CI detection ──────────────────────────────────────────────

  describe("SSH/CI detection", () => {
    it("when SSH_TTY is set, autoOpened is false", async () => {
      process.env.SSH_TTY = "/dev/pts/0";

      const { promise, port, state, autoOpened } = await startAuth();
      expect(autoOpened).toBe(false);

      await completeFlow(port, state);
      await promise;
    });

    it("when CI is set, autoOpened is false", async () => {
      process.env.CI = "true";

      const { promise, port, state, autoOpened } = await startAuth();
      expect(autoOpened).toBe(false);

      await completeFlow(port, state);
      await promise;
    });

    it("when SSH_CONNECTION is set, autoOpened is false", async () => {
      process.env.SSH_CONNECTION = "192.168.1.1 12345 192.168.1.2 22";

      const { promise, port, state, autoOpened } = await startAuth();
      expect(autoOpened).toBe(false);

      await completeFlow(port, state);
      await promise;
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("works without callbacks argument", async () => {
      vi.useFakeTimers();
      const promise = browserAuth();
      // Prevent unhandled rejection warning
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(120_001);
      await expect(promise).rejects.toThrow("timed out");
    });

    it("each call generates a unique state", async () => {
      const urls: string[] = [];

      const p1 = browserAuth({ onUrl: (url) => urls.push(url) });
      const p2 = browserAuth({ onUrl: (url) => urls.push(url) });
      // Prevent unhandled rejections in case of issues
      p1.catch(() => {});
      p2.catch(() => {});

      await vi.waitFor(() => {
        if (urls.length < 2) throw new Error("waiting");
      });

      const state1 = parseAuthUrl(urls[0]).state;
      const state2 = parseAuthUrl(urls[1]).state;
      expect(state1).not.toBe(state2);

      // Clean up both servers
      for (const url of urls) {
        const { port, state } = parseAuthUrl(url);
        await fetchLocal(port, `/callback?state=${state}&code=code`);
      }
      await Promise.all([p1, p2]);
    });
  });
});
