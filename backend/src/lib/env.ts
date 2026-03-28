export interface Env {
  // Infrastructure
  MCP_OBJECT: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // OAuth
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // CORS — comma-separated allowed origins
  // Default: "http://localhost:5173,https://app.synapse.dev"
  CORS_ORIGINS?: string;

  // App URLs
  APP_URL?: string; // Default: "https://app.synapse.dev"

  // Tier limits
  TIER_FREE_MAX_FILES?: string;       // Default: "50"
  TIER_FREE_MAX_CONNECTIONS?: string;  // Default: "3"
  TIER_PRO_MAX_FILES?: string;         // Default: "500"
  TIER_PRO_MAX_CONNECTIONS?: string;   // Default: "0" (unlimited)
  TIER_PRO_PRICE?: string;             // Default: "5.99"

  // Valid sources for entries
  VALID_SOURCES?: string; // Default: "human,claude,chatgpt,cursor,copilot,windsurf,google_docs"

  // Activity log defaults
  ACTIVITY_PAGE_LIMIT?: string; // Default: "50"
}

// Helper to read env with defaults
export function envOr(env: Env, key: keyof Env, fallback: string): string {
  return (env[key] as string) ?? fallback;
}

export function envList(env: Env, key: keyof Env, fallback: string): string[] {
  const val = (env[key] as string) ?? fallback;
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}
