// POST /api/projects/:id/merge-into/:target_id — auth + ownership + RPC contracts.
//
// Five data-path contracts (in addition to the auth gate):
//   - 200 + { ok: true, project_id } when user owns BOTH source and target
//   - 403 when user is NOT owner of source
//   - 403 when user is NOT owner of target
//   - 409 SELF_LINK_ERROR when source === target
//   - activity_log INSERT runs on successful merge
//
// Implemented against a mocked Supabase client (test/helpers/supabase-mock.ts).
// The pure RPC (merge_projects) is exercised in CI's full-e2e job — here we
// only contract the route's auth/dispatch/response shape.

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

const SOURCE_ID = "00000000-0000-0000-0000-000000000001";
const TARGET_ID = "00000000-0000-0000-0000-000000000002";

describe("POST /api/projects/:id/merge-into/:target_id — auth enforcement", () => {
  it("POST without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, { method: "POST" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST without auth returns 401 even with a JSON body", async () => {
    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST without auth returns 401 even with UUID-shaped path params", async () => {
    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, { method: "POST" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/projects/:id/merge-into/:target_id — data paths (mocked Supabase)", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns 409 SELF_LINK_ERROR when source === target", async () => {
    // Defensive contract: the route MUST reject self-merge BEFORE the RPC
    // (which would otherwise empty-rewrite the project's events into
    // itself — a no-op that's confusing and burns a DB roundtrip). The
    // body.code === "SELF_LINK_ERROR" so a frontend can present the
    // specific error rather than a generic "merge failed."
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${SOURCE_ID}`, {
      method: "POST",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("SELF_LINK_ERROR");
    // RPC must NOT have been called.
    const rpcCalls = db.calls.filter((c) => c.table === "rpc:merge_projects");
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 403 when user is NOT owner of source", async () => {
    // Security contract (T-02-01): cross-user merge-leak guard. The route
    // MUST run requireRole("owner") on the source BEFORE touching the
    // RPC. A 403→500 regression would be visible (caller sees opaque
    // error) but a 403→200 regression would silently move events between
    // projects belonging to different users.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    // project_members.single (getMemberRole): no row → throws PGRST116
    // → returns null → requireRole throws NotFoundError → maps to 404.
    // BUT requireRole maps "no role" to NotFoundError("Project not found"),
    // which is 404 not 403. The 403 path requires "has a role but it's not
    // owner." Configure member-but-not-owner.
    db.tables.project_members = {
      single: () => ({ data: { role: "editor" }, error: null }),
    };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, {
      method: "POST",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    // RPC must NOT have been called.
    const rpcCalls = db.calls.filter((c) => c.table === "rpc:merge_projects");
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 403 when user is NOT owner of target (owner of source, viewer of target)", async () => {
    // Both directions guarded — checking source ownership alone would let
    // an editor on the target's project (who is owner of some other
    // project) move events INTO a project they don't own.
    //
    // The route hits requireRole(source) then requireRole(target). To
    // simulate "owner of source, NOT owner of target," we need the
    // project_members.single behavior to vary by call. Use a counter.
    let call = 0;
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.project_members = {
      single: () => {
        call += 1;
        // 1st call (source): owner. 2nd call (target): editor.
        return call === 1 ? { data: { role: "owner" }, error: null } : { data: { role: "editor" }, error: null };
      },
    };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, {
      method: "POST",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    // RPC must NOT have been called (auth check failed on target).
    const rpcCalls = db.calls.filter((c) => c.table === "rpc:merge_projects");
    expect(rpcCalls).toHaveLength(0);
  });

  it("returns 200 + { ok: true, project_id } when user owns BOTH source and target", async () => {
    // Contract pin: body MUST include `ok: true` and `project_id: <target_id>`
    // (the source is gone post-merge). Frontend's LinkPicker.svelte reads
    // these two fields; dropping either breaks the success-path navigation.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    // Both source and target return owner role.
    db.tables.project_members = {
      single: () => ({ data: { role: "owner" }, error: null }),
    };
    // merge_projects RPC succeeds.
    db.rpc.merge_projects = () => ({ data: null, error: null });
    // activity_log insert succeeds (logActivity is best-effort).
    db.tables.activity_log = { insert: () => ({ data: null, error: null }) };
    // recomputeProjectStatus reads handoff_project_status — null is fine
    // (cold path: full recompute on empty handoff_events).
    db.tables.handoff_project_status = {
      maybeSingle: () => ({ data: null, error: null }),
      upsert: () => ({ data: null, error: null }),
    };
    db.tables.handoff_events = { select: () => ({ data: [], error: null }) };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, {
      method: "POST",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; project_id?: string };
    expect(body.ok).toBe(true);
    expect(body.project_id).toBe(TARGET_ID);
  });

  it("writes an activity_log entry on successful merge", async () => {
    // Audit contract: every destructive action MUST leave an activity_log
    // row so users can investigate "where did my project go?" after the
    // fact. Without this row, a merged-away project is unrecoverable AND
    // its history is invisible — the user has no way to see what
    // happened.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });
    db.tables.project_members = {
      single: () => ({ data: { role: "owner" }, error: null }),
    };
    db.rpc.merge_projects = () => ({ data: null, error: null });
    db.tables.activity_log = { insert: () => ({ data: null, error: null }) };
    db.tables.handoff_project_status = {
      maybeSingle: () => ({ data: null, error: null }),
      upsert: () => ({ data: null, error: null }),
    };
    db.tables.handoff_events = { select: () => ({ data: [], error: null }) };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${SOURCE_ID}/merge-into/${TARGET_ID}`, {
      method: "POST",
      headers: bearer("k"),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const activityInserts = db.calls.filter((c) => c.table === "activity_log" && c.op === "insert");
    expect(activityInserts).toHaveLength(1);
    // The args carry the action — pin the value so a typo in the action
    // name (e.g. "project_merge" vs "project_merged") is caught.
    const args = activityInserts[0].args as {
      action?: string;
      project_id?: string;
      metadata?: { source_project_id?: string };
    };
    expect(args.action).toBe("project_merged");
    expect(args.project_id).toBe(TARGET_ID);
    expect(args.metadata?.source_project_id).toBe(SOURCE_ID);
  });
});
