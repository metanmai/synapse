// mcp/test/capture/proxy/connect-integration.test.ts
//
// Integration tests for the Layer 3b CONNECT handler + TLS-MITM path.
// Uses real TLS sockets all the way through — no mocking of crypto or
// the network. Setup:
//
//   client ──CONNECT──> proxy ──https──> fake-tls-LLM-server
//             tls.connect (trusts our CA)
//             https.request (proxy trusts our CA via upstreamCa)
//
// Both sides of the TLS-MITM (client→proxy and proxy→upstream) use
// real Node TLS sockets so the test exercises every real failure mode:
// handshake, cert validation, hostname check, SNI, plaintext bridge.
//
// Bug class: "the proxy's HTTPS CONNECT path fails to accept the
// tunnel, terminates TLS with the wrong cert (cross-host leak),
// fails to decrypt/parse the inner request, fails to forward to a
// real HTTPS upstream, double-captures, miscaptures, or crashes on
// malformed CONNECT input."

import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { type Socket, connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TLSSocket, connect as tlsConnect } from "node:tls";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ProxyServer, createProxyServer } from "../../../src/capture/proxy/server.js";
import { TlsManager } from "../../../src/capture/proxy/tls.js";
import type { CapturedRequest } from "../../../src/capture/proxy/types.js";
import { type FakeLLMServer, createFakeLLMServer, createFakeTlsLLMServer } from "../../helpers/fake-llm-server.js";

// ── Test setup ───────────────────────────────────────────────────────────

let tmpRoot: string;
let tlsManager: TlsManager;
let caCertPem: string;
let fakeAnthropic: FakeLLMServer;
let proxy: ProxyServer;
let captured: CapturedRequest[];

beforeEach(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-proxy-l3b-test-"));
  tlsManager = new TlsManager({ caDir: tmpRoot });
  caCertPem = tlsManager.ensureCa().cert;

  // The fake upstream presents a cert FOR api.anthropic.com — signed
  // by our CA. It's bound to 127.0.0.1, but the proxy will SNI as
  // api.anthropic.com (since we preserve original host as servername),
  // so the cert's SAN matches and validation passes.
  const anthropicLeaf = tlsManager.getLeafCert("api.anthropic.com");
  fakeAnthropic = await createFakeTlsLLMServer({
    key: anthropicLeaf.key,
    cert: anthropicLeaf.cert,
    handlers: {
      "/v1/messages": (req) => ({
        body: {
          role: "assistant",
          content: [{ type: "text", text: "fake-https response" }],
          model: "claude-fake",
          _echo: req.body,
        },
      }),
      "/api/event_logging/v2/batch": () => ({
        body: { ok: true },
      }),
    },
  });

  captured = [];
  proxy = await createProxyServer({
    tlsManager,
    upstreamMap: { "api.anthropic.com": fakeAnthropic.url },
    upstreamCa: caCertPem,
    onCaptured: (req) => captured.push(req),
  });
});

afterEach(async () => {
  await proxy.stop();
  await fakeAnthropic.stop();
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────

interface ProxiedHttpsResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Open a CONNECT tunnel through the proxy to the given target.
 * Returns the raw socket the client should now layer TLS on top of.
 * Rejects if the proxy returns a non-200 status to the CONNECT.
 */
async function openConnect(proxyPort: number, target: string): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const sock = netConnect(proxyPort, "127.0.0.1");
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      sock.off("data", onData);
      const statusLine = buf.slice(0, buf.indexOf("\r\n"));
      const m = statusLine.match(/HTTP\/1\.\d (\d+)/);
      if (!m || Number.parseInt(m[1], 10) !== 200) {
        sock.destroy();
        reject(new Error(`CONNECT failed: ${statusLine}`));
        return;
      }
      resolve(sock);
    };
    sock.on("data", onData);
    sock.on("error", reject);
    sock.on("connect", () => {
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
  });
}

/**
 * Full client-side flow: CONNECT through the proxy, layer TLS on the
 * tunneled socket (trusting our CA), write a raw HTTP/1.1 request,
 * read the response. Connection: close means EOF = end-of-body, which
 * sidesteps needing a full HTTP parser here.
 */
async function proxiedHttpsRequest(opts: {
  proxyPort: number;
  target: string; // e.g. "api.anthropic.com:443"
  caPem: string;
  servername?: string; // default: host from target
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<ProxiedHttpsResponse> {
  const [host] = opts.target.split(":");
  const sni = opts.servername ?? host;

  const rawSocket = await openConnect(opts.proxyPort, opts.target);
  const tlsSocket = await new Promise<TLSSocket>((resolve, reject) => {
    const t = tlsConnect({
      socket: rawSocket,
      servername: sni,
      ca: opts.caPem,
    });
    t.once("secureConnect", () => resolve(t));
    t.once("error", reject);
  });

  const baseHeaders: Record<string, string> = {
    Host: host,
    "Content-Length": String(opts.body ? Buffer.byteLength(opts.body) : 0),
    Connection: "close",
  };
  const allHeaders = { ...baseHeaders, ...(opts.headers ?? {}) };
  let requestStr = `${opts.method} ${opts.path} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(allHeaders)) requestStr += `${k}: ${v}\r\n`;
  requestStr += "\r\n";
  if (opts.body) requestStr += opts.body;
  tlsSocket.write(requestStr);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    tlsSocket.on("data", (c: Buffer) => chunks.push(c));
    tlsSocket.on("end", resolve);
    tlsSocket.on("close", resolve);
    tlsSocket.on("error", reject);
  });

  return parseHttpResponse(Buffer.concat(chunks));
}

function parseHttpResponse(buf: Buffer): ProxiedHttpsResponse {
  const text = buf.toString("utf-8");
  const headerEnd = text.indexOf("\r\n\r\n");
  if (headerEnd < 0) throw new Error("malformed response: no header terminator");
  const headerBlock = text.slice(0, headerEnd);
  let body = text.slice(headerEnd + 4);

  const lines = headerBlock.split("\r\n");
  const statusLine = lines[0];
  const m = statusLine.match(/^HTTP\/1\.\d (\d+)/);
  if (!m) throw new Error(`malformed status line: ${statusLine}`);
  const status = Number.parseInt(m[1], 10);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).toLowerCase().trim();
      const v = line.slice(i + 1).trim();
      headers[k] = v;
    }
  }

  // Decode chunked transfer-encoding if used. Node's https.Server sends
  // chunked by default for dynamic content under Connection: close.
  if (headers["transfer-encoding"] === "chunked") {
    body = decodeChunked(body);
  }
  return { status, headers, body };
}

function decodeChunked(s: string): string {
  let out = "";
  let pos = 0;
  while (pos < s.length) {
    const lineEnd = s.indexOf("\r\n", pos);
    if (lineEnd < 0) break;
    const sizeHex = s.slice(pos, lineEnd).split(";")[0].trim();
    const size = Number.parseInt(sizeHex, 16);
    if (!Number.isFinite(size)) break;
    if (size === 0) break;
    pos = lineEnd + 2;
    out += s.slice(pos, pos + size);
    pos += size + 2; // skip the chunk's trailing \r\n
  }
  return out;
}

/**
 * Raw CONNECT-only helper for tests that just want to assert the
 * proxy's response to a bad CONNECT (without ever opening TLS).
 */
async function rawConnectAttempt(proxyPort: number, requestLine: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const sock = netConnect(proxyPort, "127.0.0.1");
    let buf = "";
    sock.on("data", (c: Buffer) => {
      buf += c.toString("utf-8");
    });
    sock.on("end", () => resolve(buf));
    sock.on("close", () => resolve(buf));
    sock.on("error", reject);
    sock.on("connect", () => {
      sock.write(`${requestLine}\r\nHost: x\r\n\r\n`);
    });
  });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("HTTPS forward-proxy with TLS-MITM (Layer 3b)", () => {
  it("proxies an HTTPS chat request end-to-end with body fidelity + exactly one capture", async () => {
    const reqBody = JSON.stringify({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hello tls" }],
    });
    const res = await proxiedHttpsRequest({
      proxyPort: proxy.port,
      target: "api.anthropic.com:443",
      caPem: caCertPem,
      method: "POST",
      path: "/v1/messages",
      headers: { "Content-Type": "application/json" },
      body: reqBody,
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.content[0].text).toBe("fake-https response");
    // Passthrough fidelity: upstream RECEIVED what we SENT.
    expect(parsed._echo).toEqual({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hello tls" }],
    });

    expect(captured).toHaveLength(1);
    const c = captured[0];
    expect(c.endpoint).toEqual({ provider: "anthropic", kind: "messages", capture: true });
    expect(c.statusCode).toBe(200);
    expect(c.requestBody).toMatchObject({ messages: [{ role: "user", content: "hello tls" }] });
    expect(c.responseBody).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "fake-https response" }],
    });
  });

  it("forwards a non-chat HTTPS endpoint transparently without capturing (telemetry passthrough over TLS)", async () => {
    // The Layer 2 telemetry-passthrough test asserted this for HTTP.
    // Same invariant must hold over the TLS-MITM path: the proxy
    // forwards every request faithfully, but only emits onCaptured for
    // recognized chat endpoints.
    const res = await proxiedHttpsRequest({
      proxyPort: proxy.port,
      target: "api.anthropic.com:443",
      caPem: caCertPem,
      method: "POST",
      path: "/api/event_logging/v2/batch",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ type: "ping" }] }),
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(captured).toHaveLength(0);
    expect(fakeAnthropic.received).toHaveLength(1);
    expect(fakeAnthropic.received[0].path).toBe("/api/event_logging/v2/batch");
  });

  it("two concurrent HTTPS tunnels do not cross responses", async () => {
    // The fundamental tunnel-isolation guarantee. If the WeakMap
    // bridge or the inner-server connection state ever leaked across
    // tunnels, one client would see another's response.
    fakeAnthropic.setHandler("/v1/messages", (req) => {
      const body = req.body as { messages?: Array<{ content: string }> };
      const t = body.messages?.[0]?.content ?? "?";
      return {
        body: { role: "assistant", content: [{ type: "text", text: `echo: ${t}` }] },
      };
    });

    const [a, b] = await Promise.all([
      proxiedHttpsRequest({
        proxyPort: proxy.port,
        target: "api.anthropic.com:443",
        caPem: caCertPem,
        method: "POST",
        path: "/v1/messages",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "alpha" }] }),
      }),
      proxiedHttpsRequest({
        proxyPort: proxy.port,
        target: "api.anthropic.com:443",
        caPem: caCertPem,
        method: "POST",
        path: "/v1/messages",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "beta" }] }),
      }),
    ]);

    expect(JSON.parse(a.body).content[0].text).toBe("echo: alpha");
    expect(JSON.parse(b.body).content[0].text).toBe("echo: beta");
    expect(captured).toHaveLength(2);
  });

  it("rejects CONNECT with a malformed target (400, no crash)", async () => {
    const response = await rawConnectAttempt(proxy.port, "CONNECT not-a-valid-target HTTP/1.1");
    expect(response).toMatch(/^HTTP\/1\.1 400/);
  });

  it("rejects CONNECT with a path-traversal hostname (400, not 500)", async () => {
    // TlsManager throws for unsafe hostnames; the proxy must CATCH the
    // throw and return a clean 400 rather than letting it bubble into a
    // 500 / leaked stack trace.
    const response = await rawConnectAttempt(proxy.port, "CONNECT ../etc/passwd:443 HTTP/1.1");
    expect(response).toMatch(/^HTTP\/1\.1 400/);
  });

  it("rejects CONNECT when no TlsManager is configured (405 Method Not Allowed)", async () => {
    // A proxy spun up WITHOUT a TlsManager is HTTP-only. CONNECT must
    // be cleanly refused so misconfigured clients get a meaningful
    // error rather than a hung tunnel.
    const noTlsProxy = await createProxyServer({});
    try {
      const response = await rawConnectAttempt(noTlsProxy.port, "CONNECT api.anthropic.com:443 HTTP/1.1");
      expect(response).toMatch(/^HTTP\/1\.1 405/);
    } finally {
      await noTlsProxy.stop();
    }
  });

  it("presents distinct per-hostname leaf certs (no cross-tunnel cert poisoning)", async () => {
    // Setup: two fake upstreams, one per provider, each with a leaf
    // cert for its own hostname. The proxy must terminate each tunnel
    // with the matching leaf — if it ever served api.anthropic.com's
    // cert on an api.openai.com tunnel, tls.connect's default
    // checkServerIdentity (run as part of secureConnect) would FAIL
    // since the SAN wouldn't match. Both handshakes succeeding =
    // isolation works.
    const openaiLeaf = tlsManager.getLeafCert("api.openai.com");
    const fakeOpenai = await createFakeTlsLLMServer({
      key: openaiLeaf.key,
      cert: openaiLeaf.cert,
      handlers: {
        "/v1/chat/completions": () => ({
          body: { choices: [{ message: { content: "openai-fake" } }] },
        }),
      },
    });
    const proxyBoth = await createProxyServer({
      tlsManager,
      upstreamMap: {
        "api.anthropic.com": fakeAnthropic.url,
        "api.openai.com": fakeOpenai.url,
      },
      upstreamCa: caCertPem,
      onCaptured: (req) => captured.push(req),
    });
    try {
      await proxiedHttpsRequest({
        proxyPort: proxyBoth.port,
        target: "api.anthropic.com:443",
        caPem: caCertPem,
        method: "POST",
        path: "/v1/messages",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
      });

      // If the proxy ever returned the api.anthropic.com cert here, this
      // tls.connect (with servername=api.openai.com) would fail in
      // secureConnect due to checkServerIdentity. Reaching the response
      // proves the proxy minted a distinct api.openai.com leaf.
      const openaiRes = await proxiedHttpsRequest({
        proxyPort: proxyBoth.port,
        target: "api.openai.com:443",
        caPem: caCertPem,
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
      });
      expect(openaiRes.status).toBe(200);
      expect(JSON.parse(openaiRes.body).choices[0].message.content).toBe("openai-fake");
      // Both endpoints captured: anthropic.messages + openai.chat.
      expect(captured.map((c) => `${c.endpoint.provider}.${c.endpoint.kind}`).sort()).toEqual([
        "anthropic.messages",
        "openai.chat",
      ]);
    } finally {
      await proxyBoth.stop();
      await fakeOpenai.stop();
    }
  });

  it("regression: plain-HTTP forward-proxy path still works when TlsManager is configured", async () => {
    // Layer 2's HTTP path must not regress now that Layer 3b is wired
    // in. Same proxy instance (with tlsManager) routes both HTTP
    // forward-proxy AND HTTPS CONNECT — the HTTP path's absolute-URL
    // request line must still parse, route, and capture exactly as
    // Layer 2's tests assert.
    const fakeHttp = await createFakeLLMServer({
      handlers: {
        "/v1/messages": () => ({
          body: { role: "assistant", content: [{ type: "text", text: "plain-http response" }] },
        }),
      },
    });
    const httpProxy = await createProxyServer({
      tlsManager,
      upstreamMap: { "api.anthropic.com": fakeHttp.url },
      upstreamCa: caCertPem,
      onCaptured: (req) => captured.push(req),
    });
    try {
      const reqBody = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const r = httpRequest(
          {
            hostname: "127.0.0.1",
            port: httpProxy.port,
            method: "POST",
            path: "http://api.anthropic.com/v1/messages",
            headers: {
              Host: "api.anthropic.com",
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(reqBody)),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (c: Buffer) => chunks.push(c));
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf-8"),
              }),
            );
          },
        );
        r.on("error", reject);
        r.write(reqBody);
        r.end();
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).content[0].text).toBe("plain-http response");
      expect(captured).toHaveLength(1);
      expect(captured[0].endpoint.kind).toBe("messages");
    } finally {
      await httpProxy.stop();
      await fakeHttp.stop();
    }
  });
});
