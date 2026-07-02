/**
 * Backend route contracts that genuinely require a live Postgres roundtrip.
 *
 * Why this file exists:
 *   The 26 `it.skip` stubs that used to live under backend/test/api/ were
 *   re-implemented as real unit tests against a mocked Supabase client. Two
 *   contracts couldn't be honestly verified that way because they assert
 *   SCHEMA behavior (FK ON DELETE CASCADE, public.users.id vs auth.users.id):
 *
 *     1. DELETE /api/projects/:id?force=true cascades to EVERY child table —
 *        a regression would orphan rows (e.g. share_links pointing at a
 *        non-existent project), silently grow project_invites, etc.
 *     2. GET /api/account/me returns public.users.id, NOT auth.users.id —
 *        the entire FK tree is keyed on public.users.id, so a regression
 *        here would invisibly corrupt every join (RLS policies, share
 *        ownership, billing — all wrong).
 *
 * Mocking either of those would only prove the mock is consistent, not that
 * the database schema delivers the promised behavior.
 *
 * GATING:
 *   `describe.skip` (not `.skip`'d individual tests, and not the legacy
 *   TEST_E2E env flag) when the live-DB env vars are missing. The CI e2e
 *   job (metanmai/synapse) sets all three; the tanmain mirror does not and
 *   simply skip-greens the suite.
 *
 * CLEANUP CONTRACT:
 *   These tests self-clean. Every project/row they create is deleted via
 *   the backend's DELETE /api/account at suite end. If a test leaks rows,
 *   the leak is a finding (the very bug class this CI effort exists to
 *   close — the test account used to accumulate untitled projects forever).
 *
 * Required env vars (set by the metanmai-only CI e2e job):
 *   - TEST_API_URL              — the live test backend's URL
 *   - TEST_SUPABASE_URL         — the test Supabase project's URL
 *   - TEST_SUPABASE_SERVICE_KEY — the test Supabase service-role key
 */

import { afterAll, describe, expect, it } from "vitest";

const API = process.env.TEST_API_URL || "";
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY || "";

// Auto-skip when env is missing — only the CI e2e job has these secrets.
// We use describe.skip (not the legacy TEST_E2E flag, which is being
// removed in the same push that lands this file) so collection still
// happens but the tests no-op into the green path.
const suite = API && SUPABASE_URL && SUPABASE_KEY ? describe : describe.skip;

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

/**
 * Direct Supabase admin REST call. Used for two things:
 *   - Create + delete the test auth user (mirror api-roundtrip.test.ts).
 *   - Verify FK CASCADE actually dropped child rows after a force-delete.
 */
async function supabaseRest<T = R>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}) as T);
  return { status: res.status, data: data as T };
}

/** Create a verified auth user + a public.users row via the backend's login flow. */
async function createTestUser(email: string): Promise<{ apiKey: string; userId: string; supabaseAuthId: string }> {
  const password = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!authRes.ok) {
    throw new Error(`Failed to create Supabase auth user: ${authRes.status} ${await authRes.text()}`);
  }
  const authUser = (await authRes.json()) as { id: string };

  const { status, data } = await api("POST", "/auth/login", undefined, { email, password, label: "default" });
  if (status !== 200 || !data.api_key) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }
  return { apiKey: data.api_key, userId: data.id, supabaseAuthId: authUser.id };
}

// ─────────────────────────────────────────────────────────────────────────
//  Shared state
// ─────────────────────────────────────────────────────────────────────────

let KEY = "";
let USER_ID = "";
let SUPABASE_AUTH_ID = "";

suite("Backend contracts requiring live Postgres", () => {
  // ── one shared user per file; reused across the two contracts ──
  it("setup: creates a fresh test user", async () => {
    const email = `e2e-contracts-${Date.now()}@synapsesync.app`;
    const u = await createTestUser(email);
    KEY = u.apiKey;
    USER_ID = u.userId;
    SUPABASE_AUTH_ID = u.supabaseAuthId;
    expect(KEY).toBeTruthy();
    expect(USER_ID).toBeTruthy();
    expect(SUPABASE_AUTH_ID).toBeTruthy();
  });

  // ── Contract 1 ──
  // GET /api/account/me returns user_id = public.users.id, NOT auth.users.id.
  //
  // Why mocking can't catch this: the bug class is "the route accidentally
  // surfaces the auth.users.id (the Supabase Auth internal identifier)
  // instead of the public.users.id we use for every FK." The fix lives in
  // the join chain `api_keys.user_id → public.users.id`; verifying it
  // requires confirming the same identifier appears in both:
  //   - the /me response body
  //   - the public.users row (queried directly via the service-role key)
  // and that it's DIFFERENT from the auth.users id we used to create the
  // user.
  describe("GET /api/account/me — user_id is public.users.id (not auth.users.id)", () => {
    it("response body's user_id matches public.users.id (not the Supabase auth.users.id)", async () => {
      const { status, data } = await api("GET", "/api/account/me", KEY);
      expect(status).toBe(200);
      expect(data.user_id).toBeTruthy();
      // The returned user_id MUST be the public.users.id (from createTestUser's
      // /auth/login response). Cross-check against the raw public.users row.
      expect(data.user_id).toBe(USER_ID);

      // And — critically — it MUST NOT be the auth.users.id.
      expect(data.user_id).not.toBe(SUPABASE_AUTH_ID);

      // Cross-confirm via direct REST: the public.users row with id = data.user_id
      // exists AND has supabase_auth_id = SUPABASE_AUTH_ID (the join chain).
      const { status: pubStatus, data: pubData } = await supabaseRest<R[]>(
        "GET",
        `/rest/v1/users?id=eq.${encodeURIComponent(data.user_id)}&select=id,supabase_auth_id`,
      );
      expect(pubStatus).toBe(200);
      expect(Array.isArray(pubData)).toBe(true);
      expect(pubData.length).toBe(1);
      expect(pubData[0].id).toBe(data.user_id);
      expect(pubData[0].supabase_auth_id).toBe(SUPABASE_AUTH_ID);
    });
  });

  // ── Contract 2 ──
  // DELETE /api/projects/:id?force=true cascades to child rows (no orphans).
  //
  // Why mocking can't catch this: the contract is "every project-keyed table
  // has ON DELETE CASCADE in the FK definition." A regression is a missing
  // CASCADE clause in a migration — only a real Postgres roundtrip with
  // direct row counting can prove it.
  //
  // We seed the project with rows in tables we KNOW are project-keyed
  // (project_members is auto-populated; activity_log we write to via the
  // route; project_invites we mint), force-delete, then assert all of
  // them are gone.
  describe("DELETE /api/projects/:id?force=true — FK CASCADE drops child rows", () => {
    let projectId = "";

    it("seeds a project with rows in multiple child tables", async () => {
      // POST /api/projects → row in projects + project_members (owner role)
      const projectName = `cascade-test-${Date.now()}`;
      const create = await api("POST", "/api/projects", KEY, { name: projectName });
      expect(create.status).toBe(201);
      projectId = create.data.id as string;
      expect(projectId).toBeTruthy();

      // Mint an invite → row in project_invites
      const invite = await api("POST", `/api/projects/${projectId}/invites`, KEY, {
        email: `invitee-${Date.now()}@synapsesync.app`,
      });
      expect(invite.status).toBe(200);
      expect(invite.data.token).toBeTruthy();

      // Sanity: rows exist BEFORE the delete.
      const { data: invitesBefore } = await supabaseRest<R[]>(
        "GET",
        `/rest/v1/project_invites?project_id=eq.${projectId}&select=token`,
      );
      expect(Array.isArray(invitesBefore)).toBe(true);
      expect(invitesBefore.length).toBeGreaterThanOrEqual(1);

      const { data: membersBefore } = await supabaseRest<R[]>(
        "GET",
        `/rest/v1/project_members?project_id=eq.${projectId}&select=user_id`,
      );
      expect(Array.isArray(membersBefore)).toBe(true);
      expect(membersBefore.length).toBeGreaterThanOrEqual(1);
    });

    it("force-delete cascades — no orphaned rows in child tables", async () => {
      // ?force=true bypasses the PROJECT_NOT_EMPTY check.
      const del = await api("DELETE", `/api/projects/${projectId}?force=true`, KEY);
      expect(del.status).toBe(200);
      expect(del.data.ok).toBe(true);

      // Verify EVERY child table that references projects.id has no
      // remaining rows for this project. If a CASCADE clause was dropped
      // from one of these tables' FK definitions, the row stays — that's
      // the orphan we're guarding against.
      const tablesToCheck = ["project_members", "project_invites", "activity_log", "share_links"];
      for (const table of tablesToCheck) {
        const { status, data } = await supabaseRest<R[]>(
          "GET",
          `/rest/v1/${table}?project_id=eq.${projectId}&select=*`,
        );
        expect(status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length, `Orphan rows remain in ${table} after project DELETE`).toBe(0);
      }

      // And the projects row itself is gone.
      const { data: projectAfter } = await supabaseRest<R[]>("GET", `/rest/v1/projects?id=eq.${projectId}&select=id`);
      expect(Array.isArray(projectAfter)).toBe(true);
      expect(projectAfter.length).toBe(0);
    });
  });

  // ── Cleanup ──
  afterAll(async () => {
    // Belt-and-suspenders: backend's DELETE /api/account first, then the
    // Supabase auth admin endpoint. Either alone would suffice; both
    // together guarantee zero rows linger across runs.
    if (KEY) {
      try {
        await api("DELETE", "/api/account", KEY);
      } catch {
        // already deleted or key invalid
      }
    }
    if (SUPABASE_AUTH_ID && SUPABASE_URL && SUPABASE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${SUPABASE_AUTH_ID}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        });
      } catch {
        // best-effort cleanup
      }
    }
  });
});
