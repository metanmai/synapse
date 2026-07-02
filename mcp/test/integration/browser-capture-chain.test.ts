// mcp/test/integration/browser-capture-chain.test.ts
//
// FULL-CHAIN browser-capture e2e — the seam no other test crossed.
//
// extension/test/full-chain.test.ts stops at a fetch SPY (daemon mocked);
// mcp/test/unit/ingest-server.test.ts hand-builds bodies (extension mocked).
// This test wires the REAL extension capture path (adapter → hooked fetch →
// relay → service worker → buffer → flush → POST /capture) to a REAL
// startIngestServer on 127.0.0.1, and asserts the daemon's `sync` callback
// receives a correctly-normalized CapturedSession. The only things simulated
// are the browser host globals (window/location/chrome) and the SSE source —
// everything between the adapter and the daemon ingest is production code.
//
// Why here (mcp/test/integration): it runs in the `npm test` gate, the node
// env gives us the real loopback HTTP server, and mcp's tsconfig excludes
// test/ from typecheck so the cross-workspace import (extension src) is fine.
//
// Can't load a real unpacked extension on this corporate machine (Chrome
// blocks dev-mode); the real-browser-under-xvfb mechanics live in CI's
// scripts/e2e-browser-mechanics.mjs. This locks the DATA-PATH contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Real extension side (cross-workspace — not typechecked, vitest transpiles):
import { chatgptAdapter } from "../../../extension/src/content/adapters/chatgpt.js";
import { claudeAdapter } from "../../../extension/src/content/adapters/claude-ai.js";
import type { CaptureAdapter } from "../../../extension/src/content/adapters/types.js";
import { createDriftSentinel } from "../../../extension/src/content/drift-sentinel.js";
import { type PostFn, makeHookedFetch } from "../../../extension/src/content/main.js";
import { handleRelayMessage } from "../../../extension/src/content/relay.js";
import { installWorker } from "../../../extension/src/worker/index.js";
// Real daemon side:
import { CaptureRateTracker } from "../../src/capture/ingest/capture-rate.js";
import { type RunningIngestServer, startIngestServer } from "../../src/capture/ingest/ingest-server.js";
import type { CapturedSession } from "../../src/capture/types.js";

const TOKEN = "ingest-secret-token";
const CLAUDE_URL = "https://claude.ai/api/organizations/o/chat_conversations/c/completion";
const CHATGPT_URL = "https://chatgpt.com/backend-api/conversation";

// ── SSE builders (mirror each wire format the adapters claim to handle) ──
function sse(lines: string[]): string {
  return `${lines.join("\n\n")}\n`;
}
function claudeSSE(deltas: string[]): string {
  return sse([
    'data: {"type":"message_start"}',
    ...deltas.map(
      (text) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}`,
    ),
    'data: {"type":"message_stop"}',
  ]);
}
function chatgptSnapshotSSE(snapshots: string[]): string {
  return sse([
    ...snapshots.map(
      (t) => `data: ${JSON.stringify({ message: { author: { role: "assistant" }, content: { parts: [t] } } })}`,
    ),
    "data: [DONE]",
  ]);
}
function chatgptAddSSE(fullText: string): string {
  return sse([
    `data: ${JSON.stringify({ o: "add", v: { message: { author: { role: "assistant" }, content: { parts: [fullText] } } } })}`,
    "data: [DONE]",
  ]);
}
function chatgptPatchSSE(parts: string[]): string {
  return sse([
    ...parts.map(
      (v) => `data: ${JSON.stringify({ o: "patch", v: [{ p: "/message/content/parts/0", o: "append", v }] })}`,
    ),
    "data: [DONE]",
  ]);
}
function chatgptAppendSSE(parts: string[]): string {
  return sse([
    ...parts.map((v) => `data: ${JSON.stringify({ o: "append", p: "/message/content/parts/0", v })}`),
    "data: [DONE]",
  ]);
}

// ── In-memory chrome stub (config → real server port, session store, bus) ──
function installChromeStub(token: string, port: number): void {
  const session: Record<string, unknown> = {};
  const listeners: ((msg: unknown) => void)[] = [];
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: { addListener: (fn: (msg: unknown) => void) => listeners.push(fn) },
      sendMessage: (msg: unknown) => {
        for (const fn of listeners) fn(msg);
      },
    },
    storage: {
      local: { get: async () => ({ synapseToken: token, synapsePort: port }) },
      session: {
        get: async (key: string) => ({ [key]: session[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(session, obj);
        },
      },
    },
    action: { setBadgeText: () => {} },
  });
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for capture to reach the daemon");
    await new Promise((r) => setTimeout(r, 10));
  }
}

let srv: RunningIngestServer;
let sessions: CapturedSession[];
let rateTracker: CaptureRateTracker;

beforeEach(async () => {
  sessions = [];
  rateTracker = new CaptureRateTracker({ windowMs: 60_000 });
  srv = await startIngestServer({
    port: 0,
    token: TOKEN,
    sync: async (s) => {
      sessions.push(s);
      return true;
    },
    rateTracker,
    log: () => {},
  });
});

afterEach(async () => {
  await srv.close();
  vi.unstubAllGlobals();
});

/** Drive the real capture chain for one completion. token defaults to the valid one. */
async function driveCompletion(opts: {
  host: string;
  adapter: CaptureAdapter;
  url: string;
  sseBody: string;
  requestBody?: string;
  token?: string;
}): Promise<void> {
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { origin: `https://${opts.host}`, host: opts.host });
  installChromeStub(opts.token ?? TOKEN, srv.port);
  installWorker();

  const post: PostFn = (kind, payload = {}) =>
    handleRelayMessage({
      source: (globalThis as { window?: unknown }).window,
      origin: `https://${opts.host}`,
      data: { __synapse: true, kind, host: opts.host, ...payload },
    } as unknown as MessageEvent);

  const origFetch = (async () =>
    new Response(opts.sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })) as unknown as typeof fetch;

  await makeHookedFetch(origFetch, opts.adapter, post)(opts.url, { method: "POST", body: opts.requestBody });
}

/** All message contents across every session synced to the daemon. */
function allMessages(): { role: string; content: string }[] {
  return sessions.flatMap((s) => s.messages.map((m) => ({ role: m.role, content: m.content })));
}

describe("browser capture — full chain to the REAL daemon ingest", () => {
  it("claude.ai: SSE → hook → relay → worker → real /capture → CapturedSession", async () => {
    const deltas = ["Hel", "lo from ", "Claude"];
    await driveCompletion({ host: "claude.ai", adapter: claudeAdapter, url: CLAUDE_URL, sseBody: claudeSSE(deltas) });

    await waitFor(() => allMessages().some((m) => m.role === "assistant" && m.content === "Hello from Claude"));
    const session = sessions.find((s) => s.messages.some((m) => m.content === "Hello from Claude"));
    expect(session).toBeDefined();
    expect(session?.tool).toBe("claude-ai");
    expect(session?.projectPath).toBe("synapse://browser/claude.ai");
    expect(session?.id).toMatch(/^ses_/);
    // no drift / not stale: a real turn landed
    expect(rateTracker.staleHosts(Date.now())).not.toContain("claude.ai");
    expect(rateTracker.driftHosts(Date.now())).not.toContain("claude.ai");
  });

  it("captures BOTH turns: user (request body) + assistant (SSE)", async () => {
    await driveCompletion({
      host: "claude.ai",
      adapter: claudeAdapter,
      url: CLAUDE_URL,
      sseBody: claudeSSE(["hi there"]),
      requestBody: JSON.stringify({ prompt: "say hello" }),
    });
    await waitFor(() => {
      const m = allMessages();
      return m.some((x) => x.role === "user" && x.content === "say hello") && m.some((x) => x.role === "assistant");
    });
    const msgs = allMessages();
    expect(msgs).toContainEqual({ role: "user", content: "say hello" });
    expect(msgs).toContainEqual({ role: "assistant", content: "hi there" });
  });
});

describe("chatgpt.com — every SSE wire variant the adapter claims to support", () => {
  const EXPECTED = "Hello! How can I help you today?";
  const PARTS = ["Hello", "! How can", " I help you today?"];
  const variants: Array<{ name: string; sseBody: string }> = [
    { name: "snapshot (cumulative parts)", sseBody: chatgptSnapshotSSE(["Hello", "Hello! How can", EXPECTED]) },
    { name: "o:add", sseBody: chatgptAddSSE(EXPECTED) },
    { name: "o:patch append ops", sseBody: chatgptPatchSSE(PARTS) },
    { name: "legacy o:append", sseBody: chatgptAppendSSE(PARTS) },
  ];

  it.each(variants)("$name → assistant turn reaches the daemon intact", async ({ sseBody }) => {
    await driveCompletion({ host: "chatgpt.com", adapter: chatgptAdapter, url: CHATGPT_URL, sseBody });
    await waitFor(() => allMessages().some((m) => m.role === "assistant" && m.content === EXPECTED));
    const session = sessions.find((s) => s.messages.some((m) => m.content === EXPECTED));
    expect(session?.tool).toBe("chatgpt");
    expect(session?.projectPath).toBe("synapse://browser/chatgpt.com");
  });
});

describe("security seams enforced end-to-end (through the real server)", () => {
  it("a wrong ingest token → daemon 401 → NOTHING is synced", async () => {
    await driveCompletion({
      host: "claude.ai",
      adapter: claudeAdapter,
      url: CLAUDE_URL,
      sseBody: claudeSSE(["leaked?"]),
      token: "WRONG-TOKEN",
    });
    // Give the (doomed) POST time to round-trip and be rejected.
    await new Promise((r) => setTimeout(r, 200));
    expect(sessions).toHaveLength(0);
  });

  it("a web-page Origin is rejected (403) and never reaches sync", async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-synapse-ingest-token": TOKEN,
        origin: "https://claude.ai", // a real web origin, NOT an extension origin
      },
      body: JSON.stringify({ host: "claude.ai", messages: [{ role: "user", content: "from the page" }] }),
    });
    expect(res.status).toBe(403);
    expect(sessions).toHaveLength(0);
  });

  it("an extension Origin IS accepted (the real SW path)", async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-synapse-ingest-token": TOKEN,
        origin: "chrome-extension://abcdef",
      },
      body: JSON.stringify({ host: "claude.ai", messages: [{ role: "assistant", content: "ok" }] }),
    });
    expect(res.status).toBe(200);
    expect(allMessages()).toContainEqual({ role: "assistant", content: "ok" });
  });

  it("secret-looking values in captured content are scrubbed before sync", async () => {
    await driveCompletion({
      host: "claude.ai",
      adapter: claudeAdapter,
      url: CLAUDE_URL,
      sseBody: claudeSSE(["my key is sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ done"]),
    });
    await waitFor(() => allMessages().some((m) => m.role === "assistant"));
    const captured = allMessages().find((m) => m.role === "assistant")?.content ?? "";
    expect(captured).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ");
  });
});

describe("drift + stale detection reach the daemon's rate tracker", () => {
  it("a broken adapter (matches but never parses) fires a drift signal to /drift", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", { origin: "https://claude.ai", host: "claude.ai" });
    installChromeStub(TOKEN, srv.port);
    installWorker();
    const post: PostFn = (kind, payload = {}) =>
      handleRelayMessage({
        source: (globalThis as { window?: unknown }).window,
        origin: "https://claude.ai",
        data: { __synapse: true, kind, host: "claude.ai", ...payload },
      } as unknown as MessageEvent);

    const brokenAdapter: CaptureAdapter = {
      host: "claude.ai",
      matchesCompletion: () => true,
      parseRequest: () => null,
      parseResponse: () => null,
    };
    const origFetch = (async () =>
      new Response("event: unknown\ndata: {}\n\n", { status: 200 })) as unknown as typeof fetch;
    const hooked = makeHookedFetch(origFetch, brokenAdapter, post, createDriftSentinel({ threshold: 3 }));
    for (let i = 0; i < 3; i++) await hooked(CLAUDE_URL, { method: "POST" });

    await waitFor(() => rateTracker.driftHosts(Date.now()).includes("claude.ai"));
    expect(rateTracker.driftHosts(Date.now())).toContain("claude.ai");
  });

  it("a heartbeat with no capture marks the host stale; a capture clears it", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", { origin: "https://chatgpt.com", host: "chatgpt.com" });
    installChromeStub(TOKEN, srv.port);
    installWorker();
    const post: PostFn = (kind, payload = {}) =>
      handleRelayMessage({
        source: (globalThis as { window?: unknown }).window,
        origin: "https://chatgpt.com",
        data: { __synapse: true, kind, host: "chatgpt.com", ...payload },
      } as unknown as MessageEvent);

    post("heartbeat");
    await waitFor(() => rateTracker.staleHosts(Date.now()).includes("chatgpt.com"));
    expect(rateTracker.staleHosts(Date.now())).toContain("chatgpt.com");

    // Now a real capture for the same host clears the stale flag.
    await driveCompletion({
      host: "chatgpt.com",
      adapter: chatgptAdapter,
      url: CHATGPT_URL,
      sseBody: chatgptSnapshotSSE(["done"]),
    });
    await waitFor(() => !rateTracker.staleHosts(Date.now()).includes("chatgpt.com"));
    expect(rateTracker.staleHosts(Date.now())).not.toContain("chatgpt.com");
  });
});
