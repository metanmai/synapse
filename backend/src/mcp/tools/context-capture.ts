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
