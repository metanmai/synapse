import { Hono } from "hono";
import type { Env } from "./lib/env";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));

export default app;
