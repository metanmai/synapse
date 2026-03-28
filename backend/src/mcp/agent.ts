import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash } from "../db/queries";
import { hashApiKey } from "../lib/auth";

import type { Env } from "../lib/env";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import { registerContextCaptureTools } from "./tools/context-capture";
import { registerContextRetrievalTools } from "./tools/context-retrieval";
import { registerGoogleSyncTools } from "./tools/google-sync";
import { registerProjectManagementTools } from "./tools/project-management";

/* McpAgent expects the SDK copy bundled inside `agents`; our top-level McpServer is a different nominal type. */
type AnyMcpAgent = any;

type McpAgentWithRequest = {
  env: Env;
  request?: { headers: { get(name: string): string | null } };
  ctx?: { request?: { headers: { get(name: string): string | null } } };
};

export class SynapseAgent extends (McpAgent as AnyMcpAgent) {
  server = new McpServer({
    name: "synapse",
    version: "1.0.0",
  });

  // Authenticated user ID, resolved from Authorization header on init
  private userId: string | null = null;

  async init() {
    // Authenticate from the request's Authorization header.
    // The MCP HTTP transport passes the original request to the Durable Object.
    // Extract the Bearer token and resolve the user.
    const self = this as unknown as McpAgentWithRequest;
    const authHeader = self.request?.headers?.get("Authorization") ?? self.ctx?.request?.headers?.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const apiKey = authHeader.slice(7);
      const apiKeyHash = await hashApiKey(apiKey);
      const db = createSupabaseClient(self.env);
      const result = await findUserByApiKeyHash(db, apiKeyHash);
      if (result) {
        this.userId = result.user.id;
      }
    }

    const env: Env = self.env;

    // Pass userId getter to all tool registrations via a context object
    const getContext = () => ({ userId: this.userId });

    registerProjectManagementTools(this.server, env, getContext);
    registerContextCaptureTools(this.server, env, getContext);
    registerContextRetrievalTools(this.server, env, getContext);
    registerGoogleSyncTools(this.server, env, getContext);
    registerPrompts(this.server, env);
    registerResources(this.server, env);
  }
}

// Type for the context getter passed to tool registration functions
export type GetMcpContext = () => { userId: string | null };
