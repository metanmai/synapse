import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";
import { auth, account } from "./api/auth";
import { context } from "./api/context";
import { projects } from "./api/projects";
import { sync } from "./api/sync";
import { share } from "./api/share";
import { SynapseAgent } from "./mcp/agent";
import { runScheduledGoogleSync } from "./sync/from-google";

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend
app.use("*", cors({
  origin: ["http://localhost:5173", "https://app.synapse.dev"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as 400 | 401 | 403 | 404 | 409 | 410 | 500);
  }
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
  return c.json({ error: err.message || "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "synapse" }));

// Auth routes (no auth middleware)
app.route("/auth", auth);

// Authenticated routes
app.route("/api/context", context);
app.route("/api/projects", projects);
app.route("/api/sync", sync);
app.route("/api/share", share);
app.route("/api/account", account);

// Mount MCP server (Streamable HTTP transport)
app.mount("/mcp", SynapseAgent.serve("/mcp").fetch);

// Export Durable Object class (required by Wrangler)
export { SynapseAgent };

// Default export for Cloudflare Workers
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledGoogleSync(env));
  },
};
