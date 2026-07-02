// GET /api/projects/:id/status — auth + data-path contracts.
//
// The route reads `handoff_project_status` for the project_id. Two
// contracts beyond the auth gate:
//   - 404 when no status row exists for the project
//   - 200 + ProjectStatus body when a row exists
//
// Implemented against a mocked Supabase client (see test/helpers/supabase-mock.ts)
// because @cloudflare/vitest-pool-workers 0.13.2 doesn't expose fetchMock
// and the test env has no SUPABASE_URL.

import { vi } from "vitest";
import { __mockState__ } from "../helpers/supabase-mock";

vi.mock("../../src/db/client", () => ({
  createSupabaseClient: () => __mockState__.db?.client,
}));

import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import {
  bearer,
  makeContractTestEnv,
  makeMockSupabase,
  resetMockState,
  seedApiKeyAuth,
  setMockDb,
} from "../helpers/supabase-mock";
import { createExecutionContext, waitOnExecutionContext } from "../setup";

describe("GET /api/projects/:id/status — auth enforcement", () => {
  it("returns 401 without a bearer token", async () => {
    const req = new Request("http://localhost/api/projects/test-project-id/status");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed bearer token", async () => {
    // No api_keys row matches the bogus token → authMiddleware rejects.
    const db = makeMockSupabase();
    setMockDb(db);
    const req = new Request("http://localhost/api/projects/test-project-id/status", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/projects/:id/status — data paths", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns 404 when no status row exists for the project", async () => {
    // Bug class: a project with no events yet has no handoff_project_status
    // row. The route must distinguish that from "DB error" — a 500 would tell
    // the daemon to back off and retry; a 404 means "nothing to fetch yet,
    // try again later." The maybeSingle() returning `{ data: null }` is the
    // signal.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    // handoff_project_status: no row → maybeSingle returns { data: null }
    db.tables.handoff_project_status = { maybeSingle: () => ({ data: null, error: null }) };
    setMockDb(db);

    const req = new Request("http://localhost/api/projects/missing-status-id/status", {
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("returns 200 with the ProjectStatus body when a row exists", async () => {
    // Contract: the route returns the `status` jsonb column verbatim — the
    // daemon and frontend both parse the result as a ProjectStatus object.
    // A regression that wrapped it in `{ status: ... }` would silently break
    // every brief render. The body MUST be the inner object directly.
    const sampleStatus = {
      project_id: "proj-1",
      headline: "Working on auth",
      next_step: { description: "Wire OTP", suggested_by: { kind: "human" } },
      recent_activity: [],
      open_questions: [],
    };
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.handoff_project_status = {
      maybeSingle: () => ({ data: { status: sampleStatus }, error: null }),
    };
    setMockDb(db);

    const req = new Request("http://localhost/api/projects/proj-1/status", { headers: bearer("k") });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(sampleStatus);
  });
});
