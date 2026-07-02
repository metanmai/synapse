/**
 * Loopback HTTP server that exposes the browser-capture ingest endpoints on
 * 127.0.0.1 only. Thin glue: parses the body, extracts the socket address +
 * headers, and routes to the tested pure handlers (ingest-route.ts). Never
 * binds 0.0.0.0.
 */

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { CapturedSession } from "../types.js";
import type { CaptureRateTracker } from "./capture-rate.js";
import { handleDrift, handleHeartbeat, handleIngest, isExtensionOrigin } from "./ingest-route.js";

const MAX_BODY_BYTES = 1_000_000; // 1 MB — conversations, not uploads

export interface IngestServerOptions {
  port: number;
  token: string;
  sync: (session: CapturedSession) => Promise<boolean>;
  rateTracker: CaptureRateTracker;
  log: (msg: string) => void;
  now?: () => number;
}

export interface RunningIngestServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export async function startIngestServer(opts: IngestServerOptions): Promise<RunningIngestServer> {
  const now = opts.now ?? (() => Date.now());

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS + Private Network Access: the browser extension's service worker does a
    // cross-origin fetch to this loopback origin, which Chrome gates behind a
    // preflight (the POST carries a custom token header + JSON body, so it is not
    // a "simple" request, and 127.0.0.1 is a private-network target). Answer the
    // preflight for extension origins so the capture POST can actually land — and
    // echo Allow-Origin on every response so the browser doesn't block the read.
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (origin && isExtensionOrigin(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      if (origin && isExtensionOrigin(origin)) {
        res.setHeader("access-control-allow-methods", "POST, OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type, x-synapse-ingest-token");
        res.setHeader("access-control-allow-private-network", "true");
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    let body: unknown;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    const tokenHeader = req.headers["x-synapse-ingest-token"];
    const guards = {
      remoteAddress: req.socket.remoteAddress ?? undefined,
      token: typeof tokenHeader === "string" ? tokenHeader : undefined,
      expectedToken: opts.token,
      origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
    };
    const url = req.url ?? "";

    if (url.startsWith("/heartbeat")) {
      const r = handleHeartbeat(body, guards);
      if (r.ok && r.host) opts.rateTracker.heartbeat(r.host, now());
      res.writeHead(r.ok ? 200 : (r.status ?? 400));
      res.end();
      return;
    }

    if (url.startsWith("/capture")) {
      const r = await handleIngest(body, { ...guards, sync: opts.sync });
      if (r.ok) {
        const host = (body as { host?: unknown }).host;
        if (typeof host === "string") opts.rateTracker.capture(host, now());
      }
      res.writeHead(r.ok ? 200 : (r.status ?? 400));
      res.end();
      return;
    }

    if (url.startsWith("/drift")) {
      const r = handleDrift(body, guards);
      if (r.ok && r.host) {
        opts.rateTracker.drift(r.host, now());
        opts.log(
          `⚠ capture drift on ${r.host}: events=[${(r.eventNames ?? []).join(",")}] bytes=${r.byteLength} hash=${r.sampleHash}`,
        );
      }
      res.writeHead(r.ok ? 200 : (r.status ?? 400));
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      opts.log(`ingest server error: ${err}`);
      try {
        res.writeHead(500);
        res.end();
      } catch {
        /* response already started */
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr !== null ? addr.port : opts.port;

  const close = (): Promise<void> => new Promise((resolve) => server.close(() => resolve()));
  return { server, port: boundPort, close };
}
