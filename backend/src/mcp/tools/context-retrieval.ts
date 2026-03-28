import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createSupabaseClient } from "../../db/client";
import {
  getAllEntries,
  getEntry,
  getPreferences,
  getProjectByName,
  getRecentEntries,
  listEntries,
  searchEntries,
} from "../../db/queries";

import { embeddingConfigFromEnv, embedTexts } from "../../lib/embeddings";
import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";

export function registerContextRetrievalTools(server: McpServer, env: Env, getContext: GetMcpContext) {
  server.tool(
    "get_context",
    "Retrieve a specific context entry by its path within a project.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("Path to the entry, e.g., 'decisions/chose-postgres.md'"),
    },
    async ({ project, path }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const entry = await getEntry(db, proj.id, path);
      if (!entry) return { content: [{ type: "text", text: `No entry found at "${path}".` }] };

      return {
        content: [{ type: "text", text: entry.content }],
      };
    },
  );

  server.tool(
    "search_context",
    "Search across all context in a project using semantic + full-text + keyword search. Understands meaning — e.g., 'auth flow' finds documents about 'login and session tokens'.",
    {
      project: z.string().describe("Project name"),
      query: z.string().describe("Search query (natural language or keywords)"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      folder: z.string().optional().describe("Limit search to a folder path prefix"),
    },
    async ({ project, query, tags, folder }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      // Embed the query for semantic search
      const config = embeddingConfigFromEnv(env);
      const vectors = await embedTexts([query], "search_query", config);
      const queryEmbedding = vectors?.[0] ?? null;

      const results = await searchEntries(db, proj.id, query, { tags, folder }, queryEmbedding);

      if (!results.length) {
        return { content: [{ type: "text", text: `No results found for "${query}".` }] };
      }

      const formatted = results
        .map(
          (e) =>
            `### ${e.path}\n*Tags: ${e.tags.join(", ") || "none"}*\n\n${e.content.slice(0, 500)}${e.content.length > 500 ? "..." : ""}`,
        )
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} result(s):\n\n${formatted}` }],
      };
    },
  );

  server.tool(
    "list_context",
    "List all entries in a project or within a specific folder. Returns paths, types, and tags.",
    {
      project: z.string().describe("Project name"),
      folder: z.string().optional().describe("Folder path to list (omit for full project tree)"),
    },
    async ({ project, folder }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const entries = await listEntries(db, proj.id, folder);

      if (!entries.length) {
        return { content: [{ type: "text", text: folder ? `No entries in "${folder}".` : "Project is empty." }] };
      }

      const tree = entries
        .map((e) => `- ${e.path} (${e.content_type}${e.tags.length ? `, tags: ${e.tags.join(", ")}` : ""})`)
        .join("\n");

      return {
        content: [{ type: "text", text: tree }],
      };
    },
  );

  server.tool(
    "load_project_context",
    "Load project context based on your preference setting. Use at the start of a session to get relevant context.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const prefs = await getPreferences(db, userId, proj.id);

      switch (prefs.context_loading) {
        case "full": {
          const entries = await getAllEntries(db, proj.id);
          const formatted = entries.map((e) => `## ${e.path}\n\n${e.content}`).join("\n\n---\n\n");
          return { content: [{ type: "text", text: formatted || "Project is empty." }] };
        }
        case "smart": {
          const entries = await getRecentEntries(db, proj.id, 20);
          const formatted = entries.map((e) => `## ${e.path}\n\n${e.content}`).join("\n\n---\n\n");
          return { content: [{ type: "text", text: `Recent context (${entries.length} entries):\n\n${formatted}` }] };
        }
        case "on_demand": {
          const tree = await listEntries(db, proj.id);
          const treeText = tree.map((e) => `- ${e.path}`).join("\n");
          return {
            content: [
              { type: "text", text: `Project tree (use get_context to fetch individual entries):\n\n${treeText}` },
            ],
          };
        }
        case "summary_only": {
          const entries = await getAllEntries(db, proj.id);
          const summary = entries.map((e) => `- **${e.path}**: ${e.content.slice(0, 100)}...`).join("\n");
          return { content: [{ type: "text", text: `Project summary:\n\n${summary}` }] };
        }
      }
    },
  );
}
