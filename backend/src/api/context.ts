import { Hono } from "hono";

import { logActivity } from "../db/activity-logger";
import { createSupabaseClient } from "../db/client";
import {
  countEntries,
  countUniqueConnections,
  deleteEntry,
  getAllEntries,
  getEntry,
  getEntryHistory,
  getPreferences,
  getProjectByName,
  getRecentEntries,
  listEntries,
  restoreEntry,
  searchEntries,
  upsertEntry,
} from "../db/queries";
import { authMiddleware } from "../lib/auth";
import { envList } from "../lib/env";
import { AppError, NotFoundError } from "../lib/errors";
import { idempotency } from "../lib/idempotency";
import { enforceConnectionLimit, enforceFileLimit, getHistoryLimit } from "../lib/tier";

import type { Env } from "../lib/env";

const context = new Hono<{ Bindings: Env }>();
context.use("*", authMiddleware);
context.use("*", idempotency);

// POST /api/context/save
context.post("/save", async (c) => {
  const user = c.get("user");
  const { project, path, content, tags, source } = await c.req.json();
  if (!project || !path || !content) {
    throw new AppError("project, path, and content are required", 400, "VALIDATION_ERROR");
  }

  const validSources = envList(c.env, "VALID_SOURCES", "human,claude,chatgpt,cursor,copilot,windsurf,google_docs");
  const entrySource = validSources.includes(source) ? source : "human";

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, project, user.id);
  if (!proj) throw new NotFoundError(`Project "${project}" not found`);

  // Check if this is a new entry (not an update)
  const existing = await getEntry(db, proj.id, path);
  if (!existing) {
    // New file — enforce file limit
    const fileCount = await countEntries(db, proj.id);
    enforceFileLimit(fileCount, c);

    // New source — enforce connection limit
    const connectionCount = await countUniqueConnections(db, proj.id);
    enforceConnectionLimit(connectionCount, entrySource, c);
  }

  const entry = await upsertEntry(db, {
    project_id: proj.id,
    path,
    content,
    tags,
    author_id: user.id,
    source: entrySource,
  });
  await logActivity(db, {
    project_id: proj.id,
    user_id: user.id,
    action: entry.created_at === entry.updated_at ? "entry_created" : "entry_updated",
    target_path: path,
    source: entrySource,
  });
  return c.json(entry, 201);
});

// POST /api/context/session-summary
context.post("/session-summary", async (c) => {
  const user = c.get("user");
  const { project, summary, decisions: _decisions, pending } = await c.req.json();
  if (!project || !summary) {
    throw new AppError("project and summary are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, project, user.id);
  if (!proj) throw new NotFoundError(`Project "${project}" not found`);

  const date = new Date().toISOString().split("T")[0];
  const slug = summary
    .slice(0, 40)
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
  const path = `context/session-summaries/${date}-${slug}.md`;

  let fullContent = `# Session Summary — ${date}\n\n${summary}`;
  if (pending?.length) {
    fullContent += `\n\n## Pending\n${pending.map((p: string) => `- ${p}`).join("\n")}`;
  }

  const entry = await upsertEntry(db, {
    project_id: proj.id,
    path,
    content: fullContent,
    tags: ["session-summary"],
    author_id: user.id,
    source: "human",
  });
  await logActivity(db, {
    project_id: proj.id,
    user_id: user.id,
    action: entry.created_at === entry.updated_at ? "entry_created" : "entry_updated",
    target_path: path,
    source: "human",
  });

  return c.json(entry, 201);
});

// POST /api/context/file
context.post("/file", async (c) => {
  const user = c.get("user");
  const { project, path, content, content_type } = await c.req.json();
  if (!project || !path || !content) {
    throw new AppError("project, path, and content are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, project, user.id);
  if (!proj) throw new NotFoundError(`Project "${project}" not found`);

  const entry = await upsertEntry(db, {
    project_id: proj.id,
    path,
    content,
    content_type: content_type ?? "markdown",
    author_id: user.id,
    source: "human",
  });
  await logActivity(db, {
    project_id: proj.id,
    user_id: user.id,
    action: entry.created_at === entry.updated_at ? "entry_created" : "entry_updated",
    target_path: path,
    source: "human",
  });
  return c.json(entry, 201);
});

// GET /api/context/:project/search?q=&tags=&folder=
context.get("/:project/search", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const query = c.req.query("q");
  const tags = c.req.query("tags")?.split(",");
  const folder = c.req.query("folder");

  if (!query) throw new AppError("q query parameter is required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const results = await searchEntries(db, proj.id, query, { tags, folder });
  return c.json(results);
});

// GET /api/context/:project/list?folder=
context.get("/:project/list", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const folder = c.req.query("folder");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entries = await listEntries(db, proj.id, folder);
  return c.json(entries);
});

// GET /api/context/:project/load
context.get("/:project/load", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const prefs = await getPreferences(db, user.id, proj.id);

  switch (prefs.context_loading) {
    case "full": {
      const entries = await getAllEntries(db, proj.id);
      return c.json({ mode: "full", entries });
    }
    case "smart": {
      const entries = await getRecentEntries(db, proj.id, 20);
      return c.json({ mode: "smart", entries });
    }
    case "on_demand": {
      const tree = await listEntries(db, proj.id);
      return c.json({ mode: "on_demand", tree });
    }
    case "summary_only": {
      const entries = await getAllEntries(db, proj.id);
      const summary = entries.map((e) => `- **${e.path}**: ${e.content.slice(0, 100)}...`).join("\n");
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

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  let history = await getEntryHistory(db, proj.id, path);
  // Free tier: limit to most recent N versions
  if (historyLimit > 0) {
    history = history.slice(0, historyLimit);
  }
  return c.json(history);
});

// POST /api/context/:project/restore — body: { path, historyId }
context.post("/:project/restore", async (c) => {
  const historyLimit = getHistoryLimit(c);
  if (historyLimit === 0) {
    throw new AppError("Version restore is not available on your plan.", 403, "TIER_LIMIT");
  }
  const user = c.get("user");
  const projectName = c.req.param("project");
  const { path, historyId } = await c.req.json();
  if (!path || !historyId) {
    throw new AppError("path and historyId are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entry = await restoreEntry(db, proj.id, path, historyId);
  if (!entry) throw new NotFoundError("Entry or history record not found");

  await logActivity(db, {
    project_id: proj.id,
    user_id: user.id,
    action: "entry_updated",
    target_path: path,
    source: "human",
    metadata: { restored_from: historyId },
  });

  return c.json(entry);
});

// DELETE /api/context/:project/:path{.+}
context.delete("/:project/:path{.+}", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const path = c.req.param("path") ?? "";

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entry = await getEntry(db, proj.id, path);
  if (!entry) throw new NotFoundError(`Entry "${path}" not found in project "${projectName}"`);

  await deleteEntry(db, proj.id, path);
  await logActivity(db, {
    project_id: proj.id,
    user_id: user.id,
    action: "entry_deleted",
    target_path: path,
    source: "human",
  });

  return c.json({ ok: true });
});

// GET /api/context/:project/:path{.+} — must be last (catch-all)
context.get("/:project/:path{.+}", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const path = c.req.param("path");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entry = await getEntry(db, proj.id, path);
  if (!entry) throw new NotFoundError(`Entry "${path}" not found in project "${projectName}"`);

  return c.json(entry);
});

export { context };
