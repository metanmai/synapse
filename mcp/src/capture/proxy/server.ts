/**
 * HTTP forward-proxy server for the LLM API proxy daemon.
 *
 * Layers 2 + 3b of the proxy build plan. The "body" that runs the
 * Layer 1 brain. Two transport modes:
 *
 *   • Plain HTTP forward-proxy (Layer 2): client sends an absolute URL
 *     on the request line (`POST http://api.example.com/path HTTP/1.1`),
 *     proxy parses the URL, forwards to the upstream over HTTP, captures
 *     chat-shaped bodies on the way back.
 *
 *   • HTTPS CONNECT tunneling with TLS-MITM (Layer 3b): client opens a
 *     CONNECT tunnel (`CONNECT api.example.com:443 HTTP/1.1`); proxy
 *     responds 200, hijacks the socket, terminates TLS using a per-host
 *     leaf cert from TlsManager, feeds the decrypted stream to an inner
 *     http.Server, then forwards each parsed request to the real upstream
 *     over a fresh HTTPS connection. Same capture path as the HTTP route.
 *
 * The inner http.Server is never `.listen()`-ed — we feed it sockets via
 * `emit('connection', tlsSocket)` so Node's HTTP parser does the work.
 * The original CONNECT target is bridged across the TLS termination via
 * a WeakMap<TLSSocket, TunnelContext> — the inner request handler reads
 * it back to know which host the bytes were really meant for.
 *
 * Streaming responses (SSE) are currently buffered end-to-end before
 * forwarding — works correctness-wise but breaks live streaming UX.
 * Layer 4 will add stream-pipe with parallel buffering for SSE.
 *
 * Hop-by-hop headers (connection, transfer-encoding, etc.) are not
 * forwarded because the outbound request library sets them based on its
 * own connection management.
 */

import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request as httpRequest,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { TLSSocket } from "node:tls";
import { recognizeEndpoint } from "./endpoint-recognition.js";
import type { CertPair, TlsManager } from "./tls.js";
import type { CapturedRequest, EndpointInfo } from "./types.js";

export interface ProxyServerOptions {
  /** Port to listen on. 0 = OS-assigned (recommended for tests). */
  port?: number;
  /**
   * Per-host upstream override. Useful in tests:
   *   { "api.anthropic.com": "http://127.0.0.1:54321" }
   * causes proxied traffic for api.anthropic.com to be forwarded to
   * the local fake LLM server instead of the real Anthropic API.
   *
   * If the override URL is `https://...`, the proxy forwards over HTTPS;
   * SNI/cert validation uses the ORIGINAL host (not the override host),
   * so the test-fake should present a cert for `api.anthropic.com` even
   * while bound to 127.0.0.1.
   */
  upstreamMap?: Record<string, string>;
  /**
   * Called once per CAPTURED request (chat endpoint + 2xx-or-other).
   * Non-chat (telemetry) requests are forwarded normally but never
   * trigger this callback. The CapturedRequest's request/response
   * bodies are parsed JSON when Content-Type indicates so; otherwise
   * they're raw strings.
   */
  onCaptured?: (request: CapturedRequest) => void;
  /**
   * Enables HTTPS interception via the CONNECT method. The TlsManager
   * provides per-host leaf certs that the proxy presents to TLS clients
   * (clients must trust the manager's CA — via system keychain for GUI
   * tools or NODE_EXTRA_CA_CERTS for Node CLIs).
   *
   * If absent, CONNECT requests are rejected with 405 — the proxy is
   * HTTP-only.
   */
  tlsManager?: TlsManager;
  /**
   * Optional CA bundle (PEM) used to validate UPSTREAM certs when
   * forwarding an HTTPS request. Set in tests where the fake upstream
   * is signed by a self-signed CA the proxy needs to trust. In
   * production, leave undefined to use Node's default trust store.
   */
  upstreamCa?: string | string[];
}

export interface ProxyServer {
  port: number;
  stop(): Promise<void>;
}

interface TunnelContext {
  host: string;
  port: number;
}

/**
 * Bridges CONNECT-time host info across TLS termination. The inner
 * http.Server's request handler reads this back to recover the original
 * host (since the decrypted request line is relative, e.g. `/v1/messages`,
 * with no host context of its own).
 *
 * WeakMap = entries vanish on socket GC, no manual cleanup needed.
 */
const tunnelContexts = new WeakMap<TLSSocket, TunnelContext>();

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export async function createProxyServer(opts: ProxyServerOptions = {}): Promise<ProxyServer> {
  // Outer server: plain HTTP forward-proxy + CONNECT.
  const outerServer: Server = createServer((clientReq, clientRes) => {
    handleRequest(clientReq, clientRes, opts);
  });

  // Inner server: receives sockets that have already had TLS terminated.
  // Never `.listen()`-ed — sockets are hand-fed via emit('connection').
  // The request handler reads tunnel context off the socket to recover
  // the original target host.
  const innerServer: Server = createServer((clientReq, clientRes) => {
    const sock = clientReq.socket as TLSSocket;
    const ctx = tunnelContexts.get(sock);
    if (!ctx) {
      // Shouldn't happen — the CONNECT handler always sets context
      // before emitting 'connection'. Defensive 500 if it ever does.
      clientRes.writeHead(500, { "Content-Type": "text/plain" });
      clientRes.end("proxy: missing tunnel context");
      return;
    }
    handleRequest(clientReq, clientRes, opts, ctx);
  });

  outerServer.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket, head, opts, innerServer);
  });

  await new Promise<void>((resolve) => outerServer.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const port = (outerServer.address() as AddressInfo).port;

  return {
    port,
    async stop() {
      await new Promise<void>((resolve, reject) => outerServer.close((err) => (err ? reject(err) : resolve())));
      // innerServer was never listened — close() is a no-op for the
      // listening socket but cleans up any internal state.
      innerServer.close();
    },
  };
}

// ── CONNECT handler ──────────────────────────────────────────────────────

function handleConnect(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  opts: ProxyServerOptions,
  innerServer: Server,
): void {
  if (!opts.tlsManager) {
    clientSocket.write("HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n");
    clientSocket.end();
    return;
  }

  const target = parseConnectTarget(req.url);
  if (!target) {
    clientSocket.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
    clientSocket.end();
    return;
  }

  let leaf: CertPair;
  try {
    leaf = opts.tlsManager.getLeafCert(target.host);
  } catch {
    // TlsManager rejects unsafe hostnames or fails to sign — return 400
    // (the client's CONNECT target was the cause).
    clientSocket.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
    clientSocket.end();
    return;
  }

  // Acknowledge the tunnel BEFORE wrapping in TLS — the client expects
  // a plaintext "200 Connection Established" on the raw socket, and
  // only THEN starts its TLS handshake.
  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

  // If any bytes were buffered past the CONNECT request line (rare in
  // practice — proper HTTPS-via-proxy clients wait for the 200 before
  // sending TLS bytes — but be defensive), push them back so the TLS
  // parser sees them.
  if (head && head.length > 0) {
    clientSocket.unshift(head);
  }

  // Terminate TLS. We play server, presenting the leaf cert for
  // target.host. The client (which trusts our CA) completes the
  // handshake against the leaf, and from here on the data flowing
  // through `tlsSocket` is plaintext HTTP that we can parse.
  const tlsSocket = new TLSSocket(clientSocket, {
    isServer: true,
    key: leaf.key,
    cert: leaf.cert,
  });

  // Stash the host:port the client really wanted. The inner http.Server
  // will look this up when parsing the decrypted request — the request
  // line itself only has the path (`/v1/messages`), not the host.
  tunnelContexts.set(tlsSocket, target);

  tlsSocket.on("error", () => {
    // Handshake error (e.g. client doesn't trust our CA) or stream
    // error. Best-effort cleanup; client gets a TCP reset.
    try {
      tlsSocket.destroy();
    } catch {
      /* */
    }
  });

  // Hand the decrypted stream to the inner http.Server's parser.
  innerServer.emit("connection", tlsSocket);
}

function parseConnectTarget(urlStr: string | undefined): TunnelContext | null {
  // CONNECT request line: `CONNECT host:port HTTP/1.1` — never an
  // absolute URL. Reject anything that doesn't look like host:port.
  if (!urlStr) return null;
  const i = urlStr.lastIndexOf(":");
  if (i <= 0) return null;
  const host = urlStr.slice(0, i);
  const portStr = urlStr.slice(i + 1);
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  if (host.length === 0) return null;
  // Reject obvious injection / path-traversal attempts at the proxy
  // layer — TlsManager rejects the same set, but catching them earlier
  // gives a clean 400 instead of relying on the cert-gen path's throw.
  if (/[\r\n\0/\\]/.test(host)) return null;
  return { host, port };
}

// ── Request handler (shared by HTTP path + tunneled HTTPS path) ──────────

function handleRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  opts: ProxyServerOptions,
  tunnel?: TunnelContext,
): void {
  let host: string;
  let port: number;
  let scheme: "http" | "https";
  let pathAndQuery: string;

  if (tunnel) {
    // CONNECT-tunneled: the inner request line is relative (the client
    // thinks it's making a direct request to the host), so the host
    // info comes from the CONNECT context stashed earlier.
    host = tunnel.host;
    port = tunnel.port;
    scheme = "https";
    pathAndQuery = clientReq.url ?? "/";
  } else {
    // Plain forward-proxy: absolute URL on the request line.
    const url = parseAbsoluteUrl(clientReq.url);
    if (!url) {
      clientRes.writeHead(400, { "Content-Type": "text/plain" });
      clientRes.end("proxy: invalid absolute URL on request line");
      return;
    }
    host = url.hostname;
    port = url.port ? Number.parseInt(url.port, 10) : 80;
    scheme = "http";
    pathAndQuery = url.pathname + url.search;
  }

  const startedAt = new Date().toISOString();
  const endpoint = recognizeEndpoint(host, pathAndQuery);
  const upstream = resolveUpstream(host, port, scheme, opts.upstreamMap);

  // `X-Synapse-Cwd` is a client-side opt-in: tools that know their
  // working directory (the e2e harness, future cwd-aware CLI shims,
  // direct curl callers in scripts) can tag captured chats with their
  // origin path. session-reconstruction uses this to fill
  // CapturedSession.projectPath, which cloud-sync then feeds into
  // findOrCreateProjectByGit so the conversation routes to the user's
  // real project instead of the phantom "unknown" bucket. The header
  // is stripped from forwardHeaders below so upstream providers
  // (Anthropic, OpenRouter, etc.) never see it.
  const cwdHeader = clientReq.headers["x-synapse-cwd"];
  const clientCwd = typeof cwdHeader === "string" ? cwdHeader : Array.isArray(cwdHeader) ? cwdHeader[0] : undefined;

  // Filter hop-by-hop headers; preserve a clean Host header. Also
  // strip x-synapse-* tagging headers (private to the proxy layer —
  // upstream providers don't need to see them).
  const forwardHeaders: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(clientReq.headers)) {
    if (v === undefined) continue;
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower.startsWith("x-synapse-")) continue;
    forwardHeaders[k] = v;
  }
  forwardHeaders.host = port === defaultPort(scheme) ? host : `${host}:${port}`;

  // Buffer request body before forwarding. Streaming-pipe is a Layer 4
  // optimization; correctness first.
  const reqChunks: Buffer[] = [];
  clientReq.on("data", (chunk: Buffer) => reqChunks.push(chunk));
  clientReq.on("end", () => {
    const reqBody = Buffer.concat(reqChunks);

    // Build options separately for http vs https — the two RequestOptions
    // types diverge (only https.RequestOptions accepts `ca` / `servername`).
    const commonOpts = {
      hostname: upstream.hostname,
      port: upstream.port,
      method: clientReq.method,
      path: pathAndQuery,
      headers: forwardHeaders,
    };

    const upstreamReq =
      upstream.scheme === "https"
        ? httpsRequest({ ...commonOpts, ca: opts.upstreamCa, servername: upstream.servername }, onUpstreamResponse)
        : httpRequest(commonOpts, onUpstreamResponse);

    function onUpstreamResponse(upstreamRes: IncomingMessage): void {
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (v === undefined) continue;
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        responseHeaders[k] = v;
      }
      clientRes.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);

      const resChunks: Buffer[] = [];
      upstreamRes.on("data", (chunk: Buffer) => {
        resChunks.push(chunk);
        clientRes.write(chunk);
      });
      upstreamRes.on("end", () => {
        clientRes.end();
        if (endpoint.capture && opts.onCaptured) {
          const resBody = Buffer.concat(resChunks);
          const uaHeader = clientReq.headers["user-agent"];
          const captured: CapturedRequest = {
            timestamp: startedAt,
            endpoint,
            requestBody: parseBody(reqBody, clientReq.headers["content-type"]),
            responseBody: parseBody(resBody, upstreamRes.headers["content-type"]),
            statusCode: upstreamRes.statusCode ?? 502,
            userAgent: typeof uaHeader === "string" ? uaHeader : uaHeader?.[0],
            ...(clientCwd ? { clientCwd } : {}),
          };
          try {
            opts.onCaptured(captured);
          } catch {
            // Swallow callback errors — capture is best-effort; don't
            // let a flaky consumer break the forwarding hot path.
          }
        }
      });
      upstreamRes.on("error", (err) => {
        if (!clientRes.writableEnded) clientRes.end();
        maybeReport(opts, endpoint, startedAt, err, clientRes);
      });
    }

    upstreamReq.on("error", (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
        clientRes.end(`proxy: upstream error: ${err.message}`);
      } else if (!clientRes.writableEnded) {
        clientRes.end();
      }
    });

    if (reqBody.length > 0) upstreamReq.write(reqBody);
    upstreamReq.end();
  });

  clientReq.on("error", () => {
    // Client disconnected mid-request — best-effort cleanup, no callback.
    if (!clientRes.writableEnded) clientRes.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseAbsoluteUrl(urlStr: string | undefined): URL | null {
  if (!urlStr) return null;
  try {
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      return new URL(urlStr);
    }
    return null;
  } catch {
    return null;
  }
}

interface UpstreamResolved {
  hostname: string;
  port: number;
  scheme: "http" | "https";
  /** SNI + cert-validation servername; defaults to the original host so
   *  test fakes bound to 127.0.0.1 can present a cert for the real
   *  hostname without IP-SAN gymnastics. */
  servername: string;
}

function resolveUpstream(
  originalHost: string,
  originalPort: number,
  originalScheme: "http" | "https",
  upstreamMap?: Record<string, string>,
): UpstreamResolved {
  const override = upstreamMap?.[originalHost];
  if (override) {
    try {
      const u = new URL(override);
      const overrideScheme = u.protocol === "https:" ? "https" : "http";
      return {
        hostname: u.hostname,
        port: u.port ? Number.parseInt(u.port, 10) : defaultPort(overrideScheme),
        scheme: overrideScheme,
        // Preserve original host as SNI — see UpstreamResolved.servername.
        servername: originalHost,
      };
    } catch {
      /* fall through to no-override */
    }
  }
  return { hostname: originalHost, port: originalPort, scheme: originalScheme, servername: originalHost };
}

function defaultPort(scheme: "http" | "https"): number {
  return scheme === "https" ? 443 : 80;
}

function parseBody(buf: Buffer, contentType: string | undefined): unknown {
  if (buf.length === 0) return null;
  const text = buf.toString("utf-8");
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function maybeReport(
  _opts: ProxyServerOptions,
  _endpoint: EndpointInfo,
  _startedAt: string,
  _err: unknown,
  _clientRes: ServerResponse,
): void {
  // Reserved for future diagnostic emit. For now, errors during upstream
  // response streaming are swallowed silently — same posture as a real
  // proxy (e.g., Squid) which just ends the connection.
}
