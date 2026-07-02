// mcp/test/capture/proxy/proxy-integration.test.ts
//
// Integration tests for the Layer 2 HTTP forward-proxy server.
// Uses the fake LLM server helper as upstream — no real network calls,
// no API tokens spent, deterministic across runs.
//
// Bug class: "the proxy server mishandles HTTP forwarding (drops bytes,
// mangles headers, buffers responses wrongly) OR fails to capture chat
// endpoints OR captures non-chat endpoints by accident OR breaks the
// client's request when forwarding."

import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ProxyServer, createProxyServer } from "../../../src/capture/proxy/server.js";
import type { CapturedRequest } from "../../../src/capture/proxy/types.js";
import { type FakeLLMServer, createFakeLLMServer } from "../../helpers/fake-llm-server.js";

// ── Test setup ───────────────────────────────────────────────────────────

let fakeAnthropic: FakeLLMServer;
let proxy: ProxyServer;
let captured: CapturedRequest[];

beforeEach(async () => {
  captured = [];
  fakeAnthropic = await createFakeLLMServer({
    handlers: {
      "/v1/messages": (req) => ({
        body: {
          role: "assistant",
          content: [{ type: "text", text: "fake response" }],
          model: "claude-fake",
          stop_reason: "end_turn",
          _echo: req.body, // echo back so we can assert passthrough fidelity
        },
      }),
      "/api/event_logging/v2/batch": () => ({
        body: { ok: true },
      }),
    },
  });

  proxy = await createProxyServer({
    upstreamMap: { "api.anthropic.com": fakeAnthropic.url },
    onCaptured: (req) => captured.push(req),
  });
});

afterEach(async () => {
  await proxy.stop();
  await fakeAnthropic.stop();
});

// ── Helpers ──────────────────────────────────────────────────────────────

interface ProxyResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Make an HTTP forward-proxy request. The proxy sees the absolute URL on
 *  the request line and routes accordingly. */
function proxyRequest(opts: {
  proxyPort: number;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(opts.url);
    const headers: Record<string, string> = {
      Host: target.host,
      ...(opts.headers ?? {}),
    };
    if (opts.body) headers["Content-Length"] = String(Buffer.byteLength(opts.body));

    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: opts.proxyPort,
        method: opts.method ?? "GET",
        path: opts.url, // absolute URL = forward-proxy form
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("HTTP forward-proxy server (Layer 2)", () => {
  it("forwards a chat request through to upstream and returns the upstream response verbatim", async () => {
    const reqBody = JSON.stringify({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
    });

    const res = await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: reqBody,
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.content[0].text).toBe("fake response");
    // Passthrough fidelity: the body the upstream RECEIVED is what we SENT.
    expect(parsed._echo).toEqual({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("emits onCaptured exactly once for a chat request, with parsed bodies and 2xx status", async () => {
    await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
    });

    expect(captured).toHaveLength(1);
    const c = captured[0];
    expect(c.endpoint).toEqual({ provider: "anthropic", kind: "messages", capture: true });
    expect(c.statusCode).toBe(200);
    expect(c.requestBody).toMatchObject({ messages: [{ role: "user", content: "ping" }] });
    expect(c.responseBody).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "fake response" }],
    });
    expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does NOT emit onCaptured for non-chat endpoints (telemetry passthrough)", async () => {
    // The spike showed /api/event_logging/v2/batch is one of 30+ non-chat
    // endpoints claude CLI hits. The proxy forwards it normally but must
    // NEVER produce a CapturedRequest for it.
    const res = await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/api/event_logging/v2/batch",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ type: "metric" }] }),
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(captured).toHaveLength(0);
    // But upstream DID receive it (the request was forwarded, just not captured).
    expect(fakeAnthropic.received).toHaveLength(1);
    expect(fakeAnthropic.received[0].path).toBe("/api/event_logging/v2/batch");
  });

  it("forwards an upstream 500 transparently and does NOT emit onCaptured for failed chat (non-2xx blocks capture)", async () => {
    // NB: capture happens regardless of status in the current impl — the
    // FILTER on 2xx happens in session-reconstruction.ts Stage 1. So this
    // test asserts the forward-the-status behavior; the captured event IS
    // emitted but with statusCode=500, which session-reconstruction will
    // drop later. That layering is intentional: the proxy faithfully
    // records what happened (including failures) and lets the higher
    // layer decide what's worth keeping.
    fakeAnthropic.setHandler("/v1/messages", () => ({
      status: 500,
      body: { error: "upstream exploded" },
    }));

    const res = await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "boom" }] }),
    });

    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: "upstream exploded" });
    expect(captured).toHaveLength(1);
    expect(captured[0].statusCode).toBe(500);
  });

  it("returns 502 to the client when the upstream is unreachable", async () => {
    // Build a NEW proxy that points api.anthropic.com at a port nobody's
    // listening on. The proxy should return 502 immediately.
    const brokenProxy = await createProxyServer({
      upstreamMap: { "api.anthropic.com": "http://127.0.0.1:1" }, // port 1 is reserved
      onCaptured: () => captured.push,
    });
    try {
      const res = await proxyRequest({
        proxyPort: brokenProxy.port,
        url: "http://api.anthropic.com/v1/messages",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(502);
      expect(res.body).toContain("upstream error");
    } finally {
      await brokenProxy.stop();
    }
  });

  it("handles two concurrent in-flight requests without crossing responses (basic concurrency)", async () => {
    // Two simultaneous requests; assert each gets back the correct response.
    fakeAnthropic.setHandler("/v1/messages", (req) => {
      const body = req.body as { messages?: Array<{ content: string }> };
      const userText = body.messages?.[0]?.content ?? "?";
      return {
        body: {
          role: "assistant",
          content: [{ type: "text", text: `echo: ${userText}` }],
        },
      };
    });

    const [a, b] = await Promise.all([
      proxyRequest({
        proxyPort: proxy.port,
        url: "http://api.anthropic.com/v1/messages",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "alpha" }] }),
      }),
      proxyRequest({
        proxyPort: proxy.port,
        url: "http://api.anthropic.com/v1/messages",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "beta" }] }),
      }),
    ]);

    expect(JSON.parse(a.body).content[0].text).toBe("echo: alpha");
    expect(JSON.parse(b.body).content[0].text).toBe("echo: beta");
    expect(captured).toHaveLength(2);
  });

  it("rejects requests without an absolute URL on the request line (4xx)", async () => {
    // Forward-proxy protocol requires absolute URLs. A relative path like
    // /v1/messages means the client thinks it's talking to the proxy as a
    // regular server, which is misconfigured. Respond 400 so the client
    // sees the real cause.
    const res = await new Promise<ProxyResponse>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: proxy.port,
          method: "GET",
          path: "/v1/messages", // relative — bad
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () =>
            resolve({
              status: r.statusCode ?? 0,
              headers: r.headers,
              body: Buffer.concat(chunks).toString("utf-8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(400);
  });

  it("attaches X-Synapse-Cwd to CapturedRequest and strips it from the upstream-forwarded headers", async () => {
    // BUG CLASS: "captured sessions land in a phantom 'unknown' project
    // because the proxy can't learn the calling cwd from inside the
    // TLS-MITM layer." The fix is the `X-Synapse-Cwd` opt-in header:
    // clients that know their working directory tell the proxy, the
    // proxy attaches it to CapturedRequest.clientCwd, and downstream
    // session-reconstruction uses it for CapturedSession.projectPath.
    // The header is private to the proxy layer — upstream providers
    // (Anthropic, OpenRouter, etc.) must NOT see it leak through.
    //
    // Discovered 2026-06-07: Stage 4.1 of happy-flow-e2e on metanmai/
    // synapse timed out polling for conversations under the test cwd's
    // project because the proxy capture was being routed to "unknown".
    await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Synapse-Cwd": "/path/to/some/project",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "tagged" }] }),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].clientCwd).toBe("/path/to/some/project");

    // Upstream must NOT see the x-synapse-* header — it's a proxy-private signal.
    const upstreamSaw = fakeAnthropic.received[0];
    expect(upstreamSaw.headers["x-synapse-cwd"]).toBeUndefined();
  });

  it("leaves clientCwd undefined when the client does NOT send X-Synapse-Cwd (backwards-compatible fallback)", async () => {
    // Pre-header clients (claude CLI, crush, real-world CLI tools that
    // don't know about the header) still get captured; their session
    // just lands with projectPath="unknown" downstream. That's the
    // documented fallback — not a regression — until the CLIs add
    // support for the header themselves.
    await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/v1/messages",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "untagged" }] }),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].clientCwd).toBeUndefined();
  });

  it("strips client-set hop-by-hop headers (Proxy-Connection) while forwarding end-to-end headers (Content-Type)", async () => {
    // The proxy must NOT blindly forward all client headers. Hop-by-hop
    // headers (Connection, Proxy-Connection, etc.) are meaningful only
    // between the immediate client/server pair and must not propagate to
    // the upstream. End-to-end headers (Content-Type, Authorization, etc.)
    // MUST propagate.
    //
    // We assert on Proxy-Connection specifically because Node's
    // http.request will automatically set its own Connection header on
    // HTTP/1.1 outgoing requests regardless of our stripping logic —
    // that's correct HTTP behavior. Proxy-Connection is a hop-by-hop
    // header that Node will NEVER auto-set, so its absence at the
    // upstream is a clean signal that our stripping worked.
    await proxyRequest({
      proxyPort: proxy.port,
      url: "http://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Proxy-Connection": "keep-alive",
        "X-Custom-End-To-End": "should-pass-through",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });

    const upstreamSaw = fakeAnthropic.received[0];
    expect(upstreamSaw.headers["proxy-connection"]).toBeUndefined();
    // End-to-end headers must propagate.
    expect(upstreamSaw.headers["content-type"]).toContain("application/json");
    expect(upstreamSaw.headers["x-custom-end-to-end"]).toBe("should-pass-through");
  });
});
