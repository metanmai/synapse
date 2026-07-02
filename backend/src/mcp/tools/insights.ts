import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logActivity } from "../../db/activity-logger";
import { createInsight, listInsights } from "../../db/queries";

import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { mcpError, mcpResolveProject, mcpSuccess, requireMcpUserId } from "../mcp-context";

export function registerInsightTools(server: McpServer, _env: Env, getContext: GetMcpContext, db: SupabaseClient) {
  server.tool(
    "save_insight",
    "Save a key insight about a project — a decision, learning, preference, architecture note, or action item. BREVITY IS CRITICAL: `summary` MUST be ≤12 words (one short sentence). `detail` is optional and MUST be ≤2 sentences. Insights accumulate and clog future briefs if verbose. CONSOLIDATE AGGRESSIVELY: before saving, call `list_insights` to see existing IDs — if your new insight replaces, contradicts, or makes obsolete any existing ones, pass their IDs in `supersedes` so they are removed from future briefs. Saving without superseding when you should creates clutter.",
    {
      project: z.string().describe("Project name"),
      type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).describe("Type of insight"),
      summary: z.string().describe("Short summary of the insight (≤12 words)"),
      detail: z.string().optional().describe("Optional longer explanation (≤2 sentences)"),
      supersedes: z
        .array(z.string().uuid())
        .optional()
        .describe(
          "Optional list of insight IDs that this new insight replaces. The named insights will be marked as 'superseded' and excluded from future briefs.",
        ),
    },
    async ({ project, type, summary, detail, supersedes }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const insight = await createInsight(db, {
        project_id: proj.id,
        user_id: userId,
        type,
        summary,
        detail: detail ?? null,
        source: { type: "conversation", agent: "claude" },
        supersedes,
      });

      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "insight_created",
        source: "claude",
        metadata: { insight_id: insight.id, type },
      });

      const supersedeNote =
        supersedes && supersedes.length > 0 ? ` (superseded ${supersedes.length} prior insight(s))` : "";
      return mcpSuccess(`Saved ${type} insight: "${summary}"${supersedeNote}`);
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
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const { insights, total } = await listInsights(db, proj.id, {
        type,
        limit: limit ?? 20,
      });

      if (insights.length === 0) {
        const filterNote = type ? ` of type "${type}"` : "";
        return mcpError(`No insights${filterNote} found in project "${project}".`);
      }

      const lines = insights.map(
        (i) => `- [${i.type}] ${i.summary} (${new Date(i.updated_at).toLocaleDateString()}) [id: ${i.id}]`,
      );
      const header = type
        ? `${total} ${type} insight(s) in "${project}" (showing ${insights.length}):`
        : `${total} insight(s) in "${project}" (showing ${insights.length}):`;

      return {
        content: [{ type: "text" as const, text: `${header}\n${lines.join("\n")}` }],
      };
    },
  );
}
