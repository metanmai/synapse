// Re-export shared types used directly by the frontend
export type {
  User,
  Entry,
  EntryListItem,
  EntryHistory,
  ShareLink,
  ActivityLogEntry,
} from "@synapse/shared";

// --- Frontend-specific types ---
// These extend the shared base with optional fields populated by API joins.
// We define them locally rather than re-exporting from shared because
// the frontend shapes include join fields (owner_email, role, email, etc.)
// that don't exist in the base API contract.

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  owner_email?: string;
  role?: string;
  google_drive_folder_id: string | null;
  created_at: string;
  project_members?: ProjectMember[];
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
  email?: string;
}
