import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliAuthLogin, cliAuthSignup, cliExchangeCode, validateApiKey } from "../../src/cli/api.js";

// Mock globalThis.fetch
const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

// --- Helper to build Response-like objects ---
function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: () => jsonResponse(status, body, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function failingJsonResponse(status: number, statusText = "Internal Server Error"): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error("invalid json")),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: () => failingJsonResponse(status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve("not json"),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

// =============================================================================
// cliAuthSignup
// =============================================================================
describe("cliAuthSignup()", () => {
  it("returns ok with data on 200 response", async () => {
    const responseData = { email: "user@test.com", api_key: "key_123" };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, responseData));

    const result = await cliAuthSignup("user@test.com");
    expect(result).toEqual({ ok: true, data: responseData });
  });

  it("returns error message from response body on 400", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: "Email already exists" }, "Bad Request"));

    const result = await cliAuthSignup("dupe@test.com");
    expect(result).toEqual({ ok: false, message: "Email already exists" });
  });

  it("returns statusText when error response has invalid JSON", async () => {
    mockFetch.mockResolvedValueOnce(failingJsonResponse(500, "Internal Server Error"));

    const result = await cliAuthSignup("user@test.com");
    expect(result).toEqual({ ok: false, message: "Internal Server Error" });
  });

  it("returns statusText when error response body has no error field", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, {}, "Bad Request"));

    const result = await cliAuthSignup("user@test.com");
    expect(result).toEqual({ ok: false, message: "Bad Request" });
  });

  it("sends POST to correct URL with email in body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { email: "a@b.com", api_key: "k" }));

    await cliAuthSignup("a@b.com");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.synapsesync.app/auth/signup");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ email: "a@b.com" });
  });
});

// =============================================================================
// cliAuthLogin
// =============================================================================
describe("cliAuthLogin()", () => {
  it("returns ok with data on success", async () => {
    const responseData = { email: "user@test.com", api_key: "key_456", label: "my-laptop" };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, responseData));

    const result = await cliAuthLogin("user@test.com", "pass123", "my-laptop");
    expect(result).toEqual({ ok: true, data: responseData });
  });

  it("returns error message on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: "Invalid credentials" }, "Unauthorized"));

    const result = await cliAuthLogin("user@test.com", "wrong", "label");
    expect(result).toEqual({ ok: false, message: "Invalid credentials" });
  });

  it("returns statusText when error body has no error field", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(403, {}, "Forbidden"));

    const result = await cliAuthLogin("user@test.com", "pass", "label");
    expect(result).toEqual({ ok: false, message: "Forbidden" });
  });

  it("returns statusText when error body JSON parsing fails", async () => {
    mockFetch.mockResolvedValueOnce(failingJsonResponse(500, "Server Error"));

    const result = await cliAuthLogin("user@test.com", "pass", "label");
    expect(result).toEqual({ ok: false, message: "Server Error" });
  });

  it("sends email, password, and label in request body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { email: "a@b.com", api_key: "k", label: "dev" }));

    await cliAuthLogin("a@b.com", "secret", "dev");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.synapsesync.app/auth/login");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ email: "a@b.com", password: "secret", label: "dev" });
  });
});

// =============================================================================
// validateApiKey
// =============================================================================
describe("validateApiKey()", () => {
  it("returns valid when fetch returns 200", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

    const result = await validateApiKey("sk_valid_key");
    expect(result).toEqual({ status: "valid" });
  });

  it("returns expired when 401 with code UNAUTHORIZED", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { code: "UNAUTHORIZED" }, "Unauthorized"));

    const result = await validateApiKey("sk_expired");
    expect(result).toEqual({ status: "expired" });
  });

  it("returns expired when 401 with code AUTH_ERROR", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { code: "AUTH_ERROR" }, "Unauthorized"));

    const result = await validateApiKey("sk_expired2");
    expect(result).toEqual({ status: "expired" });
  });

  it("returns unknown when 401 with different code", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { code: "RATE_LIMITED" }, "Unauthorized"));

    const result = await validateApiKey("sk_ratelimited");
    expect(result).toEqual({ status: "unknown" });
  });

  it("returns unknown when 401 with no code in body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, {}, "Unauthorized"));

    const result = await validateApiKey("sk_nocode");
    expect(result).toEqual({ status: "unknown" });
  });

  it("returns unknown when 401 with unparseable JSON body", async () => {
    mockFetch.mockResolvedValueOnce(failingJsonResponse(401, "Unauthorized"));

    const result = await validateApiKey("sk_badjson");
    expect(result).toEqual({ status: "unknown" });
  });

  it("returns unknown when fetch returns 500", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, {}, "Internal Server Error"));

    const result = await validateApiKey("sk_servererr");
    expect(result).toEqual({ status: "unknown" });
  });

  it("returns unknown when fetch returns 403", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(403, {}, "Forbidden"));

    const result = await validateApiKey("sk_forbidden");
    expect(result).toEqual({ status: "unknown" });
  });

  it("returns unknown when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await validateApiKey("sk_neterr");
    expect(result).toEqual({ status: "unknown" });
  });

  it("sends Authorization header with Bearer token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

    await validateApiKey("sk_test_key_789");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.synapsesync.app/api/projects");
    expect(opts.headers.Authorization).toBe("Bearer sk_test_key_789");
  });

  it("uses AbortSignal.timeout(5000)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

    await validateApiKey("sk_key");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBeDefined();
    // AbortSignal.timeout returns an AbortSignal instance
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

// =============================================================================
// cliExchangeCode
// =============================================================================
describe("cliExchangeCode()", () => {
  it("returns ok with data on success", async () => {
    const responseData = { api_key: "key_abc", email: "user@test.com" };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, responseData));

    const result = await cliExchangeCode("authcode123", "verifier456");
    expect(result).toEqual({ ok: true, data: responseData });
  });

  it("returns error message on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: "Invalid code" }, "Bad Request"));

    const result = await cliExchangeCode("badcode", "verifier");
    expect(result).toEqual({ ok: false, message: "Invalid code" });
  });

  it("returns statusText when error body has no error field", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(400, {}, "Bad Request"));

    const result = await cliExchangeCode("code", "verifier");
    expect(result).toEqual({ ok: false, message: "Bad Request" });
  });

  it("returns statusText when error body JSON parsing fails", async () => {
    mockFetch.mockResolvedValueOnce(failingJsonResponse(500, "Internal Server Error"));

    const result = await cliExchangeCode("code", "verifier");
    expect(result).toEqual({ ok: false, message: "Internal Server Error" });
  });

  it("sends code and code_verifier in request body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { api_key: "k", email: "e@e.com" }));

    await cliExchangeCode("mycode", "myverifier");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.synapsesync.app/auth/cli-exchange");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ code: "mycode", code_verifier: "myverifier" });
  });
});
