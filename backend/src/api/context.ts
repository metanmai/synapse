import { Hono } from "hono";

import {
  getAllEntries,
  getEntry,
  getEntryHistory,
  getPreferences,
  getRecentEntries,
  listEntries,
  searchEntries,
} from "../db/queries";
import { authMiddleware } from "../lib/auth";
import { RECENT_ENTRIES_LIMIT, SUMMARY_PREVIEW_LENGTH } from "../lib/constants";
import { embedTexts, embeddingConfigFromEnv } from "../lib/embeddings";
import { AppError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";
import { getHistoryLimit } from "../lib/tier";
import { resolveProject } from "../middleware/project-auth";

import type { Env } from "../lib/env";

const context = new Hono<{ Bindings: Env }>();
context.use("*", authMiddleware);
context.use("*", idempotency);

// GET /api/context/:project/search?q=&tags=&folder=
context.get("/:project/search", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const query = c.req.query("q");
  const tags = c.req.query("tags")?.split(",");
  const folder = c.req.query("folder");

  if (!query) throw new AppError("q query parameter is required", 400, "VALIDATION_ERROR");

  const db = c.get("db");
  const { project: proj } = await resolveProject(db, projectName, user.id);

  // Embed the query for semantic search (returns null if service unavailable)
  const config = embeddingConfigFromEnv(c.env);
  const vectors = await embedTexts([query], "search_query", config);
  const queryEmbedding = vectors?.[0] ?? null;

  const results = await searchEntries(db, proj.id, query, { tags, folder }, queryEmbedding);
  return c.json(results);
});

// GET /api/context/:project/list?folder=
context.get("/:project/list", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const folder = c.req.query("folder");

  const db = c.get("db");
  const { project: proj } = await resolveProject(db, projectName, user.id);

  const entries = await listEntries(db, proj.id, folder);
  return c.json(entries);
});

// GET /api/context/:project/load
context.get("/:project/load", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = c.get("db");
  const { project: proj } = await resolveProject(db, projectName, user.id);

  const prefs = await getPreferences(db, user.id, proj.id);

  switch (prefs.context_loading) {
    case "full": {
      const entries = await getAllEntries(db, proj.id);
      return c.json({ mode: "full", entries });
    }
    case "smart": {
      const entries = await getRecentEntries(db, proj.id, RECENT_ENTRIES_LIMIT);
      return c.json({ mode: "smart", entries });
    }
    case "on_demand": {
      const tree = await listEntries(db, proj.id);
      return c.json({ mode: "on_demand", tree });
    }
    case "summary_only": {
      const entries = await getAllEntries(db, proj.id);
      const summary = entries
        .map((e) => `- **${e.path}**: ${e.content.slice(0, SUMMARY_PREVIEW_LENGTH)}...`)
        .join("\n");
      return c.json({ mode: "summary_only", summary });
    }
  }
});

// GET /api/context/:project/history/:path{.+}
context.get("/:project/history/:path{.+}", async (c) => {
  const historyLimit = getHistoryLimit(c);
  if (historyLimit === 0) {
    throw new AppError("Version history is not available on your plan.", 403, "TIER_LIMIT");
  }

  const user = c.get("user");
  const projectName = c.req.param("project");
  const path = c.req.param("path") ?? "";

  const db = c.get("db");
  const { project: proj } = await resolveProject(db, projectName, user.id);

  let history = await getEntryHistory(db, proj.id, path);
  // Free tier: limit to most recent N versions
  if (historyLimit > 0) {
    history = history.slice(0, historyLimit);
  }
  return c.json(history);
});

// GET /api/context/:project/:path{.+} — must be last (catch-all)
context.get("/:project/:path{.+}", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const path = c.req.param("path");

  const db = c.get("db");
  const { project: proj } = await resolveProject(db, projectName, user.id);

  const entry = await getEntry(db, proj.id, path);
  if (!entry) throw new NotFoundError(`Entry "${path}" not found in project "${projectName}"`);

  return c.json(entry);
});

export { context };
