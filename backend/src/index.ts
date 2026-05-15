import { Hono } from "hono";
import { cors } from "hono/cors";
import { account, auth } from "./api/auth";
import { billing } from "./api/billing";
import { context } from "./api/context";
import { conversations } from "./api/conversations";
import { insights } from "./api/insights";
import { projects } from "./api/projects";
import { share } from "./api/share";
import { sync } from "./api/sync";
import type { Env } from "./lib/env";
import { envList } from "./lib/env";
import { AppError } from "./lib/errors";
import { rateLimit } from "./lib/rate-limit";
import { SynapseAgent } from "./mcp/agent";
import { dbMiddleware } from "./middleware/db";
import { runScheduledGoogleSync } from "./sync/from-google";

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend
app.use("*", (c, next) => {
  const origins = envList(
    c.env,
    "CORS_ORIGINS",
    "http://localhost:5173,https://synapsesync.app,https://synapse-7mq.pages.dev",
  );
  return cors({
    origin: origins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    credentials: true,
  })(c, next);
});

// Rate limiting — 120 requests per minute per key/IP
app.use("*", rateLimit(120, 60000));
// DB middleware — scoped to routes that need it (not /health or /mcp)
app.use("/auth/*", dbMiddleware);
app.use("/api/*", dbMiddleware);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as 400 | 401 | 403 | 404 | 409 | 410 | 500);
  }
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
  return c.json(
    {
      error: err.message || "Internal server error",
      code: "INTERNAL_ERROR",
      detail: String(err),
      path: c.req.path,
    },
    500,
  );
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
app.route("/api/billing", billing);
app.route("/api/insights", insights);
app.route("/api/conversations", conversations);

// Mount MCP server (Streamable HTTP transport)
app.mount("/mcp", SynapseAgent.serve("/mcp").fetch);

// Export Durable Object class (required by Wrangler)
export { SynapseAgent };

// Default export for Cloudflare Workers
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledGoogleSync(env));
  },
};
