// Slice C: the service worker prefers a DIRECT backend POST (capture-scoped Bearer
// token) and falls back to the local daemon. Drives a "turn" message through the real
// installWorker listener (→ handleTurn → flush) and inspects the resulting POSTs.

import { afterEach, describe, expect, it, vi } from "vitest";
import { installWorker } from "../src/worker/index.js";

interface Posted {
  url: string;
  authorization?: string;
  ingestToken?: string;
  body: { host: string; messages: { role: string; content: string }[] };
}

/** Spy that records capture POSTs. `backendOk:false` makes the backend return 502. */
function installFetchSpy(opts: { backendOk?: boolean } = {}): Posted[] {
  const seen: Posted[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
    const u = String(url);
    const i = init as { headers?: Record<string, string>; body?: string };
    if (typeof i?.body === "string" && u.includes("/capture")) {
      seen.push({
        url: u,
        authorization: i.headers?.authorization,
        ingestToken: i.headers?.["x-synapse-ingest-token"],
        body: JSON.parse(i.body),
      });
    }
    const isBackend = u.includes("/api/capture/browser");
    const ok = isBackend ? opts.backendOk !== false : true;
    return new Response("{}", { status: ok ? 200 : 502 });
  });
  return seen;
}

function installChromeStub(local: Record<string, unknown>): ((msg: unknown) => void)[] {
  const listeners: ((msg: unknown) => void)[] = [];
  const session: Record<string, unknown> = {};
  vi.stubGlobal("chrome", {
    runtime: { onMessage: { addListener: (fn: (msg: unknown) => void) => listeners.push(fn) } },
    storage: {
      local: { get: async () => ({ ...local }) },
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(session, obj);
        },
      },
    },
    action: { setBadgeText: () => {} },
  });
  return listeners;
}

function turn(content: string, host = "claude.ai"): unknown {
  return { __synapse: true, kind: "turn", host, role: "user", content };
}

afterEach(() => vi.unstubAllGlobals());

describe("worker — direct-to-backend with daemon fallback (Slice C)", () => {
  it("POSTs to the backend with a Bearer capture token when one is configured", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub({ synapseCaptureToken: "cap-tok" });
    installWorker();
    listeners[0](turn("hello world"));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0].url).toBe("https://api.synapsesync.app/api/capture/browser");
    expect(seen[0].authorization).toBe("Bearer cap-tok");
    expect(seen[0].body.host).toBe("claude.ai");
    expect(seen[0].body.messages[0].content).toBe("hello world");
  });

  it("scrubs secrets CLIENT-SIDE before the backend POST", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub({ synapseCaptureToken: "cap-tok" });
    installWorker();
    listeners[0](turn("my key is sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG ok"));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const content = seen[0].body.messages[0].content;
    expect(content).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG");
    expect(content).toContain("[REDACTED]");
  });

  it("falls back to the daemon when the backend POST fails", async () => {
    const seen = installFetchSpy({ backendOk: false });
    const listeners = installChromeStub({
      synapseCaptureToken: "cap-tok",
      synapseToken: "daemon-tok",
      synapsePort: 7726,
    });
    installWorker();
    listeners[0](turn("hello"));
    // Backend (502) then daemon (200) — two POSTs for the one turn.
    await vi.waitFor(() => expect(seen.length).toBe(2));
    expect(seen[0].url).toContain("/api/capture/browser");
    expect(seen[1].url).toContain("127.0.0.1:7726/capture");
    expect(seen[1].ingestToken).toBe("daemon-tok");
  });

  it("uses ONLY the daemon when no capture token is set (back-compat)", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub({ synapseToken: "daemon-tok", synapsePort: 7726 });
    installWorker();
    listeners[0](turn("hello"));
    await vi.waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0].url).toContain("127.0.0.1:7726/capture");
    expect(seen[0].authorization).toBeUndefined();
  });

  it("opts out (no POST) when neither token is configured", async () => {
    const seen = installFetchSpy();
    const listeners = installChromeStub({});
    installWorker();
    listeners[0](turn("hello"));
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.length).toBe(0);
  });
});
