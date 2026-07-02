import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  getAllEntries,
  getPreferences,
  getProjectContext,
  getRecentCompactedSummaries,
  getRecentEntries,
  listEntries,
  searchEntries,
  searchInsights,
} from "../../db/queries";

import { embedTexts, embeddingConfigFromEnv } from "../../lib/embeddings";
import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { mcpError, mcpResolveProject, requireMcpUserId } from "../mcp-context";

export function registerContextRetrievalTools(
  server: McpServer,
  env: Env,
  getContext: GetMcpContext,
  db: SupabaseClient,
) {
  server.tool(
    "get_context",
    "Get the aggregated project context summary. Returns a dense summary of all recent work on the project — decisions, architecture, current state. This is the primary way to load project knowledge.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      // Try aggregated project context first
      const projectContext = await getProjectContext(db, proj.id);
      if (projectContext?.summary) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Project Context: ${project}\n\nUpdated: ${projectContext.updated_at}\nConversations: ${projectContext.conversation_count}\nModel: ${projectContext.model}\n\n${projectContext.summary}`,
            },
          ],
        };
      }

      // Fall back to recent compacted conversation summaries
      const compacted = await getRecentCompactedSummaries(db, proj.id, 5);
      if (compacted.length > 0) {
        const joined = compacted
          .map((c) => `## ${c.title ?? "Conversation"}\nCompacted: ${c.compacted_at}\n\n${c.compacted_summary}`)
          .join("\n\n---\n\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `# Project Context: ${project} (from ${compacted.length} recent conversations)\n\n${joined}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `No aggregated context available yet for "${project}". Context will appear automatically as conversations are compacted.`,
          },
        ],
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
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      // Embed the query for semantic search
      const config = embeddingConfigFromEnv(env);
      const vectors = await embedTexts([query], "search_query", config);
      const queryEmbedding = vectors?.[0] ?? null;

      const [results, insights] = await Promise.all([
        searchEntries(db, proj.id, query, { tags, folder }, queryEmbedding),
        searchInsights(db, proj.id, query),
      ]);

      if (!results.length && !insights.length) {
        return mcpError(`No results found for "${query}".`);
      }

      let output = "";

      if (results.length) {
        const formatted = results
          .map(
            (e) =>
              `### ${e.path}\n*Tags: ${e.tags.join(", ") || "none"}*\n\n${e.content.slice(0, 500)}${e.content.length > 500 ? "..." : ""}`,
          )
          .join("\n\n---\n\n");

        output += `Found ${results.length} result(s):\n\n${formatted}`;
      }

      if (insights.length) {
        const formattedInsights = insights
          .map((i) => {
            const detail = i.detail ? `\n    ${i.detail}` : "";
            return `  [${i.type}] ${i.summary}${detail}`;
          })
          .join("\n");

        if (output) output += "\n\n---\n\n";
        output += `**Key Insights:**\n${formattedInsights}`;
      }

      return {
        content: [{ type: "text", text: output }],
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
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const entries = await listEntries(db, proj.id, folder);

      if (!entries.length) {
        return mcpError(folder ? `No entries in "${folder}".` : "Project is empty.");
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
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

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
