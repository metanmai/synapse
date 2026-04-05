/**
 * End-to-end roundtrip tests against the live Synapse API.
 *
 * Full user journey — every scenario a real user would hit:
 *   Auth → Projects → Context CRUD → Search → History → Restore →
 *   API Key Management → Billing → Activity Log
 *
 * Run:  TEST_E2E=1 npm run test:e2e
 * With custom API:  TEST_E2E=1 TEST_API_URL=http://localhost:8787 npm run test:e2e
 *
 * Creates a fresh test user each run. Cleans up after itself.
 */
import { afterAll, describe, expect, it } from "vitest";

const API = process.env.TEST_API_URL || "https://api.synapsesync.app";
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

// ── shared state across the ordered test chain ──
let KEY: string; // primary API key
let USER_ID: string;
let EMAIL: string;
let PROJECT_NAME: string;
let PROJECT_ID: string;
let SECOND_KEY: string; // raw key string (only available at creation)
let SECOND_KEY_ID: string;
let HISTORY_ID: string; // for restore test
let CHECKOUT_URL: string;

suite("Full User Journey", () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — Signup
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: Signup", () => {
    it("creates a new account", async () => {
      EMAIL = `e2e-${Date.now()}@synapsesync.app`;
      const { status, data } = await api("POST", "/auth/signup", undefined, { email: EMAIL });
      expect(status).toBe(201);
      expect(data.email).toBe(EMAIL);
      expect(data.api_key).toBeTruthy();
      expect(typeof data.api_key).toBe("string");
      expect(data.id).toBeTruthy();
      KEY = data.api_key;
      USER_ID = data.id;
    });

    it("rejects duplicate email", async () => {
      const { status, data } = await api("POST", "/auth/signup", undefined, { email: EMAIL });
      expect(status).toBe(409);
      expect(data.code).toBe("CONFLICT");
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — Login validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: Login validation", () => {
    it("rejects login with missing password", async () => {
      const { status } = await api("POST", "/auth/login", undefined, { email: EMAIL });
      expect(status).toBe(400);
    });

    it("rejects login with empty password", async () => {
      const { status } = await api("POST", "/auth/login", undefined, { email: EMAIL, password: "" });
      expect(status).toBe(400);
    });

    it("rejects login with wrong password", async () => {
      // The test user was created via /auth/signup (no Supabase Auth password),
      // so any password attempt should fail at the Supabase auth layer
      const { status, data } = await api("POST", "/auth/login", undefined, {
        email: EMAIL,
        password: "wrong-password-123",
      });
      // Supabase auth returns 401 for bad credentials; if Supabase isn't configured
      // in test env it may return 500, but it should never return 200
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).not.toBe(200);
      if (status === 401) expect(data.code).toBe("AUTH_ERROR");
    });

    it("rejects login for non-existent email", async () => {
      const { status } = await api("POST", "/auth/login", undefined, {
        email: "does-not-exist-ever@synapsesync.app",
        password: "any-password",
      });
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it("rejects login with invalid email format", async () => {
      const { status } = await api("POST", "/auth/login", undefined, {
        email: "bad-email",
        password: "pass",
      });
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — CLI exchange validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: CLI exchange", () => {
    it("rejects cli-exchange with missing fields", async () => {
      const { status } = await api("POST", "/auth/cli-exchange", undefined, {});
      expect(status).toBe(400);
    });

    it("rejects cli-exchange with garbage code", async () => {
      const { status, data } = await api("POST", "/auth/cli-exchange", undefined, {
        code: "not-a-real-encrypted-code",
        code_verifier: "fake-verifier",
      });
      expect(status).toBeGreaterThanOrEqual(400);
      // Should say invalid/expired code, not crash
      expect(data.error || data.code).toBeTruthy();
    });

    it("rejects cli-session without auth", async () => {
      const { status } = await api("POST", "/auth/cli-session", undefined, {
        code_challenge: "test-challenge",
      });
      expect(status).toBe(401);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  AUTH — API Key authentication
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Auth: API Key", () => {
    it("valid key authenticates", async () => {
      const { status } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(200);
    });

    it("invalid key returns 401 with UNAUTHORIZED code", async () => {
      const { status, data } = await api("GET", "/api/projects", "completely-fake-key");
      expect(status).toBe(401);
      expect(data.code).toBe("UNAUTHORIZED");
    });

    it("missing auth header returns 401", async () => {
      const { status } = await api("GET", "/api/projects");
      expect(status).toBe(401);
    });

    it("non-Bearer prefix returns 401", async () => {
      const h: Record<string, string> = { Authorization: `Basic ${KEY}` };
      const res = await fetch(`${API}/api/projects`, { headers: h });
      expect(res.status).toBe(401);
    });

    it("empty Bearer token returns 401", async () => {
      const { status } = await api("GET", "/api/projects", "");
      // Empty string won't add auth header, so 401
      expect(status).toBe(401);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  PROJECTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Projects", () => {
    it("new user has zero projects", async () => {
      const { status, data } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("rejects project creation without name", async () => {
      const { status } = await api("POST", "/api/projects", KEY, {});
      expect(status).toBe(400);
    });

    it("rejects project creation with empty name", async () => {
      const { status } = await api("POST", "/api/projects", KEY, { name: "" });
      expect(status).toBe(400);
    });

    it("creates a project", async () => {
      PROJECT_NAME = `E2E-${Date.now()}`;
      const { status, data } = await api("POST", "/api/projects", KEY, { name: PROJECT_NAME });
      expect(status).toBe(201);
      expect(data.name).toBe(PROJECT_NAME);
      expect(data.id).toBeTruthy();
      PROJECT_ID = data.id;
    });

    it("lists the project with owner role", async () => {
      const { status, data } = await api("GET", "/api/projects", KEY);
      expect(status).toBe(200);
      const p = (data as R[]).find((p) => p.id === PROJECT_ID);
      expect(p).toBeTruthy();
      expect(p?.role).toBe("owner");
      expect(p?.owner_email).toBe(EMAIL);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Create entries
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const enc = (s: string) => encodeURIComponent(s);

  describe("Context: Create", () => {
    it("rejects save without project", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, {
        path: "test.md",
        content: "hello",
      });
      expect(status).toBe(400);
    });

    it("rejects save without path", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        content: "hello",
      });
      expect(status).toBe(400);
    });

    it("rejects save without content", async () => {
      const { status } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "test.md",
      });
      expect(status).toBe(400);
    });

    it("rejects save to non-existent project", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: "does-not-exist-project",
        path: "test.md",
        content: "hello",
      });
      expect(status).toBe(404);
      expect(data.code).toBe("NOT_FOUND");
    });

    it("saves a markdown entry with tags", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "notes/first.md",
        content: "# First Note\nCreated by E2E test suite.",
        tags: ["e2e", "notes"],
      });
      expect(status).toBeLessThan(300);
      expect(data.path).toBe("notes/first.md");
      expect(data.content).toContain("First Note");
      expect(data.tags).toEqual(["e2e", "notes"]);
      expect(data.source).toBe("human");
      expect(data.author_id).toBe(USER_ID);
    });

    it("saves a second entry in a different folder", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "decisions/use-vitest.md",
        content: "# Decision: Use Vitest\nChosen for ESM support and speed.",
        tags: ["e2e", "decision"],
      });
      expect(status).toBeLessThan(300);
      expect(data.path).toBe("decisions/use-vitest.md");
    });

    it("saves a third entry with custom source", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "context/from-claude.md",
        content: "# From Claude\nThis was written by an AI assistant.",
        tags: ["e2e", "ai"],
        source: "claude",
      });
      expect(status).toBeLessThan(300);
      expect(data.source).toBe("claude");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — List & Read
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: List & Read", () => {
    it("lists all 3 entries", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list`, KEY);
      expect(status).toBe(200);
      expect((data as R[]).length).toBe(3);
    });

    it("lists entries filtered by folder", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list?folder=notes`, KEY);
      expect(status).toBe(200);
      expect((data as R[]).length).toBe(1);
      expect((data as R[])[0].path).toBe("notes/first.md");
    });

    it("reads an entry with full content", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("notes/first.md")}`, KEY);
      expect(status).toBe(200);
      expect(data.content).toContain("First Note");
      expect(data.tags).toContain("e2e");
      expect(data.source).toBe("human");
      expect(data.created_at).toBeTruthy();
      expect(data.updated_at).toBeTruthy();
    });

    it("returns 404 for non-existent entry", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("does/not/exist.md")}`, KEY);
      expect(status).toBe(404);
      expect(data.code).toBe("NOT_FOUND");
    });

    it("returns 404 for non-existent project", async () => {
      const { status } = await api("GET", `/api/context/${enc("no-such-project")}/list`, KEY);
      expect(status).toBe(404);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Search
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: Search", () => {
    it("finds entries by keyword", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/search?q=vitest`, KEY);
      expect(status).toBe(200);
      const found = (data as R[]).find((e) => e.path === "decisions/use-vitest.md");
      expect(found).toBeTruthy();
    });

    it("search returns empty for non-matching query", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/search?q=xyznonexistent12345`, KEY);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("rejects search without query param", async () => {
      const { status } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/search`, KEY);
      expect(status).toBe(400);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONTEXT — Update & History & Restore
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Context: Update, History, Restore", () => {
    it("updates an existing entry (upsert)", async () => {
      const { status, data } = await api("POST", "/api/context/save", KEY, {
        project: PROJECT_NAME,
        path: "notes/first.md",
        content: "# Updated First Note\nThis content was modified.",
        tags: ["e2e", "notes", "updated"],
      });
      expect(status).toBeLessThan(300);
      expect(data.content).toContain("Updated First Note");
      expect(data.tags).toContain("updated");
    });

    it("reading shows updated content", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("notes/first.md")}`, KEY);
      expect(status).toBe(200);
      expect(data.content).toContain("Updated First Note");
      expect(data.content).not.toContain("Created by E2E");
    });

    it("history contains the previous version", async () => {
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

    it("restores the previous version", async () => {
      const { status, data } = await api("POST", `/api/context/${enc(PROJECT_NAME)}/restore`, KEY, {
        path: "notes/first.md",
        historyId: HISTORY_ID,
      });
      expect(status).toBe(200);
      expect(data.content).toContain("Created by E2E");
    });

    it("reading after restore shows original content", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/${enc("notes/first.md")}`, KEY);
      expect(status).toBe(200);
      expect(data.content).toContain("Created by E2E");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

    it("entry is gone after deletion", async () => {
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

    it("deleting non-existent entry returns 404", async () => {
      const { status } = await api("DELETE", `/api/context/${enc(PROJECT_NAME)}/${enc("nope/nope.md")}`, KEY);
      expect(status).toBe(404);
    });

    it("list reflects deletion (2 remaining)", async () => {
      const { status, data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list`, KEY);
      expect(status).toBe(200);
      expect((data as R[]).length).toBe(2);
      const paths = (data as R[]).map((e) => e.path);
      expect(paths).not.toContain("decisions/use-vitest.md");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  API KEY MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("API Key Management", () => {
    it("lists the default key", async () => {
      const { status, data } = await api("GET", "/api/account/keys", KEY);
      expect(status).toBe(200);
      const keys = data as R[];
      expect(keys.length).toBeGreaterThanOrEqual(1);
      expect(keys.find((k) => k.label === "default")).toBeTruthy();
    });

    it("creates a second key", async () => {
      const { status, data } = await api("POST", "/api/account/keys", KEY, { label: "e2e-test-key" });
      expect(status).toBe(201);
      expect(data.api_key).toBeTruthy();
      expect(data.label).toBe("e2e-test-key");
      SECOND_KEY = data.api_key;
      SECOND_KEY_ID = data.id;
    });

    it("second key actually works for auth", async () => {
      const { status } = await api("GET", "/api/projects", SECOND_KEY);
      expect(status).toBe(200);
    });

    it("rejects key creation without label", async () => {
      const { status } = await api("POST", "/api/account/keys", KEY, {});
      expect(status).toBe(400);
    });

    it("rejects key creation with empty label", async () => {
      const { status } = await api("POST", "/api/account/keys", KEY, { label: "" });
      expect(status).toBe(400);
    });

    it("revokes the second key", async () => {
      const { status, data } = await api("DELETE", `/api/account/keys/${SECOND_KEY_ID}`, KEY);
      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it("revoked key no longer authenticates", async () => {
      const { status } = await api("GET", "/api/projects", SECOND_KEY);
      expect(status).toBe(401);
    });

    it("revoked key gone from list", async () => {
      const { status, data } = await api("GET", "/api/account/keys", KEY);
      expect(status).toBe(200);
      expect((data as R[]).find((k) => k.id === SECOND_KEY_ID)).toBeUndefined();
    });

    it("revoking non-existent key returns 404", async () => {
      const { status } = await api("DELETE", "/api/account/keys/00000000-0000-0000-0000-000000000000", KEY);
      expect(status).toBe(404);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  BILLING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Billing", () => {
    it("new user is on free tier", async () => {
      const { status, data } = await api("GET", "/api/billing/status", KEY);
      expect(status).toBe(200);
      expect(data.tier).toBe("free");
      expect(data.subscription).toBeNull();
    });

    it("checkout creates a Creem checkout URL", async () => {
      const { status, data } = await api("POST", "/api/billing/checkout", KEY);
      // If Creem is configured, we get a checkout URL
      // If not, we get an error — both are valid for the test
      if (status === 200) {
        expect(data.url).toBeTruthy();
        expect(typeof data.url).toBe("string");
        CHECKOUT_URL = data.url;
      } else {
        // Creem not configured in this environment — acceptable
        expect(status).toBeGreaterThanOrEqual(400);
      }
    });

    it("verify endpoint rejects missing checkout_id", async () => {
      const { status } = await api("POST", "/api/billing/verify", KEY, {});
      expect(status).toBe(400);
    });

    it("verify endpoint handles invalid checkout_id gracefully", async () => {
      const { status } = await api("POST", "/api/billing/verify", KEY, {
        checkout_id: "chk_fake_nonexistent",
      });
      // Should return 400, not crash with 500
      expect(status).toBe(400);
    });

    it("portal rejects user without subscription", async () => {
      const { status, data } = await api("POST", "/api/billing/portal", KEY);
      expect(status).toBe(400);
      expect(data.error).toContain("Subscribe to Plus first");
    });

    it("billing endpoints require auth", async () => {
      const endpoints = [
        ["GET", "/api/billing/status"],
        ["POST", "/api/billing/checkout"],
        ["POST", "/api/billing/verify"],
        ["POST", "/api/billing/portal"],
      ];
      for (const [method, path] of endpoints) {
        const { status } = await api(method, path);
        expect(status).toBe(401);
      }
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  WEBHOOK — Format validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Webhook", () => {
    it("rejects webhook without signature header", async () => {
      const res = await fetch(`${API}/api/billing/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "checkout.completed", object: {} }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as R;
      expect(data.error).toContain("creem-signature");
    });

    it("rejects webhook with invalid signature", async () => {
      const res = await fetch(`${API}/api/billing/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "creem-signature": "invalid-sig-123",
        },
        body: JSON.stringify({ event_type: "checkout.completed", object: {} }),
      });
      // Should be 400 (bad signature), not 500
      expect(res.status).toBeLessThan(500);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ACTIVITY LOG
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("Activity Log", () => {
    it("records all operations from the journey", async () => {
      const { status, data } = await api("GET", `/api/projects/${PROJECT_ID}/activity?limit=50`, KEY);
      expect(status).toBe(200);
      const actions = (data as R[]).map((a) => a.action);

      // We created 3 entries, updated 1, restored 1 (counts as update), deleted 1
      expect(actions).toContain("entry_created");
      expect(actions).toContain("entry_updated");
      expect(actions).toContain("entry_deleted");
    });

    it("activity has correct source attribution", async () => {
      const { data } = await api("GET", `/api/projects/${PROJECT_ID}/activity?limit=50`, KEY);
      const sources = (data as R[]).map((a) => a.source);
      // We saved one entry with source="claude"
      expect(sources).toContain("claude");
      expect(sources).toContain("human");
    });

    it("activity has target paths", async () => {
      const { data } = await api("GET", `/api/projects/${PROJECT_ID}/activity?limit=50`, KEY);
      const paths = (data as R[]).map((a) => a.target_path).filter(Boolean);
      expect(paths).toContain("notes/first.md");
      expect(paths).toContain("decisions/use-vitest.md");
      expect(paths).toContain("context/from-claude.md");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CROSS-CUTTING: Auth on all protected endpoints
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("All protected endpoints require auth", () => {
    const protectedEndpoints: [string, string][] = [
      ["GET", "/api/projects"],
      ["POST", "/api/projects"],
      ["GET", "/api/account/keys"],
      ["POST", "/api/account/keys"],
      ["GET", "/api/billing/status"],
      ["POST", "/api/billing/checkout"],
      ["POST", "/api/billing/verify"],
      ["POST", "/api/billing/portal"],
      ["POST", "/api/context/save"],
      ["GET", "/api/context/TestProject/list"],
      ["GET", "/api/context/TestProject/search?q=test"],
      ["GET", "/api/context/TestProject/test.md"],
      ["DELETE", "/api/context/TestProject/test.md"],
    ];

    for (const [method, path] of protectedEndpoints) {
      it(`${method} ${path} → 401`, async () => {
        const { status } = await api(method, path);
        expect(status).toBe(401);
      });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CLEANUP
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  afterAll(async () => {
    if (!KEY || !PROJECT_NAME) return;
    try {
      // Delete remaining entries
      const { data } = await api("GET", `/api/context/${enc(PROJECT_NAME)}/list`, KEY);
      if (Array.isArray(data)) {
        for (const entry of data) {
          await api("DELETE", `/api/context/${enc(PROJECT_NAME)}/${enc(entry.path)}`, KEY);
        }
      }
    } catch {
      // best-effort
    }
  });
});
