import { API_URL } from "$env/static/private";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError(500, "API_URL is not configured. Set it in your environment variables.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_URL}${path}`;
  const method = options.method ?? "GET";
  console.log(`[api] ${method} ${url}`);

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    const message = isTimeout
      ? `API request timed out after 10s: ${method} ${path}`
      : `Cannot reach API at ${API_URL}${path}: ${err instanceof Error ? err.message : String(err)}`;
    throw new ApiError(503, message);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const detail = body.detail ? ` (${body.detail})` : "";
    throw new ApiError(res.status, `${method} ${path} → ${res.status}: ${body.error || res.statusText}${detail}`);
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
      request<import("$lib/types").ProjectMember>(`/api/projects/${projectId}/members`, token, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    updateMemberRole: (projectId: string, email: string, role: string) =>
      request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, token, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    removeMember: (projectId: string, email: string) =>
      request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, token, { method: "DELETE" }),

    // Share links
    createShareLink: (projectId: string, role: string, expiresAt?: string) =>
      request<import("$lib/types").ShareLink>(`/api/projects/${projectId}/share-links`, token, {
        method: "POST",
        body: JSON.stringify({ role, expires_at: expiresAt }),
      }),
    listShareLinks: (projectId: string) =>
      request<import("$lib/types").ShareLink[]>(`/api/projects/${projectId}/share-links`, token),
    deleteShareLink: (projectId: string, linkToken: string) =>
      request<void>(`/api/projects/${projectId}/share-links/${linkToken}`, token, { method: "DELETE" }),
    joinShareLink: (linkToken: string) =>
      request<{ message: string; role: string }>(`/api/share/${linkToken}/join`, token, { method: "POST" }),

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
      request<import("$lib/types").Entry>(`/api/context/${encodeURIComponent(project)}/restore`, token, {
        method: "POST",
        body: JSON.stringify({ path, historyId }),
      }),

    // Activity
    getActivity: (projectId: string, limit = 50, offset = 0) =>
      request<import("$lib/types").ActivityLogEntry[]>(
        `/api/projects/${projectId}/activity?limit=${limit}&offset=${offset}`,
        token,
      ),

    // Account — API Keys
    listApiKeys: () =>
      request<
        {
          id: string;
          label: string;
          expires_at: string | null;
          last_used_at: string | null;
          created_at: string;
        }[]
      >("/api/account/keys", token),
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
      request<Record<string, string>>(`/api/projects/preferences/${encodeURIComponent(project)}`, token, {
        method: "PUT",
        body: JSON.stringify({ key, value }),
      }),

    // Billing
    getBillingStatus: () =>
      request<{
        tier: "free" | "plus";
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
    verifyCheckout: (checkoutId: string) =>
      request<{ status: string }>("/api/billing/verify", token, {
        method: "POST",
        body: JSON.stringify({ checkout_id: checkoutId }),
      }),

    // Import/Export
    importProject: async (projectId: string, file: File) => {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
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

    // Insights
    listInsights: (projectId: string, type?: string, limit = 20, offset = 0) =>
      request<{ insights: import("$lib/types").InsightListItem[]; total: number }>(
        `/api/insights?project_id=${projectId}${type ? `&type=${type}` : ""}&limit=${limit}&offset=${offset}`,
        token,
      ),
    createInsight: (projectId: string, type: string, summary: string, detail?: string) =>
      request<import("$lib/types").Insight>("/api/insights", token, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, type, summary, detail }),
      }),
    updateInsight: (insightId: string, updates: { type?: string; summary?: string; detail?: string | null }) =>
      request<import("$lib/types").Insight>(`/api/insights/${insightId}`, token, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    deleteInsight: (insightId: string) =>
      request<{ ok: true }>(`/api/insights/${insightId}`, token, { method: "DELETE" }),

    // Conversations
    listConversations: (projectId: string, status?: string, limit = 20, offset = 0) =>
      request<{ conversations: import("$lib/types").ConversationListItem[]; total: number }>(
        `/api/conversations?project_id=${projectId}${status ? `&status=${status}` : ""}&limit=${limit}&offset=${offset}`,
        token,
      ),
    getConversation: (conversationId: string, fidelity?: string, page = 1, limit = 50) =>
      request<{
        conversation: import("$lib/types").Conversation;
        messages: import("$lib/types").ConversationMessage[];
        context: Record<string, unknown>[];
        media: import("$lib/types").ConversationMediaRecord[];
      }>(
        `/api/conversations/${conversationId}?${fidelity ? `fidelity=${fidelity}&` : ""}page=${page}&limit=${limit}`,
        token,
      ),
    createConversation: (projectId: string, title?: string) =>
      request<import("$lib/types").Conversation>("/api/conversations", token, {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, title }),
      }),
    updateConversation: (
      conversationId: string,
      updates: { title?: string; status?: string; fidelity_mode?: string },
    ) =>
      request<import("$lib/types").Conversation>(`/api/conversations/${conversationId}`, token, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    importConversation: (projectId: string, format: string, messages: unknown, title?: string) =>
      request<{ conversation: import("$lib/types").Conversation; messageCount: number }>(
        "/api/conversations/import",
        token,
        {
          method: "POST",
          body: JSON.stringify({ project_id: projectId, format, messages, title }),
        },
      ),
    exportConversation: (conversationId: string, format: string) =>
      request<{ conversation: Record<string, unknown>; messages: unknown; format: string }>(
        `/api/conversations/${conversationId}/export/${format}`,
        token,
      ),
    getMediaUrl: (conversationId: string, mediaId: string) =>
      request<{ url: string }>(`/api/conversations/${conversationId}/media/${mediaId}`, token),
  };
}
