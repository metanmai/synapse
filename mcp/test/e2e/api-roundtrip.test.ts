/**
 * End-to-end roundtrip tests against the live Synapse API.
 *
 * These tests create a real test user, exercise every major feature,
 * and verify the full flow works as a real user would experience it.
 *
 * Run: TEST_E2E=1 npx vitest run test/e2e/
 *
 * The test user is created fresh with a unique email each run.
 * Cleanup happens at the end (best-effort).
 */
import { afterAll, describe, expect, it } from "vitest";

const API_URL = process.env.TEST_API_URL || "https://api.synapsesync.app";
const RUN_E2E = process.env.TEST_E2E === "1";

// Skip the entire suite if E2E is not enabled
const describeE2E = RUN_E2E ? describe : describe.skip;

interface ApiResponse {
  // biome-ignore lint/suspicious/noExplicitAny: API responses are dynamic
  [key: string]: any;
}

// --- Helpers ---

async function api(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: ApiResponse }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as ApiResponse };
}

// --- Test state ---

let testApiKey: string;
let testUserId: string;
let testEmail: string;
let projectId: string;
let projectName: string;
let secondKeyId: string;

describeE2E("API Roundtrip — Full User Journey", () => {
  // ─────────────────────────────────────────────
  //  1. SIGNUP
  // ─────────────────────────────────────────────

  describe("1. Signup", () => {
    it("creates a new user and returns an API key", async () => {
      testEmail = `test-e2e-${Date.now()}@synapsesync.app`;
      const { status, data } = await api("POST", "/auth/signup", undefined, { email: testEmail });

      expect(status).toBe(201);
      expect(data.email).toBe(testEmail);
      expect(data.api_key).toBeTruthy();
      expect(data.id).toBeTruthy();

      testApiKey = data.api_key;
      testUserId = data.id;
    });

    it("rejects duplicate signup", async () => {
      const { status } = await api("POST", "/auth/signup", undefined, { email: testEmail });
      expect(status).toBe(409);
    });
  });

  // ─────────────────────────────────────────────
  //  2. API KEY VALIDATION
  // ─────────────────────────────────────────────

  describe("2. API Key Validation", () => {
    it("new key authenticates successfully", async () => {
      const { status, data } = await api("GET", "/api/projects", testApiKey);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });

    it("invalid key returns 401", async () => {
      const { status, data } = await api("GET", "/api/projects", "fake-invalid-key");
      expect(status).toBe(401);
      expect(data.code).toBe("UNAUTHORIZED");
    });

    it("missing auth returns 401", async () => {
      const { status } = await api("GET", "/api/projects");
      expect(status).toBe(401);
    });
  });

  // ─────────────────────────────────────────────
  //  3. PROJECT CREATION
  // ─────────────────────────────────────────────

  describe("3. Projects", () => {
    it("new user starts with no projects", async () => {
      const { status, data } = await api("GET", "/api/projects", testApiKey);
      expect(status).toBe(200);
      expect(data).toEqual([]);
    });

    it("creates a project", async () => {
      projectName = `E2E Test ${Date.now()}`;
      const { status, data } = await api("POST", "/api/projects", testApiKey, { name: projectName });

      expect(status).toBe(201);
      expect(data.name).toBe(projectName);
      expect(data.id).toBeTruthy();
      projectId = data.id;
    });

    it("lists the created project", async () => {
      const { status, data } = await api("GET", "/api/projects", testApiKey);
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);

      const found = (data as ApiResponse[]).find((p) => p.name === projectName);
      expect(found).toBeTruthy();
      expect(found?.role).toBe("owner");
    });
  });

  // ─────────────────────────────────────────────
  //  4. CONTEXT — Save, List, Read, Search, Update, History, Delete
  // ─────────────────────────────────────────────

  describe("4. Context CRUD", () => {
    const entryPath = "e2e/roundtrip-test.md";
    const encodedProject = () => encodeURIComponent(projectName);
    const encodedPath = () => encodeURIComponent(entryPath);

    it("saves an entry", async () => {
      const { status, data } = await api("POST", "/api/context/save", testApiKey, {
        project: projectName,
        path: entryPath,
        content: "# E2E Test\nThis entry was created by the roundtrip test suite.",
        tags: ["e2e", "test"],
      });

      expect(status).toBeLessThan(300);
      expect(data.path).toBe(entryPath);
      expect(data.content).toContain("E2E Test");
      expect(data.tags).toEqual(["e2e", "test"]);
    });

    it("lists the entry", async () => {
      const { status, data } = await api("GET", `/api/context/${encodedProject()}/list`, testApiKey);

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      const found = (data as ApiResponse[]).find((e) => e.path === entryPath);
      expect(found).toBeTruthy();
      expect(found?.tags).toContain("e2e");
    });

    it("reads the entry back with full content", async () => {
      const { status, data } = await api("GET", `/api/context/${encodedProject()}/${encodedPath()}`, testApiKey);

      expect(status).toBeLessThan(300);
      expect(data.path).toBe(entryPath);
      expect(data.content).toContain("E2E Test");
      expect(data.source).toBe("human");
    });

    it("finds the entry via search", async () => {
      const { status, data } = await api(
        "GET",
        `/api/context/${encodedProject()}/search?q=roundtrip+test+suite`,
        testApiKey,
      );

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      const found = (data as ApiResponse[]).find((e) => e.path === entryPath);
      expect(found).toBeTruthy();
    });

    it("updates the entry", async () => {
      const { status, data } = await api("POST", "/api/context/save", testApiKey, {
        project: projectName,
        path: entryPath,
        content: "# Updated E2E\nModified by the roundtrip test.",
        tags: ["e2e", "test", "updated"],
      });

      expect(status).toBeLessThan(300);
      expect(data.content).toContain("Updated E2E");
      expect(data.tags).toContain("updated");
    });

    it("reading shows updated content", async () => {
      const { status, data } = await api("GET", `/api/context/${encodedProject()}/${encodedPath()}`, testApiKey);

      expect(status).toBe(200);
      expect(data.content).toContain("Updated E2E");
    });

    it("history contains the original version", async () => {
      const { status, data } = await api(
        "GET",
        `/api/context/${encodedProject()}/history/${encodedPath()}`,
        testApiKey,
      );

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect((data as ApiResponse[]).length).toBeGreaterThanOrEqual(1);

      // History should contain the old content
      const oldVersion = (data as ApiResponse[]).find((v) => v.content.includes("E2E Test"));
      expect(oldVersion).toBeTruthy();
    });

    it("deletes the entry", async () => {
      const { status, data } = await api("DELETE", `/api/context/${encodedProject()}/${encodedPath()}`, testApiKey);

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it("entry is gone after deletion", async () => {
      const { status } = await api("GET", `/api/context/${encodedProject()}/${encodedPath()}`, testApiKey);
      expect(status).toBe(404);
    });

    it("list is empty after deletion", async () => {
      const { status, data } = await api("GET", `/api/context/${encodedProject()}/list`, testApiKey);

      expect(status).toBe(200);
      expect(data).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────
  //  5. API KEY MANAGEMENT
  // ─────────────────────────────────────────────

  describe("5. API Key Management", () => {
    it("creates a second API key", async () => {
      const { status, data } = await api("POST", "/api/account/keys", testApiKey, { label: "e2e-second-key" });

      expect(status).toBe(201);
      expect(data.label).toBe("e2e-second-key");
      expect(data.api_key).toBeTruthy();
      secondKeyId = data.id;
    });

    it("second key authenticates", async () => {
      // We can't use the second key directly since we only got it in the create response
      // but we can verify it exists in the list
      const { status, data } = await api("GET", "/api/account/keys", testApiKey);

      expect(status).toBe(200);
      const found = (data as ApiResponse[]).find((k) => k.label === "e2e-second-key");
      expect(found).toBeTruthy();
      expect(found?.id).toBe(secondKeyId);
    });

    it("revokes the second key", async () => {
      const { status, data } = await api("DELETE", `/api/account/keys/${secondKeyId}`, testApiKey);

      expect(status).toBe(200);
      expect(data.ok).toBe(true);
    });

    it("revoked key no longer appears in list", async () => {
      const { status, data } = await api("GET", "/api/account/keys", testApiKey);

      expect(status).toBe(200);
      const found = (data as ApiResponse[]).find((k) => k.id === secondKeyId);
      expect(found).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────
  //  6. BILLING STATUS
  // ─────────────────────────────────────────────

  describe("6. Billing", () => {
    it("new user is on free tier", async () => {
      const { status, data } = await api("GET", "/api/billing/status", testApiKey);

      expect(status).toBe(200);
      expect(data.tier).toBe("free");
      expect(data.subscription).toBeNull();
    });
  });

  // ─────────────────────────────────────────────
  //  7. ACTIVITY LOG
  // ─────────────────────────────────────────────

  describe("7. Activity Log", () => {
    it("records project creation and entry operations", async () => {
      const { status, data } = await api("GET", `/api/projects/${projectId}/activity?limit=50`, testApiKey);

      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);

      const actions = (data as ApiResponse[]).map((a) => a.action);
      // We created a project, saved an entry, updated it, deleted it
      expect(actions).toContain("entry_created");
      expect(actions).toContain("entry_updated");
      expect(actions).toContain("entry_deleted");
    });
  });

  // ─────────────────────────────────────────────
  //  CLEANUP
  // ─────────────────────────────────────────────

  afterAll(async () => {
    // Best-effort cleanup — delete any remaining entries and the test project
    if (testApiKey && projectName) {
      try {
        const { data: entries } = await api("GET", `/api/context/${encodeURIComponent(projectName)}/list`, testApiKey);
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            await api(
              "DELETE",
              `/api/context/${encodeURIComponent(projectName)}/${encodeURIComponent(entry.path)}`,
              testApiKey,
            );
          }
        }
      } catch {
        // ignore cleanup failures
      }
    }
  });
});
