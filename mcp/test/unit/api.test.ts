import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "../../src/cli/api.js";

// Build a minimal Response-like object for the fetch mock.
function resp(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

const mockFetch = vi.fn();
beforeEach(() => {
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

// Regression guard for the "working key reported as expired" bug class.
// validateApiKey must classify ONLY a confirmed auth failure (401 + a known
// auth code) as "expired". Everything transient — 429 rate-limit, 5xx, a
// timeout/abort, or a 401 without an auth code — must be "unknown", so that
// resolveKey()/runStats() can proceed instead of telling the user their valid
// key is expired. (Root cause: /api/projects can take ~8s for large accounts;
// the old 5s timeout turned that into a false "expired".)
describe("validateApiKey — status classification", () => {
  it("200 OK → valid", async () => {
    mockFetch.mockResolvedValue(resp(200, []));
    expect((await validateApiKey("k")).status).toBe("valid");
  });

  it("401 + code UNAUTHORIZED → expired", async () => {
    mockFetch.mockResolvedValue(resp(401, { code: "UNAUTHORIZED" }));
    expect((await validateApiKey("k")).status).toBe("expired");
  });

  it("401 + code AUTH_ERROR → expired", async () => {
    mockFetch.mockResolvedValue(resp(401, { code: "AUTH_ERROR" }));
    expect((await validateApiKey("k")).status).toBe("expired");
  });

  it("401 WITHOUT a known auth code → unknown (not expired)", async () => {
    mockFetch.mockResolvedValue(resp(401, { code: "SOMETHING_ELSE" }));
    expect((await validateApiKey("k")).status).toBe("unknown");
  });

  it("429 rate-limit → unknown (NEVER expired)", async () => {
    mockFetch.mockResolvedValue(resp(429, { code: "RATE_LIMIT" }));
    expect((await validateApiKey("k")).status).toBe("unknown");
  });

  it("500 server error → unknown", async () => {
    mockFetch.mockResolvedValue(resp(500, {}));
    expect((await validateApiKey("k")).status).toBe("unknown");
  });

  it("network error / timeout (fetch rejects) → unknown", async () => {
    mockFetch.mockRejectedValue(new Error("The operation was aborted due to timeout"));
    expect((await validateApiKey("k")).status).toBe("unknown");
  });
});
