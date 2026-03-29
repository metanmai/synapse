export type Tier = "free" | "pro";

export interface User {
  id: string;
  email: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}

// Default tier limits — can be overridden by env vars:
// TIER_FREE_MAX_FILES, TIER_FREE_MAX_CONNECTIONS
// TIER_PRO_MAX_FILES, TIER_PRO_MAX_CONNECTIONS
export function getTierLimitsFromEnv(env?: Record<string, string>) {
  return {
    free: {
      maxFiles: parseInt(env?.TIER_FREE_MAX_FILES ?? "50"),
      maxConnections: parseInt(env?.TIER_FREE_MAX_CONNECTIONS ?? "3"),
      maxHistoryVersions: parseInt(env?.TIER_FREE_MAX_HISTORY ?? "3"), // 0 = none, -1 = unlimited
      maxMembers: parseInt(env?.TIER_FREE_MAX_MEMBERS ?? "2"), // 0 = unlimited
    },
    pro: {
      maxFiles: parseInt(env?.TIER_PRO_MAX_FILES ?? "500"),
      maxConnections: parseInt(env?.TIER_PRO_MAX_CONNECTIONS ?? "0"), // 0 = unlimited
      maxHistoryVersions: -1, // unlimited
      maxMembers: 0, // unlimited
    },
  };
}

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  google_drive_folder_id: string | null;
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
}

export interface Entry {
  id: string;
  project_id: string;
  path: string;
  content: string;
  content_type: "markdown" | "json";
  author_id: string | null;
  source: "claude" | "chatgpt" | "human" | "google_docs";
  tags: string[];
  google_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryHistory {
  id: string;
  entry_id: string;
  content: string;
  source: string;
  changed_at: string;
}

export interface UserPreferences {
  user_id: string;
  project_id: string;
  auto_capture: "aggressive" | "moderate" | "manual_only";
  context_loading: "full" | "smart" | "on_demand" | "summary_only";
}

export interface ShareLink {
  id: string;
  project_id: string;
  token: string;
  role: "editor" | "viewer";
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  project_id: string;
  user_id: string | null;
  action: string;
  target_path: string | null;
  target_email: string | null;
  source: "claude" | "chatgpt" | "human" | "google_docs";
  metadata: Record<string, unknown> | null;
  created_at: string;
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
