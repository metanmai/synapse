import { afterEach, describe, expect, it, vi } from "vitest";
import { installWorker } from "../src/worker/index.js";

interface PostedDrift {
  url: string;
  token: string | undefined;
  body: { host: string; eventNames: string[]; byteLength: number; sampleHash: string };
}

function installFetchSpy(): PostedDrift[] {
  const seen: PostedDrift[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
    const i = init as { headers?: Record<string, string>; body?: string };
    if (String(url).includes("/drift") && typeof i?.body === "string") {
      seen.push({ url: String(url), token: i.headers?.["x-synapse-ingest-token"], body: JSON.parse(i.body) });
    }
    return new Response("{}", { status: 200 });
  });
  return seen;
}

function installChromeStub(): ((msg: unknown) => void)[] {
  const listeners: ((msg: unknown) => void)[] = [];
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (fn: (msg: unknown) => void) => listeners.push(fn) } },
    storage: {
      local: { get: async () => ({ synapseToken: "tok", synapsePort: 7726 }) },
      session: { get: async () => ({}), set: async () => {} },
    },
    action: { setBadgeText: () => {} },
  });
  return listeners;
}

afterEach(() => vi.unstubAllGlobals());

describe("worker drift forwarding", () => {
  it("POSTs /drift with host + shape + token when it receives a drift message", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub();
    installWorker();
    listeners[0]({
      __synapse: true,
      kind: "drift",
      host: "claude.ai",
      eventNames: ["unknown"],
      byteLength: 42,
      sampleHash: "deadbeef",
    });
    await vi.waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0].url).toContain("127.0.0.1:7726/drift");
    expect(seen[0].token).toBe("tok");
    expect(seen[0].body).toEqual({
      host: "claude.ai",
      eventNames: ["unknown"],
      byteLength: 42,
      sampleHash: "deadbeef",
    });
  });

  it("ignores a drift message with no host", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub();
    installWorker();
    listeners[0]({ __synapse: true, kind: "drift", eventNames: ["x"] });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.length).toBe(0);
  });
});
