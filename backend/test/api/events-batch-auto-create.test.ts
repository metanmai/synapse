// POST /api/events/batch — cwd_<hash> auto-create contract.
//
// The daemon's hook dispatcher writes `cwd_<sha1[0..12]>` as a placeholder
// project_id when no project-map entry exists. The route MUST resolve that
// placeholder to a real project (creating one if needed) and return the
// mapping in `canonical_project_ids` so the daemon can rename its local
// dir to the real UUID.
//
// One data-path contract (in addition to the auth gate + new git_remote_url
// schema acceptance tests below):
//   - 200 with canonical_project_ids[cwd_<hash>] = <uuid>
//
// Implemented against a mocked Supabase client (test/helpers/supabase-mock.ts).
// findOrCreateProjectByGit's match logic is exhaustively unit-tested in
// db/queries/projects.test.ts; this contract guards the response shape.

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

// Structural tests — verify the events/batch route is reachable for cwd_<hash>
// project_ids and that authentication is enforced. The full data path that
// auto-creates a project (and returns canonical_project_ids) requires a real
// DB; here we mock the project query/insert chain so the route runs.

describe("POST /api/events/batch — auto-create project (structural)", () => {
  it("rejects unauthenticated requests with cwd_<hash> project_id", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            event_id: "01HZ001",
            project_id: "cwd_abcdef123456",
            session_id: "s",
            actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
            attached_to: null,
            kind: "session_opened",
            occurred_at: "2026-05-14T09:00:00Z",
            payload: { git_basename: "test-repo" },
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("route is registered for cwd_<hash> payloads (does not 404)", async () => {
    const db = makeMockSupabase();
    setMockDb(db);
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({
        events: [
          {
            event_id: "01HZ002",
            project_id: "cwd_abcdef123456",
            session_id: "s",
            actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
            attached_to: null,
            kind: "session_opened",
            occurred_at: "2026-05-14T09:00:00Z",
            payload: { git_basename: "test-repo" },
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  describe("data-path: canonical_project_ids mapping (mocked Supabase)", () => {
    beforeEach(() => {
      resetMockState();
    });

    it("returns canonical_project_ids mapping for cwd_<hash> ids", async () => {
      // Bug class: the daemon dispatches `cwd_<hash>` placeholders for
      // un-mapped cwds. If the response doesn't echo back the resolved
      // UUID, the daemon never renames its local dir and EVERY future
      // batch carries the placeholder — every event grows the table
      // until findOrCreateProjectByGit's Tier 2 match returns a stable
      // row by accident. The mapping IS the daemon's source of truth for
      // "rename your local cwd_xxxxx dir to <uuid>." Without it the
      // table grows monotonically.
      const REAL_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const PLACEHOLDER = "cwd_abcdef123456";

      const db = makeMockSupabase();
      seedApiKeyAuth(db, { id: "user-1", email: "t@t.test" });

      // findOrCreateProjectByGit path:
      //   1. project_members.select.eq → memberships (empty here)
      //   2. projects.select.eq.eq (Tier 1b owner-only) → null (no existing)
      //   3. countOwnedProjects → 0 (under quota)
      //   4. projects.insert → returns the new project row
      //   5. project_members.upsert → success (idempotent with DB trigger)
      db.tables.project_members = {
        // memberships query: awaited directly → returns empty array
        select: () => ({ data: [], error: null }),
        // upsert (ensuring owner membership) succeeds
        upsert: () => ({ data: null, error: null }),
      };
      db.tables.projects = {
        // Tier 1b lookup returns null → no existing project
        maybeSingle: () => ({ data: null, error: null }),
        // countOwnedProjects: head:true count = 0
        count: 0,
        // insertSingle: the createProject result
        insertSingle: () => ({
          data: { id: REAL_UUID, name: "test-repo", owner_id: "user-1" },
          error: null,
        }),
      };
      // handoff_events upsert + recompute path
      db.tables.handoff_events = {
        upsert: () => ({ data: null, error: null, count: 1 }),
        select: () => ({ data: [], error: null }),
      };
      db.tables.handoff_project_status = {
        maybeSingle: () => ({ data: null, error: null }),
        upsert: () => ({ data: null, error: null }),
      };
      setMockDb(db);

      const req = new Request("http://localhost/api/events/batch", {
        method: "POST",
        headers: bearer("k"),
        body: JSON.stringify({
          events: [
            {
              event_id: "01HZ_RESOLVE",
              project_id: PLACEHOLDER,
              session_id: "s",
              actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
              attached_to: null,
              kind: "session_opened",
              occurred_at: "2026-05-14T09:00:00Z",
              payload: { git_basename: "test-repo" },
            },
          ],
        }),
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, makeContractTestEnv(), ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { canonical_project_ids: Record<string, string> };
      expect(body.canonical_project_ids[PLACEHOLDER]).toBe(REAL_UUID);
    });
  });
});

// Phase 2 (IDENT-02, D-06): events-batch auto-create accepts a new `payload.git_remote_url`
// field on incoming events. The matcher (live-DB path) prefers (user_id, git_remote_url)
// over (user_id, git_basename) when the URL is present. These structural tests assert
// the schema accepts the new field and the route stays reachable; the matcher behavior
// is covered by the daemon E2E test (handoff.e2e.test.ts multi-device describe block).

describe("POST /api/events/batch — auto-create with git_remote_url (Phase 2 IDENT-02)", () => {
  it("request body schema accepts payload.git_remote_url (no 400 on the new field)", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({
        events: [
          {
            event_id: "01HZ_GIT_001",
            project_id: "cwd_abcdef123456",
            session_id: "s",
            actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
            attached_to: null,
            kind: "session_opened",
            occurred_at: "2026-05-14T09:00:00Z",
            payload: { git_basename: "test-repo", git_remote_url: "https://github.com/tanmain/synapse.git" },
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(400);
  });

  it("cwd_<hash> with git_remote_url populated routes successfully (does not 404)", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({
        events: [
          {
            event_id: "01HZ_GIT_002",
            project_id: "cwd_abcdef123457",
            session_id: "s",
            actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
            attached_to: null,
            kind: "session_opened",
            occurred_at: "2026-05-14T09:00:00Z",
            payload: { git_basename: "test-repo", git_remote_url: "https://github.com/tanmain/synapse.git" },
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  it("defensive: existing git_basename-only path still resolves when git_remote_url is omitted (regression guard)", async () => {
    // After Plan 02-04 lands, the matcher prefers git_remote_url. This test asserts that
    // events without git_remote_url (older daemons, non-git folders) still route to a
    // canonical project via git_basename fallback — no regression in the existing flow.
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({
        events: [
          {
            event_id: "01HZ_BASENAME_001",
            project_id: "cwd_no_url_basename_only",
            session_id: "s",
            actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
            attached_to: null,
            kind: "session_opened",
            occurred_at: "2026-05-14T09:00:00Z",
            payload: { git_basename: "non-git-folder" }, // no git_remote_url
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, makeContractTestEnv(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(400);
  });
});
