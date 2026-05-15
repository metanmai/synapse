/**
 * End-to-end roundtrip tests against the live Synapse API.
 *
 * Full user journey — every scenario a real user would hit:
 *   Auth → Projects → Context CRUD → Search → History → Restore →
 *   API Key Management → Billing → Activity Log → Insights →
 *   Conversations → Account Deletion
 *
 * Run:  TEST_E2E=1 npm run test:e2e
 *
 * Requires secrets: TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_KEY
 * Optional: TEST_API_URL (defaults to https://api.synapsesync.app)
 *
 * Test user is created via Supabase admin (bypasses email OTP rate limits).
 * User is fully deleted at the end — zero leftover data.
 */
import { afterAll, describe, expect, it } from "vitest";

const API = process.env.TEST_API_URL || "https://api.synapsesync.app";
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || "";
const RUN = process.env.TEST_E2E === "1";
const suite = RUN ? describe : describe.skip;

// biome-ignore lint/suspicious/noExplicitAny: dynamic API responses
type R = Record<string, any>;

async function api(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: R }> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as R };
}

/** Create a test user via Supabase admin, then use signup+verify or direct key creation. */
async function createTestUser(email: string): Promise<{ apiKey: string; userId: string }> {
  // 1. Create auto-confirmed Supabase auth user with a password (no email sent)
  const password = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });
  if (!authRes.ok) {
    throw new Error(`Failed to create Supabase auth user: ${authRes.status} ${await authRes.text()}`);
  }

  // 2. Login via the backend's /auth/login endpoint — this creates the public.users row + API key
  const { status, data } = await api("POST", "/auth/login", undefined, { email, password, label: "default" });
  if (status !== 200 || !data.api_key) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }

  return { apiKey: data.api_key, userId: data.id };
}

// ── shared state ──
let KEY: string;
let USER_ID: string;
let EMAIL: string;
let PROJECT_NAME: string;
let PROJECT_ID: string;
let SECOND_KEY: string;
let SECOND_KEY_ID: string;
let HISTORY_ID: string;

suite("Full User Journey", () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  SETUP — create test user via admin
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Setup", () => {
    it("creates a verified test user", async () => {
      EMAIL = `e2e-${Date.now()}@synapsesync.app`;
      const result = await createTestUser(EMAIL);
      KEY = result.apiKey;
      USER_ID = result.userId;
      expect(KEY).toBeTruthy();
      expect(USER_ID).toBeTruthy();
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — Signup validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: Signup validation", () => {
    it("signup does not return an API key (requires verification)", async () => {
      const testEmail = `e2e-signup-${Date.now()}@synapsesync.app`;
      const { data } = await api("POST", "/auth/signup", undefined, { email: testEmail });
      // Either 200 (OTP sent) or rate-limited — never returns an API key
      expect(data.api_key).toBeUndefined();
    });

    it("rejects duplicate email", async () => {
      const { status } = await api("POST", "/auth/signup", undefined, { email: EMAIL });
      expect(status).toBe(409);
    });

    it("rejects empty email", async () => {
      const { status } = await api("POST", "/auth/signup", undefined, { email: "" });
      expect(status).toBe(400);
    });

    it("rejects invalid email format", async () => {
      const { status } = await api("POST", "/auth/signup", undefined, { email: "not-an-email" });
      expect(status).toBe(400);
    });

    it("rejects missing email field", async () => {
      const { status } = await api("POST", "/auth/signup", undefined, {});
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — Verify-email validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: Verify-email validation", () => {
    it("rejects missing code", async () => {
      const { status } = await api("POST", "/auth/verify-email", undefined, { email: EMAIL });
      expect(status).toBe(400);
    });

    it("rejects wrong code", async () => {
      const { status } = await api("POST", "/auth/verify-email", undefined, {
        email: "nobody@synapsesync.app",
        code: "000000",
      });
      expect(status).toBe(400);
    });

    it("rejects missing email", async () => {
      const { status } = await api("POST", "/auth/verify-email", undefined, { code: "123456" });
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — Login validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: Login validation", () => {
    it("rejects missing password", async () => {
      const { status } = await api("POST", "/auth/login", undefined, { email: EMAIL });
      expect(status).toBe(400);
    });

    it("rejects empty password", async () => {
      const { status } = await api("POST", "/auth/login", undefined, { email: EMAIL, password: "" });
      expect(status).toBe(400);
    });

    it("rejects wrong password", async () => {
      const { status } = await api("POST", "/auth/login", undefined, {
        email: EMAIL,
        password: "wrong-password-123",
      });
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it("rejects non-existent email", async () => {
      const { status } = await api("POST", "/auth/login", undefined, {
        email: "does-not-exist-ever@synapsesync.app",
        password: "any-password",
      });
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it("rejects invalid email format", async () => {
      const { status } = await api("POST", "/auth/login", undefined, {
        email: "bad-email",
        password: "pass",
      });
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — CLI exchange validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: CLI exchange", () => {
    it("rejects missing fields", async () => {
      const { status } = await api("POST", "/auth/cli-exchange", undefined, {});
      expect(status).toBe(400);
    });

    it("rejects garbage code", async () => {
      const { status, data } = await api("POST", "/auth/cli-exchange", undefined, {
        code: "not-a-real-encrypted-code",
        code_verifier: "fake-verifier",
      });
      expect(status).toBeGreaterThanOrEqual(400);
      expect(data.error || data.code).toBeTruthy();
    });

    it("rejects cli-session without auth", async () => {
      const { status } = await api("POST", "/auth/cli-session", undefined, {
        code_challenge: "test-challenge",
      });
      expect(status).toBe(401);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — API Key authentication
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: API Key", () => {
    it("valid key authenticates", async () => {
      const { status } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(200);
    });

    it("invalid key returns 401", async () => {
      const { status, data } = await api("GET", "/api/projects", "completely-fake-key");
      expect(status).toBe(401);
      expect(data.code).toBe("UNAUTHORIZED");
    });

    it("missing auth returns 401", async () => {
      const { status } = await api("GET", "/api/projects");
      expect(status).toBe(401);
    });

    it("non-Bearer prefix returns 401", async () => {
      const res = await fetch(`${API}/api/projects`, {
        headers: { Authorization: `Basic ${KEY}` },
      });
      expect(res.status).toBe(401);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PROJECTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Projects", () => {
    it("new user has zero projects", async () => {
      const { status, data } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("rejects creation without name", async () => {
      const { status } = await api("POST", "/api/projects", KEY, {});
      expect(status).toBe(400);
    });

    it("creates a project", async () => {
      PROJECT_NAME = `E2E-${Date.now()}`;
      const { status, data } = await api("POST", "/api/projects", KEY, { name: PROJECT_NAME });
      expect(status).toBe(201);
      expect(data.name).toBe(PROJECT_NAME);
      PROJECT_ID = data.id;
    });

    it("lists project with owner role", async () => {
      const { status, data } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(200);
      const p = (data as R[]).find((p) => p.id === PROJECT_ID);
      expect(p?.role).toBe("owner");
      expect(p?.owner_email).toBe(EMAIL);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Create
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const enc = (s: string) => encodeURIComponent(s);

  describe("Context: Create", () => {
    it("rejects save without project", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, { path: "x.md", content: "x" });
      expect(status).toBe(400);
    });

    it("rejects save without path", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, { project: PROJECT_NAME, content: "x" });
      expect(status).toBe(400);
    });

    it("rejects save without content", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, { project: PROJECT_NAME, path: "x.md" });
      expect(status).toBe(400);
    });

    it("rejects save to non-existent project", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, {
        project: "ghost-project",
        path: "x.md",
        content: "x",
      });
      expect(status).toBe(404);
    });

    it("saves entry with tags", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "notes/first.md",
        content: "# First Note\nCreated by E2E test.",
        tags: ["e2e", "notes"],
      });
      expect(status).toBeLessThan(300);
      expect(data.path).toBe("notes/first.md");
      expect(data.tags).toEqual(["e2e", "notes"]);
      expect(data.source).toBe("human");
    });

    it("saves entry in different folder", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "decisions/use-vitest.md",
        content: "# Decision: Use Vitest\nChosen for ESM support.",
        tags: ["e2e", "decision"],
      });
      expect(status).toBeLessThan(300);
    });

    it("saves entry with custom source", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "context/from-claude.md",
        content: "# From Claude\nWritten by AI.",
        tags: ["e2e", "ai"],
        source: "claude",
      });
      expect(status).toBeLessThan(300);
      expect(data.source).toBe("claude");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — List & Read
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: List & Read", () => {
    it("lists all 3 entries", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list`, KEY);
      expect(status).toBe(200);
      expect((data as R[]).length).toBe(3);
    });

    it("filters by folder", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list?folder=notes`, KEY);
      expect(status).toBe(200);
      expect((data as R[]).length).toBe(1);
      expect((data as R[])[0].path).toBe("notes/first.md");
    });

    it("reads entry with full content", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("notes/first.md")}`, KEY);
      expect(status).toBe(200);
      expect(data.content).toContain("First Note");
      expect(data.tags).toContain("e2e");
    });

    it("404 for non-existent entry", async () => {
      const { status } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("nope.md")}`, KEY);
      expect(status).toBe(404);
    });

    it("404 for non-existent project", async () => {
      const { status } = await api("GET", `/api/context/${enc("ghost-project")}/list`, KEY);
      expect(status).toBe(404);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: Search", () => {
    it("finds entry by keyword", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/search?q=vitest`, KEY);
      expect(status).toBe(200);
      expect((data as R[]).find((e) => e.path === "decisions/use-vitest.md")).toBeTruthy();
    });

    it("empty results for non-matching query", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/search?q=xyznonexistent`, KEY);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("rejects search without query", async () => {
      const { status } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/search`, KEY);
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Update, History, Restore
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: Update, History, Restore", () => {
    it("updates entry via upsert", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "notes/first.md",
        content: "# Updated Note\nModified by test.",
        tags: ["e2e", "updated"],
      });
      expect(status).toBeLessThan(300);
      expect(data.content).toContain("Updated Note");
    });

    it("read shows updated content", async () => {
      const { data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("notes/first.md")}`, KEY);
      expect(data.content).toContain("Updated Note");
    });

    it("history has previous version", async () => {
      const { status, data } = await api(
        "GET",
        `/api/context/${enc(PROJECT_NAME)}/history/${enc("notes/first.md")}`,
        KEY,
      );
      expect(status).toBe(200);
      expect((data as R[]).length).toBeGreaterThanOrEqual(1);
      const old = (data as R[]).find((v) => v.content.includes("Created by E2E"));
      expect(old).toBeTruthy();
      HISTORY_ID = old.id;
    });

    it("restores previous version", async () => {
      const { status, data } = await api("POST", `/api/context/${enc(PROJECT_NAME)}/restore`, KEY, {
        path: "notes/first.md",
        historyId: HISTORY_ID,
      });
      expect(status).toBe(200);
      expect(data.content).toContain("Created by E2E");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Delete
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: Delete", () => {
    it("deletes an entry", async () => {
      const { status, data } = await api(
        "DELETE",
        `/api/context/${enc(PROJECT_NAME)}/${enc("decisions/use-vitest.md")}`,
        KEY,
      );
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it("entry gone after deletion", async () => {
      const { status } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("decisions/use-vitest.md")}`, KEY);
      expect(status).toBe(404);
    });

    it("double-delete returns 404", async () => {
      const { status } = await api(
        "DELETE",
        `/api/context/${enc(PROJECT_NAME)}/${enc("decisions/use-vitest.md")}`,
        KEY,
      );
      expect(status).toBe(404);
    });

    it("list reflects deletion (2 remaining)", async () => {
      const { data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list`, KEY);
      expect((data as R[]).length).toBe(2);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  API KEY MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("API Key Management", () => {
    it("lists the default key", async () => {
      const { data } = await api("GET", "/api/account/keys", KEY);
      expect((data as R[]).find((k) => k.label === "default")).toBeTruthy();
    });

    it("creates a second key", async () => {
      const { status, data } = await api("POST", "/api/account/keys", KEY, { label: "e2e-second" });
      expect(status).toBe(201);
      expect(data.api_key).toBeTruthy();
      SECOND_KEY = data.api_key;
      SECOND_KEY_ID = data.id;
    });

    it("second key authenticates", async () => {
      const { status } = await api("GET", "/api/projects", SECOND_KEY);
      expect(status).toBe(200);
    });

    it("rejects empty label", async () => {
      const { status } = await api("POST", "/api/account/keys", KEY, { label: "" });
      expect(status).toBe(400);
    });

    it("revokes second key", async () => {
      const { status } = await api("DELETE", `/api/account/keys/${SECOND_KEY_ID}`, KEY);
      expect(status).toBe(200);
    });

    it("revoked key fails auth", async () => {
      const { status } = await api("GET", "/api/projects", SECOND_KEY);
      expect(status).toBe(401);
    });

    it("revoked key gone from list", async () => {
      const { data } = await api("GET", "/api/account/keys", KEY);
      expect((data as R[]).find((k) => k.id === SECOND_KEY_ID)).toBeUndefined();
    });

    it("revoke non-existent returns 404", async () => {
      const { status } = await api("DELETE", "/api/account/keys/00000000-0000-0000-0000-000000000000", KEY);
      expect(status).toBe(404);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  BILLING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Billing", () => {
    it("new user is on free tier", async () => {
      const { status, data } = await api("GET", "/api/billing/status", KEY);
      expect(status).toBe(200);
      expect(data.tier).toBe("free");
      expect(data.subscription).toBeNull();
    });

    it("verify rejects missing checkout_id", async () => {
      const { status } = await api("POST", "/api/billing/verify", KEY, {});
      expect(status).toBe(400);
    });

    it("verify handles invalid checkout_id", async () => {
      const { status } = await api("POST", "/api/billing/verify", KEY, { checkout_id: "chk_fake" });
      expect(status).toBe(400);
    });

    it("portal rejects without subscription", async () => {
      const { status } = await api("POST", "/api/billing/portal", KEY);
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  WEBHOOK
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Webhook", () => {
    it("rejects without signature", async () => {
      const res = await fetch(`${API}/api/billing/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "checkout.completed", object: {} }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid signature", async () => {
      const res = await fetch(`${API}/api/billing/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "creem-signature": "bad" },
        body: JSON.stringify({ event_type: "checkout.completed", object: {} }),
      });
      expect(res.status).toBeLessThan(500);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ACTIVITY LOG
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Activity Log", () => {
    it("records create/update/delete events", async () => {
      const { data } = await api("GET", `/api/projects/${PROJECT_ID}/activity?limit=50`, KEY);
      const actions = (data as R[]).map((a) => a.action);
      expect(actions).toContain("entry_created");
      expect(actions).toContain("entry_updated");
      expect(actions).toContain("entry_deleted");
    });

    it("tracks source attribution", async () => {
      const { data } = await api("GET", `/api/projects/${PROJECT_ID}/activity?limit=50`, KEY);
      const sources = (data as R[]).map((a) => a.source);
      expect(sources).toContain("claude");
      expect(sources).toContain("human");
    });

    it("has target paths", async () => {
      const { data } = await api("GET", `/api/projects/${PROJECT_ID}/activity?limit=50`, KEY);
      const paths = (data as R[]).map((a) => a.target_path).filter(Boolean);
      expect(paths).toContain("notes/first.md");
      expect(paths).toContain("context/from-claude.md");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  INSIGHTS — CRUD
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  let INSIGHT_ID: string;

  describe("Insights: CRUD", () => {
    it("creates an insight", async () => {
      const { status, data } = await api("POST", "/api/insights", KEY, {
        project_id: PROJECT_ID,
        type: "decision",
        summary: "Use Postgres for primary storage",
        detail: "Better tooling and ecosystem than MySQL",
      });
      expect(status).toBe(201);
      expect(data.id).toBeTruthy();
      expect(data.type).toBe("decision");
      INSIGHT_ID = data.id;
    });

    it("creates a second insight", async () => {
      const { status } = await api("POST", "/api/insights", KEY, {
        project_id: PROJECT_ID,
        type: "learning",
        summary: "Supabase Storage has 5GB free tier",
      });
      expect(status).toBe(201);
    });

    it("lists all insights", async () => {
      const { status, data } = await api("GET", `/api/insights?project_id=${PROJECT_ID}`, KEY);
      expect(status).toBe(200);
      expect(data.insights.length).toBeGreaterThanOrEqual(2);
      expect(data.total).toBeGreaterThanOrEqual(2);
    });

    it("filters by type", async () => {
      const { status, data } = await api("GET", `/api/insights?project_id=${PROJECT_ID}&type=decision`, KEY);
      expect(status).toBe(200);
      expect(data.insights.every((i: R) => i.type === "decision")).toBe(true);
    });

    it("updates an insight", async () => {
      const { status, data } = await api("PATCH", `/api/insights/${INSIGHT_ID}`, KEY, {
        summary: "Use Postgres for all storage (updated)",
      });
      expect(status).toBe(200);
      expect(data.summary).toBe("Use Postgres for all storage (updated)");
    });

    it("deletes an insight", async () => {
      const { data: created } = await api("POST", "/api/insights", KEY, {
        project_id: PROJECT_ID,
        type: "action_item",
        summary: "To be deleted",
      });
      const { status } = await api("DELETE", `/api/insights/${created.id}`, KEY);
      expect(status).toBe(200);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONVERSATIONS — Sync & Import/Export
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  let CONVERSATION_ID: string;

  describe("Conversations: CRUD & Sync", () => {
    it("creates a conversation", async () => {
      const { status, data } = await api("POST", "/api/conversations", KEY, {
        project_id: PROJECT_ID,
        title: "E2E Test Conversation",
        fidelity_mode: "summary",
        system_prompt: "You are a test assistant",
        working_context: { repo: "synapse", branch: "main" },
      });
      if (status === 403) {
        console.log("  ⏭ Conversation tests skipped — free tier");
        return;
      }
      expect(status).toBe(201);
      CONVERSATION_ID = data.id;
    });

    it("appends messages", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("POST", `/api/conversations/${CONVERSATION_ID}/messages`, KEY, {
        messages: [
          { role: "user", content: "Fix the auth bug", source_agent: "claude-code" },
          {
            role: "assistant",
            content: "I'll look at the auth middleware.",
            source_agent: "claude-code",
            source_model: "claude-opus-4-6",
          },
          {
            role: "assistant",
            content: "Found the issue.",
            source_agent: "claude-code",
            tool_interaction: { name: "Read", summary: "Read auth.ts (45 lines)" },
          },
        ],
      });
      expect(status).toBe(200);
      expect(data.messages.length).toBe(3);
    });

    it("lists conversations", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations?project_id=${PROJECT_ID}`, KEY);
      expect(status).toBe(200);
      const conv = data.conversations.find((c: R) => c.id === CONVERSATION_ID);
      expect(conv).toBeTruthy();
      expect(conv.message_count).toBe(3);
    });

    it("gets full conversation", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations/${CONVERSATION_ID}`, KEY);
      expect(status).toBe(200);
      expect(data.messages.length).toBe(3);
      expect(data.messages[0].content).toBe("Fix the auth bug");
    });

    it("exports in raw format", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations/${CONVERSATION_ID}/export/raw`, KEY);
      expect(status).toBe(200);
      expect(data.format).toBe("raw");
      expect(data.messages.length).toBe(3);
    });

    it("imports from OpenAI format", async () => {
      const { status, data } = await api("POST", "/api/conversations/import", KEY, {
        project_id: PROJECT_ID,
        format: "openai",
        title: "Imported from ChatGPT",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "What is Synapse?" },
          { role: "assistant", content: "A context management tool." },
        ],
      });
      if (status === 403) return;
      expect(status).toBe(201);
      expect(data.messageCount).toBe(3);
    });

    it("soft-deletes conversation", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("PATCH", `/api/conversations/${CONVERSATION_ID}`, KEY, { status: "deleted" });
      expect(status).toBe(200);
      expect(data.status).toBe("deleted");
    });

    it("deleted not in list", async () => {
      if (!CONVERSATION_ID) return;
      const { status, data } = await api("GET", `/api/conversations?project_id=${PROJECT_ID}`, KEY);
      expect(status).toBe(200);
      const ids = data.conversations.map((c: R) => c.id);
      expect(ids).not.toContain(CONVERSATION_ID);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH ENFORCEMENT — all protected endpoints
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth enforcement on all endpoints", () => {
    const endpoints: [string, string][] = [
      ["GET", "/api/projects"],
      ["POST", "/api/projects"],
      ["GET", "/api/account/keys"],
      ["POST", "/api/account/keys"],
      ["DELETE", "/api/account"],
      ["GET", "/api/billing/status"],
      ["POST", "/api/billing/checkout"],
      ["POST", "/api/billing/verify"],
      ["POST", "/api/billing/portal"],
      ["POST", "/api/context/save"],
      ["GET", "/api/context/X/list"],
      ["GET", "/api/context/X/search?q=x"],
      ["GET", "/api/context/X/x.md"],
      ["DELETE", "/api/context/X/x.md"],
      // Insights
      ["GET", "/api/insights?project_id=test"],
      ["POST", "/api/insights"],
      ["PATCH", "/api/insights/some-id"],
      ["DELETE", "/api/insights/some-id"],
      // Conversations
      ["GET", "/api/conversations?project_id=test"],
      ["POST", "/api/conversations"],
      ["GET", "/api/conversations/some-id"],
      ["PATCH", "/api/conversations/some-id"],
      ["POST", "/api/conversations/some-id/messages"],
      ["POST", "/api/conversations/import"],
      ["GET", "/api/conversations/some-id/export/raw"],
    ];
    for (const [method, path] of endpoints) {
      it(`${method} ${path} → 401 without auth`, async () => {
        const { status } = await api(method, path);
        expect(status).toBe(401);
      });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ACCOUNT DELETION — must be LAST
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Account deletion", () => {
    it("deletes user and all data", async () => {
      const { status, data } = await api("DELETE", "/api/account", KEY);
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it("key stops working after deletion", async () => {
      const { status } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(401);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CLEANUP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  afterAll(async () => {
    // Belt-and-suspenders: try API-level deletion first, then fall back to
    // direct Supabase admin cleanup so auth.users never accumulates test data.
    if (KEY) {
      try {
        await api("DELETE", "/api/account", KEY);
      } catch {
        // already deleted or key invalid
      }
    }

    // Direct admin cleanup: delete the auth user even if the API call failed
    if (EMAIL && SUPABASE_URL && SUPABASE_KEY) {
      try {
        const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50`, {
          headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        });
        if (listRes.ok) {
          const { users } = (await listRes.json()) as { users: { id: string; email?: string }[] };
          const authUser = users.find((u) => u.email === EMAIL);
          if (authUser) {
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
            });
          }
        }
      } catch {
        // best-effort cleanup
      }
    }
  });
});
