import { Hono } from "hono";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";
import { auth } from "./api/auth";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));
app.route("/auth", auth);

export default app;
