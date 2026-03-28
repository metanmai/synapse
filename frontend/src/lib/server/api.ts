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
  if (!API_URL) {
    throw new ApiError(500, `API_URL is not configured. Set it in your environment variables.`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = `${API_URL}${path}`;
  const method = options.method ?? "GET";
  console.log(`[api] ${method} ${url}`);

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new ApiError(503, `Cannot reach API at ${API_URL}${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const detail = body.detail ? ` (${body.detail})` : "";
    throw new ApiError(
      res.status,
      `${method} ${path} → ${res.status}: ${body.error || res.statusText}${detail}`
    );
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

    // Account — API Keys
    listApiKeys: () =>
      request<{
        id: string;
        label: string;
        expires_at: string | null;
        last_used_at: string | null;
        created_at: string;
      }[]>("/api/account/keys", token),
    createApiKey: (label: string, expiresAt?: string | null) =>
      request<{
        id: string;
        label: string;
        api_key: string;
        expires_at: string | null;
        created_at: string;
      }>("/api/account/keys", token, {
        method: "POST",
        body: JSON.stringify({ label, expires_at: expiresAt }),
      }),
    revokeApiKey: (keyId: string) =>
      request<{ ok: true }>(`/api/account/keys/${keyId}`, token, {
        method: "DELETE",
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

    // Import/Export
    importProject: async (projectId: string, file: File) => {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API_URL}/api/projects/${projectId}/import`, {
        method: "POST",
        headers,
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new ApiError(res.status, data.error || `Import failed: ${res.status}`);
      }
      return res.json() as Promise<{ imported: number; updated: number; skipped: number }>;
    },
  };
}
