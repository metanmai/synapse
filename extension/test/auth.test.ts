import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthUrl,
  exchangeCode,
  getCaptureToken,
  parseCallback,
  randomHex,
  sha256Hex,
  signIn,
} from "../src/auth.js";

afterEach(() => vi.unstubAllGlobals());

describe("sha256Hex", () => {
  it("matches the known SHA-256 of 'abc' (MUST equal the backend's hex digest for PKCE)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("randomHex", () => {
  it("returns 2 hex chars per byte and varies between calls", () => {
    const a = randomHex(16);
    const b = randomHex(16);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("buildAuthUrl", () => {
  it("targets /cli-auth with scope=capture + the redirect_uri + PKCE challenge/state", () => {
    const url = new URL(buildAuthUrl("https://ext.chromiumapp.org/", "chal", "st8"));
    expect(url.origin + url.pathname).toBe("https://synapsesync.app/cli-auth");
    expect(url.searchParams.get("scope")).toBe("capture");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ext.chromiumapp.org/");
    expect(url.searchParams.get("challenge")).toBe("chal");
    expect(url.searchParams.get("state")).toBe("st8");
  });
});

describe("parseCallback", () => {
  it("returns the code when state matches", () => {
    expect(parseCallback("https://ext.chromiumapp.org/?code=abc&state=st8", "st8")).toBe("abc");
  });
  it("returns null on a state mismatch (CSRF guard)", () => {
    expect(parseCallback("https://ext.chromiumapp.org/?code=abc&state=evil", "st8")).toBeNull();
  });
  it("returns null when the code is missing", () => {
    expect(parseCallback("https://ext.chromiumapp.org/?state=st8", "st8")).toBeNull();
  });
  it("returns null for a non-URL", () => {
    expect(parseCallback("not a url", "st8")).toBeNull();
  });
});

describe("exchangeCode", () => {
  it("POSTs {code, code_verifier} to /auth/cli-exchange and returns api_key + email", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
      const i = init as { body?: string };
      calls.push({ url: String(url), body: JSON.parse(i?.body ?? "{}") });
      return new Response(JSON.stringify({ api_key: "k-cap", email: "u@e.dev" }), { status: 200 });
    });
    const res = await exchangeCode("the-code", "the-verifier");
    expect(res).toEqual({ api_key: "k-cap", email: "u@e.dev" });
    expect(calls[0].url).toBe("https://api.synapsesync.app/auth/cli-exchange");
    expect(calls[0].body).toEqual({ code: "the-code", code_verifier: "the-verifier" });
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    await expect(exchangeCode("c", "v")).rejects.toThrow();
  });
});

describe("signIn (happy path)", () => {
  it("runs PKCE end-to-end (verifier hashes to the sent challenge) and stores the capture token", async () => {
    const store: Record<string, unknown> = {};
    let sentChallenge = "";
    let exchangeBody: { code?: string; code_verifier?: string } = {};

    vi.stubGlobal("chrome", {
      identity: {
        getRedirectURL: () => "https://ext.chromiumapp.org/",
        launchWebAuthFlow: async (d: { url: string }) => {
          const u = new URL(d.url);
          sentChallenge = u.searchParams.get("challenge") ?? "";
          // Echo the state back with a code — the success path.
          return `https://ext.chromiumapp.org/?code=auth-code&state=${u.searchParams.get("state")}`;
        },
      },
      storage: {
        local: {
          get: async (keys: string[]) => {
            const out: Record<string, unknown> = {};
            for (const k of keys) out[k] = store[k];
            return out;
          },
          set: async (obj: Record<string, unknown>) => {
            Object.assign(store, obj);
          },
        },
      },
    });
    vi.stubGlobal("fetch", async (_url: unknown, init?: unknown) => {
      exchangeBody = JSON.parse((init as { body?: string })?.body ?? "{}");
      return new Response(JSON.stringify({ api_key: "k-cap", email: "u@e.dev" }), { status: 200 });
    });

    const res = await signIn();

    expect(res.email).toBe("u@e.dev");
    expect(store.synapseCaptureToken).toBe("k-cap");
    expect(store.synapseEmail).toBe("u@e.dev");
    expect(await getCaptureToken()).toBe("k-cap");
    // PKCE integrity: the verifier we exchanged must hash to the challenge we sent.
    expect(await sha256Hex(exchangeBody.code_verifier ?? "")).toBe(sentChallenge);
  });

  it("throws when the user cancels (launchWebAuthFlow → undefined)", async () => {
    vi.stubGlobal("chrome", {
      identity: {
        getRedirectURL: () => "https://ext.chromiumapp.org/",
        launchWebAuthFlow: async () => undefined,
      },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    });
    await expect(signIn()).rejects.toThrow(/cancel/i);
  });

  it("throws on a state mismatch in the callback (no token stored)", async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      identity: {
        getRedirectURL: () => "https://ext.chromiumapp.org/",
        // Returns a DIFFERENT state than the one sent → CSRF reject.
        launchWebAuthFlow: async () => "https://ext.chromiumapp.org/?code=auth-code&state=tampered",
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async (obj: Record<string, unknown>) => {
            Object.assign(store, obj);
          },
        },
      },
    });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(signIn()).rejects.toThrow(/invalid callback/i);
    expect(store.synapseCaptureToken).toBeUndefined();
  });
});
