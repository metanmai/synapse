import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { logActivity } from "../../db/activity-logger";
import { createSupabaseClient } from "../../db/client";
import { createInsight, getProjectByName, listInsights } from "../../db/queries";

import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { requireMcpUserId } from "../mcp-context";

export function registerInsightTools(server: McpServer, env: Env, getContext: GetMcpContext) {
  server.tool(
    "save_insight",
    "Save a key insight about a project — a decision, learning, preference, architecture note, or action item. Call this whenever something worth remembering comes up.",
    {
      project: z.string().describe("Project name"),
      type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).describe("Type of insight"),
      summary: z.string().describe("Short summary of the insight"),
      detail: z.string().optional().describe("Optional longer explanation or context"),
    },
    async ({ project, type, summary, detail }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }] };

      const insight = await createInsight(db, {
        project_id: proj.id,
        user_id: userId,
        type,
        summary,
        detail: detail ?? null,
        source: { type: "conversation", agent: "claude" },
      });

      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "insight_created",
        source: "claude",
        metadata: { insight_id: insight.id, type },
      });

      return {
        content: [{ type: "text" as const, text: `Saved ${type} insight: "${summary}"` }],
      };
    },
  );

  server.tool(
    "list_insights",
    "List insights for a project, optionally filtered by type. Returns insights sorted by most recently updated.",
    {
      project: z.string().describe("Project name"),
      type: z
        .enum(["decision", "learning", "preference", "architecture", "action_item"])
        .optional()
        .describe("Filter by insight type"),
      limit: z.number().optional().describe("Maximum number of insights to return (default 20)"),
    },
    async ({ project, type, limit }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }] };

      const { insights, total } = await listInsights(db, proj.id, {
        type,
        limit: limit ?? 20,
      });

      if (insights.length === 0) {
        const filterNote = type ? ` of type "${type}"` : "";
        return {
          content: [{ type: "text" as const, text: `No insights${filterNote} found in project "${project}".` }],
        };
      }

      const lines = insights.map((i) => `- [${i.type}] ${i.summary} (${new Date(i.updated_at).toLocaleDateString()})`);
      const header = type
        ? `${total} ${type} insight(s) in "${project}" (showing ${insights.length}):`
        : `${total} insight(s) in "${project}" (showing ${insights.length}):`;

      return {
        content: [{ type: "text" as const, text: `${header}\n${lines.join("\n")}` }],
      };
    },
  );
}
