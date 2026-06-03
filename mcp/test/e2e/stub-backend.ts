import http from "node:http";
import { reduce } from "@synapse/shared/handoff/reducer.js";
import type { Event } from "@synapse/shared/handoff/types.js";

export async function startStubBackend(): Promise<{ url: string; stop: () => void }> {
  const events: Event[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url?.endsWith("/api/events/batch") && req.method === "POST") {
      const body = await readBody(req);
      const { events: batch } = JSON.parse(body);
      for (const e of batch) events.push({ ...e, received_at: new Date().toISOString() });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: batch.length, duplicates: 0 }));
      return;
    }
    const m = req.url?.match(/\/api\/projects\/([^/]+)\/status$/);
    if (m && req.method === "GET") {
      const status = reduce(
        events.filter((e) => e.project_id === m[1]),
        m[1],
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(status));
      return;
    }
    // Phase 2 (D-08): GET /api/projects/:id/events — historical event pull,
    // used by runEagerPullCycle on a fresh-install machine to bootstrap its
    // events.jsonl with the project's prior activity. Returns events ascending
    // by event_id so the daemon's watermark logic works correctly.
    const eventsMatch = req.url?.match(/\/api\/projects\/([^/?]+)\/events(?:\?|$)/);
    if (eventsMatch && req.method === "GET") {
      const projectEvents = events
        .filter((e) => e.project_id === eventsMatch[1])
        .sort((a, b) => a.event_id.localeCompare(b.event_id));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ events: projectEvents, next_since: null }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, stop: () => server.close() };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
    });
    req.on("end", () => resolve(b));
  });
}
