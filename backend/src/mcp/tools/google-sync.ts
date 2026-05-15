import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { syncProjectFromGoogle } from "../../sync/from-google";
import { syncProjectToGoogle } from "../../sync/to-google";

import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { mcpError, mcpResolveProject, mcpSuccess, requireMcpUserId } from "../mcp-context";

export function registerGoogleSyncTools(server: McpServer, env: Env, getContext: GetMcpContext, db: SupabaseClient) {
  server.tool(
    "sync_to_google_docs",
    "Push all project context to the linked Google Drive folder. Requires Google Drive to be configured.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      try {
        const result = await syncProjectToGoogle(env, proj.id);
        return mcpSuccess(`Synced ${result.synced} entries to Google Drive.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return mcpError(`Sync failed: ${message}`);
      }
    },
  );

  server.tool(
    "sync_from_google_docs",
    "Pull changes from the linked Google Drive folder back into the project. Picks up files added or edited in Drive.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      const userId = requireMcpUserId(getContext);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      try {
        const result = await syncProjectFromGoogle(env, proj.id);
        return mcpSuccess(`Pulled ${result.synced} changed entries from Google Drive.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return mcpError(`Sync failed: ${message}`);
      }
    },
  );
}
