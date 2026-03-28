import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { createSupabaseClient } from "../../db/client";
import { getProjectByName } from "../../db/queries/projects";
import { upsertEntry } from "../../db/queries/entries";
import { logActivity } from "../../db/activity-logger";

export function registerContextCaptureTools(server: McpServer, env: Env, getContext: GetMcpContext) {
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
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

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
      return {
        content: [{ type: "text", text: `${action} context at "${path}" in project "${project}".` }],
      };
    }
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
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const date = new Date().toISOString().split("T")[0];
      const slug = summary.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
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
          const decisionSlug = decision.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
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

      return {
        content: [{ type: "text", text: `Session summary saved to "${path}". ${decisions?.length ?? 0} decisions also recorded.` }],
      };
    }
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
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

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

      return {
        content: [{ type: "text", text: `File added at "${path}" in project "${project}".` }],
      };
    }
  );
}
