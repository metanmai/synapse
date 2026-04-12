import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntry, listEntries } from "../db/queries/entries";
import type { Env } from "../lib/env";

export function registerResources(server: McpServer, _env: Env, db: SupabaseClient) {
  // Resource templates for project tree and individual entries
  server.resource(
    "project-tree",
    new ResourceTemplate("context://{project}/tree", { list: undefined }),
    { description: "Browse the full folder tree of a project" },
    async (uri: URL) => {
      const project = uri.pathname.split("/")[1];

      // Note: resource access doesn't have auth context in MCP protocol.
      // For now, list all entries. Auth is handled at the transport level.
      const { data: proj } = await db.from("projects").select("id").eq("name", project).single();

      if (!proj) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Project not found" }] };
      }

      const entries = await listEntries(db, proj.id);
      const tree = entries.map((e) => e.path).join("\n");

      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: tree }],
      };
    },
  );

  // Resource template for individual entry content
  server.resource(
    "project-entry",
    new ResourceTemplate("context://{project}/{path}", { list: undefined }),
    { description: "Read a specific context entry by project name and path" },
    async (uri: URL) => {
      const parts = uri.pathname.split("/");
      const project = parts[1];
      const path = parts.slice(2).join("/");

      const { data: proj } = await db.from("projects").select("id").eq("name", project).single();

      if (!proj) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Project not found" }] };
      }

      const entry = await getEntry(db, proj.id, path);
      if (!entry) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Entry not found" }] };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: entry.content_type === "json" ? "application/json" : "text/markdown",
            text: entry.content,
          },
        ],
      };
    },
  );
}
