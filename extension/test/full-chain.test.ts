// No-browser full-chain test: exercises the REAL extension glue end to end —
// fake SSE Response → makeHookedFetch (adapter parse) → handleRelayMessage (the
// ISOLATED relay) → installWorker's listener → CaptureBuffer → postCapture. The
// worker's POST to the daemon ingest is intercepted by a global fetch spy (the
// worker uses global fetch; makeHookedFetch uses its own injected origFetch).
// Runs in the default node env with stubbed globals — no jsdom, no mcp import.
// The daemon-side ingest + redaction is covered by mcp/test/unit/ingest-server.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { chatgptAdapter } from "../src/content/adapters/chatgpt.js";
import { claudeAdapter } from "../src/content/adapters/claude-ai.js";
import type { CaptureAdapter } from "../src/content/adapters/types.js";
import { createDriftSentinel } from "../src/content/drift-sentinel.js";
import { type PostFn, makeHookedFetch } from "../src/content/main.js";
import { handleRelayMessage } from "../src/content/relay.js";
import { installWorker } from "../src/worker/index.js";
import chatgptFixture from "./adapters/fixtures/chatgpt-conversation.json";
import claudeFixture from "./adapters/fixtures/claude-completion.json";

// --- SSE builders (mirror the adapter golden tests) ---
function buildClaudeSSE(deltas: string[]): string {
  const events = deltas.map(
    (text) =>
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })}`,
  );
  return `${['event: message_start\ndata: {"type":"message_start"}', ...events, 'event: message_stop\ndata: {"type":"message_stop"}'].join("\n\n")}\n`;
}
function buildChatgptSSE(snapshots: string[]): string {
  const events = snapshots.map(
    (text) =>
      `data: ${JSON.stringify({
        message: { author: { role: "assistant" }, content: { content_type: "text", parts: [text] } },
      })}`,
  );
  return `${[...events, "data: [DONE]"].join("\n\n")}\n`;
}

interface CapturedPost {
  token: string | undefined;
  body: { host: string; messages: { role: string; content: string }[] };
}

// Replace global fetch with a spy that records the worker's POST /capture calls.
function installFetchSpy(): CapturedPost[] {
  const captured: CapturedPost[] = [];
  const spy = async (url: unknown, init?: unknown): Promise<Response> => {
    const u = String(url);
    const i = init as { headers?: Record<string, string>; body?: string } | undefined;
    if (u.includes("/capture") && typeof i?.body === "string") {
      captured.push({ token: i.headers?.["x-synapse-ingest-token"], body: JSON.parse(i.body) });
    }
    return new Response("{}", { status: 200 });
  };
  vi.stubGlobal("fetch", spy);
  return captured;
}

// In-memory chrome stub: config in storage.local, an in-memory session store, and
// a runtime message bus that dispatches sendMessage to registered listeners.
function installChromeStub(token: string): void {
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
      local: { get: async () => ({ synapseToken: token, synapsePort: 7726 }) },
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
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function runChain(opts: {
  host: string;
  adapter: CaptureAdapter;
  sseBody: string;
  completionUrl: string;
  expected: string;
}): Promise<void> {
  vi.stubGlobal("window", {});
  vi.stubGlobal("location", { origin: `https://${opts.host}`, host: opts.host });
  installChromeStub("test-token");
  const captured = installFetchSpy();
  installWorker();

  // post() wires the hook → relay → worker. We call handleRelayMessage directly
  // (rather than a literal window.postMessage event) to keep it deterministic.
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

  // No request body → only the assistant turn flows (single turn = no buffer race).
  await makeHookedFetch(origFetch, opts.adapter, post)(opts.completionUrl, { method: "POST" });

  await waitFor(() => captured.some((r) => r.body.messages.some((m) => m.content === opts.expected)));
  const hit = captured.find((r) => r.body.messages.some((m) => m.content === opts.expected));
  expect(hit?.token).toBe("test-token");
  expect(hit?.body.host).toBe(opts.host);
}

describe("browser capture — full chain to the daemon ingest (no real browser)", () => {
  it("claude.ai: SSE → hook → relay → worker → POST /capture", async () => {
    await runChain({
      host: "claude.ai",
      adapter: claudeAdapter,
      sseBody: buildClaudeSSE(claudeFixture.deltas),
      completionUrl: "https://claude.ai/api/organizations/o/chat_conversations/c/completion",
      expected: claudeFixture.expectedAssistant,
    });
  });

  it("chatgpt.com: SSE → hook → relay → worker → POST /capture", async () => {
    await runChain({
      host: "chatgpt.com",
      adapter: chatgptAdapter,
      sseBody: buildChatgptSSE(chatgptFixture.snapshots),
      completionUrl: "https://chatgpt.com/backend-api/conversation",
      expected: chatgptFixture.expectedAssistant,
    });
  });
});

describe("makeHookedFetch — extracts both turns from a completion request", () => {
  it("posts the user turn (request) and the assistant turn (SSE)", async () => {
    const post = vi.fn();
    const origFetch = (async () =>
      new Response(buildClaudeSSE(claudeFixture.deltas), { status: 200 })) as unknown as typeof fetch;
    await makeHookedFetch(
      origFetch,
      claudeAdapter,
      post,
    )("https://claude.ai/api/organizations/o/chat_conversations/c/completion", {
      method: "POST",
      body: JSON.stringify({ prompt: "say hello" }),
    });
    await waitFor(() => post.mock.calls.length >= 2);
    const posted = post.mock.calls.map((c) => c[1]);
    expect(posted).toContainEqual({ role: "user", content: "say hello" });
    expect(posted).toContainEqual({ role: "assistant", content: claudeFixture.expectedAssistant });
  });
});

describe("handleRelayMessage — origin/window/tag guards", () => {
  it("forwards valid same-window same-origin synapse messages and drops the rest", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", { origin: "https://claude.ai" });
    const sent: unknown[] = [];
    vi.stubGlobal("chrome", { runtime: { sendMessage: (m: unknown) => sent.push(m) } });
    const win = (globalThis as { window?: unknown }).window;
    const ev = (over: Record<string, unknown>) =>
      ({
        source: win,
        origin: "https://claude.ai",
        data: { __synapse: true, kind: "turn", host: "claude.ai", content: "hi" },
        ...over,
      }) as unknown as MessageEvent;

    handleRelayMessage(ev({})); // valid → forwarded
    handleRelayMessage(ev({ source: {} })); // cross-window → dropped
    handleRelayMessage(ev({ origin: "https://evil.com" })); // cross-origin → dropped
    handleRelayMessage(ev({ data: { __synapse: false } })); // untagged → dropped

    expect(sent).toHaveLength(1);
  });
});

describe("drift detection in the hook", () => {
  it("posts a drift signal after 3 matched-but-empty completions", async () => {
    const post = vi.fn();
    // An adapter that matches but never parses (simulates a wire-format change).
    const brokenAdapter: CaptureAdapter = {
      host: "claude.ai",
      matchesCompletion: () => true,
      parseRequest: () => null,
      parseResponse: () => null,
    };
    const origFetch = (async () =>
      new Response("event: unknown\ndata: {}\n\n", { status: 200 })) as unknown as typeof fetch;
    const hooked = makeHookedFetch(origFetch, brokenAdapter, post, createDriftSentinel({ threshold: 3 }));
    for (let i = 0; i < 3; i++) await hooked("https://claude.ai/c/completion", { method: "POST" });
    await waitFor(() => post.mock.calls.some((c) => c[0] === "drift"));
    const drift = post.mock.calls.find((c) => c[0] === "drift");
    expect(drift?.[1]).toMatchObject({ eventNames: ["unknown"] });
  });

  it("stays silent while the adapter keeps parsing successfully", async () => {
    const post = vi.fn();
    const okAdapter: CaptureAdapter = {
      host: "claude.ai",
      matchesCompletion: () => true,
      parseRequest: () => null,
      parseResponse: () => ({ role: "assistant", content: "ok" }),
    };
    const origFetch = (async () => new Response("event: x\ndata: {}\n\n", { status: 200 })) as unknown as typeof fetch;
    const hooked = makeHookedFetch(origFetch, okAdapter, post, createDriftSentinel({ threshold: 3 }));
    for (let i = 0; i < 5; i++) await hooked("https://claude.ai/c/completion", { method: "POST" });
    await waitFor(() => post.mock.calls.some((c) => c[0] === "turn"));
    expect(post.mock.calls.some((c) => c[0] === "drift")).toBe(false);
  });
});
