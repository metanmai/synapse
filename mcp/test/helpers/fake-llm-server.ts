/**
 * Fake LLM upstream server for proxy-daemon tests.
 *
 * Provides a real Node `http.Server` listening on a random port that
 * serves canned responses shaped after Anthropic / OpenAI / Google
 * chat-completion APIs. The proxy daemon's tests route their traffic
 * here instead of hitting the real `api.anthropic.com` etc., so we
 * get deterministic + free + fast test runs.
 *
 * Usage:
 *   const fake = await createFakeLLMServer({
 *     handlers: {
 *       "/v1/messages": () => ({
 *         body: { role: "assistant", content: [{ type: "text", text: "hi" }] },
 *       }),
 *     },
 *   });
 *   // ... use fake.url ...
 *   await fake.stop();
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface ReceivedRequest {
  method: string;
  /** Path with query string stripped (the proxy-relevant URL part). */
  path: string;
  /** Path including query string, as observed on the wire. */
  fullPath: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface HandlerResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type FakeLLMHandler = (req: ReceivedRequest) => Promise<HandlerResponse> | HandlerResponse;

export interface FakeLLMServer {
  /** Full base URL — `http://127.0.0.1:<port>`. */
  url: string;
  /** Bound port (useful when caller passed port=0 for OS-assigned). */
  port: number;
  /** History of every request the server received. */
  received: ReceivedRequest[];
  /** Replace the handler for a specific path mid-test. */
  setHandler(path: string, handler: FakeLLMHandler): void;
  /** Shutdown the server. */
  stop(): Promise<void>;
}

export interface CreateFakeLLMServerOpts {
  /** Map of `path → handler`. Path matching strips query strings.
   *  Catch-all not provided here — unknown paths return 404. */
  handlers?: Record<string, FakeLLMHandler>;
  /** Optional port. Default 0 (OS-assigned, safe for parallel tests). */
  port?: number;
}

export async function createFakeLLMServer(opts: CreateFakeLLMServerOpts = {}): Promise<FakeLLMServer> {
  const handlers = new Map<string, FakeLLMHandler>(Object.entries(opts.handlers ?? {}));
  const received: ReceivedRequest[] = [];

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readBody(req);
      const fullPath = req.url ?? "/";
      const path = stripQuery(fullPath);

      const parsed: ReceivedRequest = {
        method: req.method ?? "GET",
        path,
        fullPath,
        headers: normalizeHeaders(req.headers as Record<string, string | string[] | undefined>),
        body: parseBody(body, req.headers["content-type"]),
      };
      received.push(parsed);

      const handler = handlers.get(path);
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `no handler for ${path}` }));
        return;
      }

      const result = await handler(parsed);
      const status = result.status ?? 200;
      const respHeaders = { "Content-Type": "application/json", ...(result.headers ?? {}) };
      res.writeHead(status, respHeaders);
      const respBody = typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? {});
      res.end(respBody);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `fake-llm-server internal: ${(err as Error).message}` }));
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    received,
    setHandler(path, handler) {
      handlers.set(path, handler);
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBody(buf: Buffer, contentType: string | undefined): unknown {
  if (buf.length === 0) return null;
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(buf.toString("utf-8"));
    } catch {
      return buf.toString("utf-8");
    }
  }
  return buf.toString("utf-8");
}

function stripQuery(path: string): string {
  const i = path.indexOf("?");
  return i >= 0 ? path.slice(0, i) : path;
}

function normalizeHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}
