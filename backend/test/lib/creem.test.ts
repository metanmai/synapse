import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/lib/env";

// We need to stub globalThis.fetch before importing the module under test,
// because creemRequest calls the global fetch directly.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { creemRequest, verifyCreemWebhook } from "../../src/lib/creem";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    CREEM_API_KEY: "creem_test_abc123",
    CREEM_WEBHOOK_SECRET: "whsec_test",
    CREEM_PRO_PRODUCT_ID: "prod_test",
    ...overrides,
  } as unknown as Env;
}

describe("creemRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- getCreemUrl (tested indirectly) ---

  it("uses test API URL when key starts with creem_test_", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const env = makeEnv({ CREEM_API_KEY: "creem_test_mykey" });
    await creemRequest(env, "GET", "/products");

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^https:\/\/test-api\.creem\.io\/v1/);
  });

  it("uses production API URL when key does not start with creem_test_", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const env = makeEnv({ CREEM_API_KEY: "creem_live_mykey" });
    await creemRequest(env, "GET", "/products");

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/^https:\/\/api\.creem\.io\/v1/);
  });

  // --- Configuration guard ---

  it('throws "Billing is not configured" when CREEM_API_KEY is empty', async () => {
    const env = makeEnv({ CREEM_API_KEY: "" });
    await expect(creemRequest(env, "GET", "/products")).rejects.toThrow("Billing is not configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws "Billing is not configured" when CREEM_API_KEY is undefined', async () => {
    const env = makeEnv({ CREEM_API_KEY: undefined as unknown as string });
    await expect(creemRequest(env, "GET", "/products")).rejects.toThrow("Billing is not configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // --- Headers ---

  it("sends correct headers (x-api-key and Content-Type)", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const env = makeEnv({ CREEM_API_KEY: "creem_test_headercheck" });
    await creemRequest(env, "GET", "/products");

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("creem_test_headercheck");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  // --- Body handling ---

  it("sends body as JSON for POST requests", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: "chk_1" }), { status: 200 }));

    const env = makeEnv();
    const body = { product_id: "prod_123", customer: { email: "a@b.com" } };
    await creemRequest(env, "POST", "/checkouts", body);

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify(body));
  });

  it("does not send body for GET requests", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const env = makeEnv();
    await creemRequest(env, "GET", "/products");

    const callArgs = mockFetch.mock.calls[0];
    const options = callArgs[1] as RequestInit;
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
  });

  // --- Success ---

  it("returns parsed JSON on success (200)", async () => {
    const data = { id: "sub_123", status: "active" };
    mockFetch.mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));

    const env = makeEnv();
    const result = await creemRequest(env, "GET", "/subscriptions");

    expect(result).toEqual(data);
  });

  // --- Error handling ---

  it("throws with Creem message field on 403", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403, statusText: "Forbidden" }),
    );

    const env = makeEnv();
    await expect(creemRequest(env, "GET", "/products")).rejects.toThrow("Forbidden");
  });

  it("throws with Creem error field on 400", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid product" }), { status: 400, statusText: "Bad Request" }),
    );

    const env = makeEnv();
    await expect(creemRequest(env, "GET", "/products")).rejects.toThrow("Invalid product");
  });

  it("throws with status code when response is not JSON", async () => {
    mockFetch.mockResolvedValue(new Response("Internal Server Error", { status: 500, statusText: "Server Error" }));

    const env = makeEnv();
    await expect(creemRequest(env, "GET", "/products")).rejects.toThrow("Creem API error: 500");
  });

  it("throws with status code when JSON has no message or error fields", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "UNKNOWN" }), { status: 422, statusText: "Unprocessable" }),
    );

    const env = makeEnv();
    await expect(creemRequest(env, "GET", "/products")).rejects.toThrow("Creem API error: 422");
  });
});

describe("verifyCreemWebhook", () => {
  const secret = "whsec_test_secret_123";

  // Helper: produce valid HMAC-SHA256 hex signature
  async function computeHmac(body: string, key: string): Promise<string> {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(body));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  it("returns true for valid HMAC-SHA256 signature", async () => {
    const body = '{"event_type":"checkout.completed","object":{}}';
    const signature = await computeHmac(body, secret);

    const result = await verifyCreemWebhook(body, signature, secret);
    expect(result).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const body = '{"event_type":"checkout.completed","object":{}}';
    const invalidSig = "deadbeef".repeat(8); // 64 hex chars but wrong

    const result = await verifyCreemWebhook(body, invalidSig, secret);
    expect(result).toBe(false);
  });

  it("returns false for empty signature", async () => {
    const body = '{"event_type":"checkout.completed","object":{}}';

    const result = await verifyCreemWebhook(body, "", secret);
    expect(result).toBe(false);
  });
});
