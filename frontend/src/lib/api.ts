import { supabase } from "./supabase";

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
  listProjects: () => request<any[]>("/api/projects"),
  createProject: (name: string) => request<any>("/api/projects", {
    method: "POST", body: JSON.stringify({ name }),
  }),

  // Project members
  addMember: (projectId: string, email: string, role: string) =>
    request<any>(`/api/projects/${projectId}/members`, {
      method: "POST", body: JSON.stringify({ email, role }),
    }),
  removeMember: (projectId: string, email: string) =>
    request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, {
      method: "DELETE",
    }),

  // Share links
  createShareLink: (projectId: string, role: string, expiresAt?: string) =>
    request<any>(`/api/projects/${projectId}/share-links`, {
      method: "POST", body: JSON.stringify({ role, expires_at: expiresAt }),
    }),
  listShareLinks: (projectId: string) =>
    request<any[]>(`/api/projects/${projectId}/share-links`),
  deleteShareLink: (projectId: string, token: string) =>
    request<void>(`/api/projects/${projectId}/share-links/${token}`, {
      method: "DELETE",
    }),
  joinShareLink: (token: string) =>
    request<any>(`/api/share/${token}/join`, { method: "POST" }),

  // Context entries
  listEntries: (project: string, folder?: string) =>
    request<any[]>(`/api/context/${encodeURIComponent(project)}/list${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`),
  getEntry: (project: string, path: string) =>
    request<any>(`/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`),
  saveEntry: (project: string, path: string, content: string, tags?: string[]) =>
    request<any>("/api/context/save", {
      method: "POST", body: JSON.stringify({ project, path, content, tags }),
    }),
  searchEntries: (project: string, query: string) =>
    request<any[]>(`/api/context/${encodeURIComponent(project)}/search?q=${encodeURIComponent(query)}`),

  // History
  getEntryHistory: (project: string, path: string) =>
    request<any[]>(`/api/context/${encodeURIComponent(project)}/history/${encodeURIComponent(path)}`),
  restoreEntry: (project: string, path: string, historyId: string) =>
    request<any>(`/api/context/${encodeURIComponent(project)}/restore`, {
      method: "POST", body: JSON.stringify({ path, historyId }),
    }),

  // Activity
  getActivity: (projectId: string, limit = 50, offset = 0) =>
    request<any[]>(`/api/projects/${projectId}/activity?limit=${limit}&offset=${offset}`),

  // Account
  regenerateApiKey: () => request<{ api_key: string }>("/api/account/regenerate-key", {
    method: "POST",
  }),

  // Preferences
  setPreference: (project: string, key: string, value: string) =>
    request<any>(`/api/projects/preferences/${encodeURIComponent(project)}`, {
      method: "PUT", body: JSON.stringify({ key, value }),
    }),
};
