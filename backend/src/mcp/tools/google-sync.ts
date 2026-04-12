import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createSupabaseClient } from "../../db/client";
import { getProjectByName } from "../../db/queries";
import { syncProjectFromGoogle } from "../../sync/from-google";
import { syncProjectToGoogle } from "../../sync/to-google";

import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { requireMcpUserId } from "../mcp-context";

export function registerGoogleSyncTools(server: McpServer, env: Env, getContext: GetMcpContext) {
  server.tool(
    "sync_to_google_docs",
    "Push all project context to the linked Google Drive folder. Requires Google Drive to be configured.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      try {
        const result = await syncProjectToGoogle(env, proj.id);
        return {
          content: [{ type: "text", text: `Synced ${result.synced} entries to Google Drive.` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Sync failed: ${message}` }],
        };
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
      const db = createSupabaseClient(env);
      const userId = requireMcpUserId(getContext);

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      try {
        const result = await syncProjectFromGoogle(env, proj.id);
        return {
          content: [{ type: "text", text: `Pulled ${result.synced} changed entries from Google Drive.` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Sync failed: ${message}` }],
        };
      }
    },
  );
}
