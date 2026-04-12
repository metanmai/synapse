// Re-export shared API contract types
export type {
  Tier,
  User,
  Project,
  Entry,
  EntryListItem,
  EntryHistory,
  ProjectMember,
  ShareLink,
  ActivityLogEntry,
} from "@synapse/shared";

// --- Backend-only types (not part of the API contract) ---

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Full database row for users — includes fields not sent to API clients.
 * Use this for anything that touches the DB directly (queries, auth middleware).
 * Use `User` (from shared) for API response types.
 */
export interface UserRow {
  id: string;
  email: string;
  supabase_auth_id: string | null;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}

export interface UserPreferences {
  user_id: string;
  project_id: string;
  auto_capture: "aggressive" | "moderate" | "manual_only";
  context_loading: "full" | "smart" | "on_demand" | "summary_only";
}

export interface Subscription {
  id: string;
  user_id: string;
  provider: string;
  provider_subscription_id: string;
  provider_customer_id: string | null;
  status: "active" | "canceled" | "past_due" | "inactive";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export type { Insight, InsightListItem, InsightType, InsightSource } from "@synapse/shared";

// Default tier limits — can be overridden by env vars
export function getTierLimitsFromEnv(env?: Record<string, string>) {
  return {
    free: {
      maxFiles: Number.parseInt(env?.TIER_FREE_MAX_FILES ?? "50"),
      maxConnections: Number.parseInt(env?.TIER_FREE_MAX_CONNECTIONS ?? "3"),
      maxHistoryVersions: Number.parseInt(env?.TIER_FREE_MAX_HISTORY ?? "3"),
      maxMembers: Number.parseInt(env?.TIER_FREE_MAX_MEMBERS ?? "2"),
    },
    plus: {
      maxFiles: Number.parseInt(env?.TIER_PLUS_MAX_FILES ?? "500"),
      maxConnections: Number.parseInt(env?.TIER_PLUS_MAX_CONNECTIONS ?? "0"),
      maxHistoryVersions: -1,
      maxMembers: 0,
    },
  };
}
