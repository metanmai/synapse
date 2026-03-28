import { API_URL } from "$env/static/private";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_URL}${path}`;
  console.log(`[api] ${options.method ?? "GET"} ${url}`);
  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export function createApi(token: string | null) {
  return {
    // Projects
    listProjects: () => request<import("$lib/types").Project[]>("/api/projects", token),
    createProject: (name: string) =>
      request<import("$lib/types").Project>("/api/projects", token, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),

    // Members
    addMember: (projectId: string, email: string, role: string) =>
      request<import("$lib/types").ProjectMember>(
        `/api/projects/${projectId}/members`,
        token,
        { method: "POST", body: JSON.stringify({ email, role }) },
      ),
    removeMember: (projectId: string, email: string) =>
      request<void>(
        `/api/projects/${projectId}/members/${encodeURIComponent(email)}`,
        token,
        { method: "DELETE" },
      ),

    // Share links
    createShareLink: (projectId: string, role: string, expiresAt?: string) =>
      request<import("$lib/types").ShareLink>(
        `/api/projects/${projectId}/share-links`,
        token,
        { method: "POST", body: JSON.stringify({ role, expires_at: expiresAt }) },
      ),
    listShareLinks: (projectId: string) =>
      request<import("$lib/types").ShareLink[]>(
        `/api/projects/${projectId}/share-links`,
        token,
      ),
    deleteShareLink: (projectId: string, linkToken: string) =>
      request<void>(
        `/api/projects/${projectId}/share-links/${linkToken}`,
        token,
        { method: "DELETE" },
      ),
    joinShareLink: (linkToken: string) =>
      request<{ message: string; role: string }>(
        `/api/share/${linkToken}/join`,
        token,
        { method: "POST" },
      ),

    // Entries
    listEntries: (project: string, folder?: string) =>
      request<import("$lib/types").EntryListItem[]>(
        `/api/context/${encodeURIComponent(project)}/list${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
        token,
      ),
    getEntry: (project: string, path: string) =>
      request<import("$lib/types").Entry>(
        `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`,
        token,
      ),
    saveEntry: (project: string, path: string, content: string, tags?: string[]) =>
      request<import("$lib/types").Entry>("/api/context/save", token, {
        method: "POST",
        body: JSON.stringify({ project, path, content, tags }),
      }),
    searchEntries: (project: string, query: string) =>
      request<import("$lib/types").Entry[]>(
        `/api/context/${encodeURIComponent(project)}/search?q=${encodeURIComponent(query)}`,
        token,
      ),

    // History
    getEntryHistory: (project: string, path: string) =>
      request<import("$lib/types").EntryHistory[]>(
        `/api/context/${encodeURIComponent(project)}/history/${encodeURIComponent(path)}`,
        token,
      ),
    restoreEntry: (project: string, path: string, historyId: string) =>
      request<import("$lib/types").Entry>(
        `/api/context/${encodeURIComponent(project)}/restore`,
        token,
        { method: "POST", body: JSON.stringify({ path, historyId }) },
      ),

    // Activity
    getActivity: (projectId: string, limit = 50, offset = 0) =>
      request<import("$lib/types").ActivityLogEntry[]>(
        `/api/projects/${projectId}/activity?limit=${limit}&offset=${offset}`,
        token,
      ),

    // Account
    regenerateApiKey: () =>
      request<{ api_key: string }>("/api/account/regenerate-key", token, {
        method: "POST",
      }),

    // Preferences
    setPreference: (project: string, key: string, value: string) =>
      request<Record<string, string>>(
        `/api/projects/preferences/${encodeURIComponent(project)}`,
        token,
        { method: "PUT", body: JSON.stringify({ key, value }) },
      ),

    // Billing
    getBillingStatus: () =>
      request<{
        tier: "free" | "pro";
        subscription: {
          status: string;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
        } | null;
      }>("/api/billing/status", token),
    createCheckout: () =>
      request<{ url: string }>("/api/billing/checkout", token, {
        method: "POST",
      }),
    createPortalSession: () =>
      request<{ url: string }>("/api/billing/portal", token, {
        method: "POST",
      }),
  };
}
