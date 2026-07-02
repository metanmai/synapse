// DELETE /api/projects/:id — owner-only project deletion.
//
// Default behavior is "refuse if non-empty" (409 PROJECT_NOT_EMPTY); a
// ?force=true query param bypasses the safety check. Contracts:
//   - 200 + { ok: true, deleted_project_id, name } on empty + owner
//   - 409 PROJECT_NOT_EMPTY when project has conversations/insights and no ?force
//   - 200 with ?force=true even when project has children
//   - 403 when caller is NOT an owner
//   - 404 when project does not exist (requireRole maps "no role" to NotFoundError)
//   - cascade no-orphans is a SCHEMA contract (FK ON DELETE CASCADE), exercised
//     in mcp/test/e2e/backend-contracts.test.ts where a real Postgres roundtrip
//     proves the FK tree actually drops the children.

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

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

describe("DELETE /api/projects/:id — auth enforcement", () => {
  it("DELETE without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id", { method: "DELETE" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE without auth returns 401 even with ?force=true", async () => {
    // The force flag MUST NOT bypass authentication — it only bypasses the
    // is-empty safety check post-auth.
    const req = new Request("http://localhost/api/projects/some-id?force=true", { method: "DELETE" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE without auth returns 401 even with a UUID-shaped path", async () => {
    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}`, { method: "DELETE" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/projects/:id — data paths (mocked Supabase)", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns 200 + { ok: true, deleted_project_id, name } when project is empty and user is owner", async () => {
    // Contract: status 200, body MUST echo the deleted project's name so a
    // CLI/UI can confirm what got removed ("Project 'foo' deleted") without
    // a follow-up GET. Dropping `name` from the response would silently
    // break the synapsesync purge-empty UX (BUG-MD #4).
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    // requireRole(projectId, userId, "owner") → getMemberRole → owner
    db.tables.project_members = {
      single: () => ({ data: { role: "owner" }, error: null }),
    };
    // getProjectStats: 0 conversations, 0 insights (the project is empty).
    // getProjectStats issues TWO awaited selects — both return count: 0
    // via the default `select` path (the route reads .count off the Promise
    // result, which our mock surfaces via `count: 0` when head:true OR via
    // the data array length when not). Configure both.
    db.tables.conversations = { count: 0, select: () => ({ data: [], count: 0, error: null }) };
    db.tables.insights = { count: 0, select: () => ({ data: [], count: 0, error: null }) };
    // After the empty check, the route reads the project's name then deletes.
    db.tables.projects = {
      single: () => ({ data: { name: "my-empty-project" }, error: null }),
      delete: () => ({ data: null, error: null }),
    };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}`, {
      method: "DELETE",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; deleted_project_id?: string; name?: string };
    expect(body.ok).toBe(true);
    expect(body.deleted_project_id).toBe(PROJECT_ID);
    expect(body.name).toBe("my-empty-project");
    // Sanity: the projects.delete actually fired.
    const projectDeletes = db.calls.filter((c) => c.table === "projects" && c.op === "delete");
    expect(projectDeletes).toHaveLength(1);
  });

  it("returns 409 PROJECT_NOT_EMPTY when project has conversations and no ?force", async () => {
    // Critical safety contract: a user-driven DELETE must NOT silently
    // destroy data. The 409 body MUST include conversation_count +
    // insight_count so the caller can decide how to proceed (merge into
    // another project, or pass ?force=true to accept the loss).
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.project_members = {
      single: () => ({ data: { role: "owner" }, error: null }),
    };
    // 5 conversations, 2 insights — project is NOT empty.
    db.tables.conversations = { count: 5, select: () => ({ data: [], count: 5, error: null }) };
    db.tables.insights = { count: 2, select: () => ({ data: [], count: 2, error: null }) };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}`, {
      method: "DELETE",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code?: string;
      conversation_count?: number;
      insight_count?: number;
    };
    expect(body.code).toBe("PROJECT_NOT_EMPTY");
    expect(body.conversation_count).toBe(5);
    expect(body.insight_count).toBe(2);
    // Crucially: the delete must NOT have happened.
    const projectDeletes = db.calls.filter((c) => c.table === "projects" && c.op === "delete");
    expect(projectDeletes).toHaveLength(0);
  });

  it("returns 200 with ?force=true even when project has children", async () => {
    // The escape hatch contract: an authenticated owner can always delete
    // their own project — no data is more important than user agency. The
    // route MUST skip the conversation/insight count check entirely when
    // ?force=true is set, going straight to the delete.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.project_members = {
      single: () => ({ data: { role: "owner" }, error: null }),
    };
    // Even though counts are nonzero, ?force=true should bypass the check.
    db.tables.conversations = { count: 10, select: () => ({ data: [], count: 10, error: null }) };
    db.tables.insights = { count: 5, select: () => ({ data: [], count: 5, error: null }) };
    db.tables.projects = {
      single: () => ({ data: { name: "force-deleted" }, error: null }),
      delete: () => ({ data: null, error: null }),
    };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}?force=true`, {
      method: "DELETE",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; name?: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("force-deleted");
  });

  it("returns 403 when user is NOT an owner of the project (editor role)", async () => {
    // Security contract: an editor on a shared project can append data but
    // CANNOT destroy the project. requireRole("owner") enforces this; the
    // same gate guards POST /merge-into and DELETE /:id/members/:email.
    // Bug class: a 403→500 regression makes the failure mode opaque; a
    // 403→200 regression is catastrophic (shared-project users could
    // nuke each other's projects).
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.project_members = {
      single: () => ({ data: { role: "editor" }, error: null }),
    };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}`, {
      method: "DELETE",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    // No delete fired.
    const projectDeletes = db.calls.filter((c) => c.table === "projects" && c.op === "delete");
    expect(projectDeletes).toHaveLength(0);
  });

  it("returns 404 when project does not exist (caller has no membership)", async () => {
    // requireRole maps "no membership" to NotFoundError → 404. This is the
    // same response shape as "project exists but caller is not a member" —
    // intentional, so an attacker can't probe for project existence.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    // project_members.single returns PGRST116-style "no row" — singleOrNull
    // turns that into `null`, and requireRole then throws NotFoundError.
    db.tables.project_members = {
      single: () => ({ data: null, error: { code: "PGRST116", message: "no rows" } }),
    };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}`, {
      method: "DELETE",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(404);
  });
});

// NOTE: The "cascade removes all child rows in one transaction (no orphans)"
// contract is a SCHEMA-level guarantee (every project-referencing table has
// ON DELETE CASCADE — see migration history). Mocking it here would only
// prove the mock is consistent, not that the FK tree behaves as intended.
// That contract lives in mcp/test/e2e/backend-contracts.test.ts which runs
// against a real test Supabase, seeds the project with rows in every child
// table, force-deletes, and asserts the children are gone.
