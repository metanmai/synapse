import type { SupabaseClient } from "@supabase/supabase-js";
import { getProjectByName } from "../db/queries";
import type { Project } from "../db/types";
import type { GetMcpContext } from "./agent";

/** Resolves authenticated user id from MCP tool context; throws if missing. */
export function requireMcpUserId(getContext: GetMcpContext): string {
  const userId = getContext().userId;
  if (userId === null) {
    throw new Error("Unauthorized: MCP request missing valid API key");
  }
  return userId;
}

/** Build a simple MCP error response. */
export function mcpError(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

/** Build a simple MCP success response. */
export function mcpSuccess(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

/** Resolve a project by name for the given user. Returns null if not found. */
export async function mcpResolveProject(
  db: SupabaseClient,
  projectName: string,
  userId: string,
): Promise<Project | null> {
  return getProjectByName(db, projectName, userId);
}
