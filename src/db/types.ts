export interface User {
  id: string;
  email: string;
  api_key_hash: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
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
