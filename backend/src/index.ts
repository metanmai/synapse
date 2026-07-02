import { Hono } from "hono";
import { cors } from "hono/cors";
import { admin } from "./api/admin";
import { account, auth } from "./api/auth";
import { billing } from "./api/billing";
import { capture } from "./api/capture";
import { compaction } from "./api/compaction";
import { context } from "./api/context";
import { conversations } from "./api/conversations";
import { eventsBatch } from "./api/events-batch";
import { insights } from "./api/insights";
import { internal } from "./api/internal";
import { invites } from "./api/invites";
import { projectEvents } from "./api/project-events";
import { projectStatus } from "./api/project-status";
import { projects } from "./api/projects";
import { projectsResolve } from "./api/projects-resolve";
import { share } from "./api/share";
import { runDailyAggregation } from "./cron/aggregate";
import { reconcileProjects } from "./cron/reconcile-projects";
import { runDailyConsolidationRetry } from "./cron/retry-consolidations";
import { CompactionScheduler } from "./durable-objects/compaction-scheduler";
import type { Env } from "./lib/env";
import { envList } from "./lib/env";
import { AppError } from "./lib/errors";
import { rateLimit } from "./lib/rate-limit";
import { SynapseAgent } from "./mcp/agent";
import { dbMiddleware } from "./middleware/db";

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend
app.use("*", (c, next) => {
  const origins = envList(
    c.env,
    "CORS_ORIGINS",
    "http://localhost:5173,https://synapsesync.app,https://synapse-7mq.pages.dev",
  );
  return cors({
    // Configured frontend origins, PLUS any browser-extension origin: the
    // self-sufficient capture extension POSTs cross-origin with a Bearer token
    // (no cookies). CORS is not the auth boundary here — the capture-scoped key
    // + fail-closed scope gate are. Reflect allowed origins, omit otherwise.
    origin: (origin) =>
      origin && (origins.includes(origin) || origin.startsWith("chrome-extension://")) ? origin : null,
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
    return c.json({ error: err.message, code: err.code }, err.status as 400 | 401 | 402 | 403 | 404 | 409 | 410 | 500);
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
app.route("/api/events", eventsBatch);
app.route("/api/projects", projectsResolve);
app.route("/api/projects", projects);
app.route("/api/projects", projectStatus);
app.route("/api/projects", projectEvents);
app.route("/api/share", share);
app.route("/api/account", account);
app.route("/api/admin", admin);
app.route("/api/billing", billing);
app.route("/api/insights", insights);
app.route("/api", invites);
app.route("/api/conversations", conversations);
app.route("/api/capture", capture);
app.route("/api", compaction);

// Internal ops trigger — mounted OUTSIDE /api so it isn't caught by the
// /api/* auth wildcard (invites). Token-guarded; builds its own DB client.
app.route("/internal", internal);

// Mount MCP server (Streamable HTTP transport)
app.mount("/mcp", SynapseAgent.serve("/mcp").fetch);

// Export Durable Object classes (required by Wrangler)
export { SynapseAgent, CompactionScheduler };

// Default export for Cloudflare Workers
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 3 * * *") {
      ctx.waitUntil(runDailyAggregation(env));
      // Phase 03-04: catch up Plus projects whose POST-time consolidation
      // failed (LLM outage). Independent waitUntil so a failure in one
      // job doesn't poison the other; both share the 30s wall-clock budget.
      ctx.waitUntil(runDailyConsolidationRetry(env));
      // AI project correlation: backfill conversation embeddings + merge
      // fragmented projects (2-run hysteresis). Deterministic, LLM-free.
      ctx.waitUntil(reconcileProjects(env));
    }
  },
};
