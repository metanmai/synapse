import type { GetMcpContext } from "./agent";

/** Resolves authenticated user id from MCP tool context; throws if missing. */
export function requireMcpUserId(getContext: GetMcpContext): string {
  const userId = getContext().userId;
  if (userId === null) {
    throw new Error("Unauthorized: MCP request missing valid API key");
  }
  return userId;
}
