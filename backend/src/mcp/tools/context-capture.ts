import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logActivity } from "../../db/activity-logger";
import { upsertEntry } from "../../db/queries";

import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { mcpError, mcpResolveProject, mcpSuccess, requireMcpUserId } from "../mcp-context";

export function registerContextCaptureTools(
  server: McpServer,
  _env: Env,
  getContext: GetMcpContext,
  db: SupabaseClient,
) {
  server.tool(
    "save_context",
    "Save a piece of context (decision, convention, learning, etc.) to a project. Call this when a technical decision is made, an architecture pattern is discussed, or a team convention is established.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("Path within the project, e.g., 'decisions/chose-postgres.md'"),
      content: z.string().describe("The context content (markdown)"),
      tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
    },
    async ({ project, path, content, tags }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const entry = await upsertEntry(db, {
        project_id: proj.id,
        path,
        content,
        tags: tags ?? [],
        author_id: userId,
        source: "claude",
      });
      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "entry_created",
        target_path: path,
        source: "claude",
      });

      const action = entry.created_at === entry.updated_at ? "Created" : "Updated";
      return mcpSuccess(`${action} context at "${path}" in project "${project}".`);
    },
  );

  server.tool(
    "save_session_summary",
    "Save a summary of the current AI session. Call this at the end of a session to capture what was done, decisions made, and what's pending.",
    {
      project: z.string().describe("Project name"),
      summary: z.string().describe("Session summary text"),
      decisions: z.array(z.string()).optional().describe("Key decisions made during this session"),
      pending: z.array(z.string()).optional().describe("Pending items for follow-up"),
    },
    async ({ project, summary, decisions, pending }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const date = new Date().toISOString().split("T")[0];
      const slug = summary
        .slice(0, 40)
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase();
      const path = `context/session-summaries/${date}-${slug}.md`;

      // Build summary content
      let fullContent = `# Session Summary — ${date}\n\n${summary}`;
      if (pending?.length) {
        fullContent += `\n\n## Pending\n${pending.map((p) => `- ${p}`).join("\n")}`;
      }

      await upsertEntry(db, {
        project_id: proj.id,
        path,
        content: fullContent,
        tags: ["session-summary"],
        author_id: userId,
        source: "claude",
      });
      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "entry_created",
        target_path: path,
        source: "claude",
      });

      // Save individual decisions as separate entries
      if (decisions?.length) {
        for (const decision of decisions) {
          const decisionSlug = decision
            .slice(0, 40)
            .replace(/[^a-z0-9]+/gi, "-")
            .toLowerCase();
          await upsertEntry(db, {
            project_id: proj.id,
            path: `decisions/${date}-${decisionSlug}.md`,
            content: decision,
            tags: ["decision"],
            author_id: userId,
            source: "claude",
          });
        }
      }

      return mcpSuccess(`Session summary saved to "${path}". ${decisions?.length ?? 0} decisions also recorded.`);
    },
  );

  server.tool(
    "add_file",
    "Add a raw file (spec, doc, notes) to a project folder.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("Path within the project"),
      content: z.string().describe("File content"),
      content_type: z.enum(["markdown", "json"]).describe("Content type"),
    },
    async ({ project, path, content, content_type }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      await upsertEntry(db, {
        project_id: proj.id,
        path,
        content,
        content_type,
        author_id: userId,
        source: "human",
      });
      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "entry_created",
        target_path: path,
        source: "claude",
      });

      return mcpSuccess(`File added at "${path}" in project "${project}".`);
    },
  );
}
