export interface Env {
  // Infrastructure
  MCP_OBJECT: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;

  // OAuth
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // CORS — comma-separated allowed origins
  // Default: "http://localhost:5173,https://synapsesync.app"
  CORS_ORIGINS?: string;

  // App URLs
  APP_URL?: string; // Default: "https://synapsesync.app"

  // Tier limits
  TIER_FREE_MAX_FILES?: string; // Default: "50"
  TIER_FREE_MAX_CONNECTIONS?: string; // Default: "3"
  TIER_FREE_MAX_HISTORY?: string; // Default: "3" (last 3 versions)
  TIER_FREE_MAX_MEMBERS?: string; // Default: "2" (share with up to 2 others)
  TIER_PLUS_MAX_FILES?: string; // Default: "500"
  TIER_PLUS_MAX_CONNECTIONS?: string; // Default: "0" (unlimited)
  TIER_PLUS_PRICE?: string; // Default: "5.99"

  // Creem
  CREEM_API_KEY: string;
  CREEM_WEBHOOK_SECRET: string;
  CREEM_PRO_PRODUCT_ID: string;

  // Valid sources for entries
  VALID_SOURCES?: string; // Default: "human,claude,chatgpt,cursor,copilot,windsurf,google_docs"

  // Activity log defaults
  ACTIVITY_PAGE_LIMIT?: string; // Default: "50"

  // Embedding service (optional — semantic search degrades gracefully without it)
  EMBEDDING_SERVICE_URL?: string;
  EMBEDDING_SERVICE_KEY?: string;
}

// Helper to read env with defaults
export function envOr(env: Env, key: keyof Env, fallback: string): string {
  return (env[key] as string) ?? fallback;
}

export function envList(env: Env, key: keyof Env, fallback: string): string[] {
  const val = (env[key] as string) ?? fallback;
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
