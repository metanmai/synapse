// POST /api/projects/:id/invites — auth + invite-mint contracts.
//
// Three data-path contracts (in addition to the auth gate):
//   - 400 when the request body is missing the `email` field
//   - 403 when the caller is not a member of the project
//   - 200 with `{ token, join_url, expires_at }` shape on success
//
// All implemented against a mocked Supabase client (see test/helpers/supabase-mock.ts).

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

describe("Project invites API — auth enforcement", () => {
  it("POST /api/projects/:id/invites without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/invites/:token/accept without auth returns 401", async () => {
    const req = new Request("http://localhost/api/invites/some-token/accept", { method: "POST" });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("route is registered (not 404) when an Authorization header is present", async () => {
    // With an invalid bearer the auth middleware 401s — that's enough to
    // prove the route exists. A missing route would be 404.
    const db = makeMockSupabase();
    setMockDb(db);
    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid-token" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });
});

describe("POST /api/projects/:id/invites — data paths (mocked Supabase)", () => {
  beforeEach(() => {
    resetMockState();
  });

  it("returns 400 when email is missing from the request body", async () => {
    // Bug class: route accepts `{}` and mints a token for the empty-string
    // email. parseInviteRequestBody MUST reject before the membership
    // check happens, so an attacker can't even probe project membership
    // by sending bodies with random shapes.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "alice@t.test" });
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}/invites`, {
      method: "POST",
      headers: bearer("k"),
      body: JSON.stringify({}), // no email key
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    // Permissive: just confirm the response shape includes an error.
    expect(body.error).toBeTruthy();
  });

  it("returns 403 when caller is NOT a member of the project", async () => {
    // Security contract: only existing members can invite others. The
    // route MUST hit project_members first and bail with 403 before any
    // invite token is generated. A 403→200 regression here is a wide
    // hole (anyone with a valid API key could mint invites for any
    // project's id).
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "alice@t.test" });
    // project_members.maybeSingle returns null → not a member.
    db.tables.project_members = { maybeSingle: () => ({ data: null, error: null }) };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}/invites`, {
      method: "POST",
      headers: bearer("k"),
      body: JSON.stringify({ email: "bob@t.test" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeTruthy();
    // Authz denial MUST happen before any project_invites insert.
    const invitesInserts = db.calls.filter((c) => c.table === "project_invites" && c.op === "insert");
    expect(invitesInserts).toHaveLength(0);
  });

  it("returns 200 with { token, join_url, expires_at } on success", async () => {
    // Contract pin: the response carries all three fields so the inviter
    // can copy the join_url manually (email delivery is deferred per
    // invites.ts:73-75). A regression that dropped `join_url` would break
    // the CLI's `synapsesync invite` output.
    const db = makeMockSupabase();
    seedApiKeyAuth(db, { id: "user-1", email: "alice@t.test" });
    // Caller is a member.
    db.tables.project_members = {
      maybeSingle: () => ({ data: { user_id: "user-1" }, error: null }),
      count: 1, // for countMembers (used by enforceMemberLimitForTier)
    };
    // Project lookup → owner_id.
    db.tables.projects = {
      maybeSingle: () => ({ data: { owner_id: "user-1" }, error: null }),
    };
    // Owner tier: no subscription = free. enforceMemberLimitForTier allows
    // up to 3 members on free — count: 1 above is well under the cap.
    db.tables.subscriptions = { maybeSingle: () => ({ data: null, error: null }) };
    // project_invites insert succeeds.
    db.tables.project_invites = { insert: () => ({ data: null, error: null }) };
    setMockDb(db);

    const req = new Request(`http://localhost/api/projects/${PROJECT_ID}/invites`, {
      method: "POST",
      headers: bearer("k"),
      body: JSON.stringify({ email: "bob@t.test" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; join_url?: string; expires_at?: string };
    expect(typeof body.token).toBe("string");
    expect(body.token?.length).toBeGreaterThan(0);
    // join_url shape pinned in invites-pure.test.ts; here we just confirm
    // it's a non-empty string the response includes.
    expect(typeof body.join_url).toBe("string");
    expect(body.join_url).toContain(body.token ?? "");
    // expires_at is an ISO string (computeInviteExpiresAt's output).
    expect(typeof body.expires_at).toBe("string");
    expect(() => new Date(body.expires_at ?? "")).not.toThrow();
  });
});
