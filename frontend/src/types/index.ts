export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  google_drive_folder_id: string | null;
  created_at: string;
  project_members?: ProjectMember[];
}

export interface Entry {
  id: string;
  project_id: string;
  path: string;
  content: string;
  content_type: "markdown" | "json";
  author_id: string | null;
  source: string;
  tags: string[];
  google_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryListItem {
  path: string;
  content_type: string;
  tags: string[];
  updated_at: string;
}

export interface EntryHistory {
  id: string;
  entry_id: string;
  content: string;
  source: string;
  changed_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
  email?: string;
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
  source: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
