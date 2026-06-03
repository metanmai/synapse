/**
 * HTTP forward-proxy server for the LLM API proxy daemon.
 *
 * Layer 2 of the proxy build plan. The "body" that runs the Layer 1 brain.
 *
 * What it does:
 *   1. Accepts forward-proxy HTTP requests (client points HTTP_PROXY here)
 *   2. Parses the absolute URL from the request line
 *   3. Classifies the endpoint via recognizeEndpoint()
 *   4. Forwards to upstream (or override via upstreamMap for tests)
 *   5. If endpoint.capture: buffers request + response bodies and emits a
 *      CapturedRequest via the onCaptured callback
 *   6. Forwards response bytes back to the client transparently
 *
 * HTTP only in this slice. TLS/HTTPS forward-proxying (the CONNECT method)
 * is Layer 5 — same routing/capture core, just an HTTPS wrapper.
 *
 * Streaming responses (SSE) currently buffered end-to-end before forwarding
 * — works correctness-wise but breaks live streaming UX. Layer 4 will add
 * stream-pipe with parallel buffering for SSE.
 *
 * Hop-by-hop headers (connection, transfer-encoding, etc.) are not forwarded
 * because http.request sets them based on its own connection management.
 */

import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
  request as httpRequest,
} from "node:http";
import type { AddressInfo } from "node:net";
import { recognizeEndpoint } from "./endpoint-recognition.js";
import type { CapturedRequest, EndpointInfo } from "./types.js";

export interface ProxyServerOptions {
  /** Port to listen on. 0 = OS-assigned (recommended for tests). */
  port?: number;
  /**
   * Per-host upstream override. Useful in tests:
   *   { "api.anthropic.com": "http://127.0.0.1:54321" }
   * causes proxied traffic for api.anthropic.com to be forwarded to
   * the local fake LLM server instead of the real Anthropic API.
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
}

export interface ProxyServer {
  port: number;
  stop(): Promise<void>;
}

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
  const server: Server = createServer((clientReq, clientRes) => {
    handleRequest(clientReq, clientRes, opts);
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    async stop() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

function handleRequest(clientReq: IncomingMessage, clientRes: ServerResponse, opts: ProxyServerOptions): void {
  const url = parseAbsoluteUrl(clientReq.url);
  if (!url) {
    clientRes.writeHead(400, { "Content-Type": "text/plain" });
    clientRes.end("proxy: invalid absolute URL on request line");
    return;
  }

  const startedAt = new Date().toISOString();
  const endpoint = recognizeEndpoint(url.hostname, url.pathname + url.search);

  // Resolve upstream — test override > URL hostname.
  const upstream = resolveUpstream(url.hostname, url.port ? Number.parseInt(url.port, 10) : 80, opts.upstreamMap);

  // Forward headers — copy everything EXCEPT hop-by-hop entries. Preserve
  // the original Host header from the client URL (some servers check it).
  const forwardHeaders: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(clientReq.headers)) {
    if (v === undefined) continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    forwardHeaders[k] = v;
  }
  forwardHeaders.host = url.host;

  // Buffer the request body before forwarding (Layer 2 simplicity;
  // streaming-pipe is a Layer 4 optimization).
  const reqChunks: Buffer[] = [];
  clientReq.on("data", (chunk: Buffer) => reqChunks.push(chunk));
  clientReq.on("end", () => {
    const reqBody = Buffer.concat(reqChunks);

    const upstreamReq = httpRequest(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: clientReq.method,
        path: url.pathname + url.search,
        headers: forwardHeaders,
      },
      (upstreamRes) => {
        // Write status + headers to client (filter hop-by-hop on the way back).
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
            const captured: CapturedRequest = {
              timestamp: startedAt,
              endpoint,
              requestBody: parseBody(reqBody, clientReq.headers["content-type"]),
              responseBody: parseBody(resBody, upstreamRes.headers["content-type"]),
              statusCode: upstreamRes.statusCode ?? 502,
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
          if (!clientRes.writableEnded) {
            clientRes.end();
          }
          maybeReport(opts, endpoint, startedAt, err, clientRes);
        });
      },
    );

    upstreamReq.on("error", (err) => {
      // Upstream unreachable / connection refused / etc. — return 502 to client.
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
    // Absolute URL (forward-proxy form): http://host/path
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      return new URL(urlStr);
    }
    return null;
  } catch {
    return null;
  }
}

function resolveUpstream(
  hostname: string,
  port: number,
  upstreamMap?: Record<string, string>,
): { hostname: string; port: number } {
  const override = upstreamMap?.[hostname];
  if (override) {
    try {
      const u = new URL(override);
      return {
        hostname: u.hostname,
        port: u.port ? Number.parseInt(u.port, 10) : 80,
      };
    } catch {
      /* fall through to original */
    }
  }
  return { hostname, port };
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
