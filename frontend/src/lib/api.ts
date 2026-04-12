import { supabase } from "./supabase";
import type { Project, Entry, EntryListItem, EntryHistory, ShareLink, ActivityLogEntry, ProjectMember } from "../types";

const API_URL = import.meta.env.VITE_API_URL;

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await getAuthHeader()),
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Projects
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name: string) => request<Project>("/api/projects", {
    method: "POST", body: JSON.stringify({ name }),
  }),

  // Project members
  addMember: (projectId: string, email: string, role: string) =>
    request<ProjectMember>(`/api/projects/${projectId}/members`, {
      method: "POST", body: JSON.stringify({ email, role }),
    }),
  removeMember: (projectId: string, email: string) =>
    request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, {
      method: "DELETE",
    }),

  // Share links
  createShareLink: (projectId: string, role: string, expiresAt?: string) =>
    request<ShareLink>(`/api/projects/${projectId}/share-links`, {
      method: "POST", body: JSON.stringify({ role, expires_at: expiresAt }),
    }),
  listShareLinks: (projectId: string) =>
    request<ShareLink[]>(`/api/projects/${projectId}/share-links`),
  deleteShareLink: (projectId: string, token: string) =>
    request<void>(`/api/projects/${projectId}/share-links/${token}`, {
      method: "DELETE",
    }),
  joinShareLink: (token: string) =>
    request<{ message: string; role: string }>(`/api/share/${token}/join`, { method: "POST" }),

  // Context entries
  listEntries: (project: string, folder?: string) =>
    request<EntryListItem[]>(`/api/context/${encodeURIComponent(project)}/list${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`),
  getEntry: (project: string, path: string) =>
    request<Entry>(`/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`),
  saveEntry: (project: string, path: string, content: string, tags?: string[]) =>
    request<Entry>("/api/context/save", {
      method: "POST", body: JSON.stringify({ project, path, content, tags }),
    }),
  searchEntries: (project: string, query: string) =>
    request<Entry[]>(`/api/context/${encodeURIComponent(project)}/search?q=${encodeURIComponent(query)}`),

  // History
  getEntryHistory: (project: string, path: string) =>
    request<EntryHistory[]>(`/api/context/${encodeURIComponent(project)}/history/${encodeURIComponent(path)}`),
  restoreEntry: (project: string, path: string, historyId: string) =>
    request<Entry>(`/api/context/${encodeURIComponent(project)}/restore`, {
      method: "POST", body: JSON.stringify({ path, historyId }),
    }),

  // Activity
  getActivity: (projectId: string, limit = 50, offset = 0) =>
    request<ActivityLogEntry[]>(`/api/projects/${projectId}/activity?limit=${limit}&offset=${offset}`),

  // Account
  regenerateApiKey: () => request<{ api_key: string }>("/api/account/regenerate-key", {
    method: "POST",
  }),

  // Preferences
  setPreference: (project: string, key: string, value: string) =>
    request<{ auto_capture?: string; context_loading?: string }>(`/api/projects/preferences/${encodeURIComponent(project)}`, {
      method: "PUT", body: JSON.stringify({ key, value }),
    }),
};
