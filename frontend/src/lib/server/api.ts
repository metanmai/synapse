import { env } from "$env/dynamic/private";

const API_URL = env.API_URL;

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

    // Cross-device link / merge (Phase 2 IDENT-02 D-07)
    mergeProjects: (sourceProjectId: string, targetProjectId: string) =>
      request<{ ok: true; project_id: string }>(
        `/api/projects/${sourceProjectId}/merge-into/${targetProjectId}`,
        token,
        { method: "POST" },
      ),
    // Returns auto-match candidates by shared git_remote_url. Backend doesn't
    // yet expose `matched_by_remote` in the projects-list response; for now
    // this returns an empty list and the LinkPicker simply omits the
    // "Suggested matches" section. Wire up the real surface when the
    // backend match-candidates endpoint lands.
    listLinkCandidates: (
      _sourceProjectName: string,
    ): Promise<
      Array<{
        id: string;
        name: string;
        conversation_count: number;
        last_activity?: string;
        matched_by_remote: boolean;
      }>
    > => Promise.resolve([]),
    updateMemberRole: (projectId: string, email: string, role: string) =>
      request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, token, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    removeMember: (projectId: string, email: string) =>
      request<void>(`/api/projects/${projectId}/members/${encodeURIComponent(email)}`, token, { method: "DELETE" }),

    // Share links
    joinShareLink: (linkToken: string) =>
      request<{ message: string; role: string }>(`/api/share/${linkToken}/join`, token, { method: "POST" }),

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
    resetAccount: () =>
      request<{ ok: true; api_key: string }>("/api/account/reset", token, {
        method: "POST",
      }),
    deleteAccount: () =>
      request<{ ok: true }>("/api/account", token, {
        method: "DELETE",
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

    // Insights
    listInsights: (projectId: string, type?: string, limit = 20, offset = 0) =>
      request<{ insights: import("$lib/types").InsightListItem[]; total: number }>(
        `/api/insights?project_id=${projectId}${type ? `&type=${type}` : ""}&limit=${limit}&offset=${offset}`,
        token,
      ),
    // Conversations
    listConversations: (projectId: string, status?: string, limit = 20, offset = 0) =>
      request<{ conversations: import("$lib/types").ConversationListItem[]; total: number }>(
        `/api/conversations?project_id=${projectId}${status ? `&status=${status}` : ""}&limit=${limit}&offset=${offset}`,
        token,
      ),
    getConversation: (conversationId: string, fidelity?: string, fromSequence?: number, msgLimit = 200) =>
      request<{
        conversation: import("$lib/types").Conversation;
        messages: import("$lib/types").ConversationMessage[];
        context: Record<string, unknown>[];
        media: import("$lib/types").ConversationMediaRecord[];
      }>(
        `/api/conversations/${conversationId}?${fidelity ? `fidelity=${fidelity}&` : ""}${fromSequence ? `from_sequence=${fromSequence}&` : ""}msg_limit=${msgLimit}`,
        token,
      ),
    updateConversation: (
      conversationId: string,
      updates: { title?: string; status?: string; fidelity_mode?: string },
    ) =>
      request<import("$lib/types").Conversation>(`/api/conversations/${conversationId}`, token, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),
    exportConversation: (conversationId: string, format: string) =>
      request<{ conversation: Record<string, unknown>; messages: unknown; format: string }>(
        `/api/conversations/${conversationId}/export/${format}`,
        token,
      ),

    // Compaction
    compactConversation: (conversationId: string) =>
      request<{
        compacted_summary: string;
        compacted_at: string;
        compaction_model: string;
        message_count: number;
      }>(`/api/conversations/${conversationId}/compact`, token, {
        method: "POST",
      }),
    getProjectContext: (projectId: string) =>
      request<{
        summary: string | null;
        conversation_count?: number;
        model?: string | null;
        updated_at?: string;
        source?: string;
        upgrade_hint?: string;
        message?: string;
      }>(`/api/projects/${projectId}/context`, token),
  };
}
