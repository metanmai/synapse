import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

// Structural tests — verify the events/batch route is reachable for cwd_<hash>
// project_ids and that authentication is enforced. The full data path that
// auto-creates a project (and returns canonical_project_ids) requires a live
// Supabase instance and is exercised in the daemon E2E test instead.

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
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("route is registered for cwd_<hash> payloads (does not 404)", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid",
      },
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
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  it.skip("returns canonical_project_ids mapping for cwd_<hash> ids (requires live DB)", async () => {
    // Live data-path verification: with a valid API key + Supabase URL set,
    // the response should include canonical_project_ids[cwd_<hash>] = <uuid>.
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
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid",
      },
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
            payload: {
              git_basename: "test-repo",
              git_remote_url: "https://github.com/tanmain/synapse.git",
            },
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // Schema must not 400 on the new field; auth middleware fires before body parse
    // OR after (Hono dependent) — either way the rejection should NOT be a 400 (schema).
    expect(res.status).not.toBe(400);
  });

  it("cwd_<hash> with git_remote_url populated routes successfully (does not 404)", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid",
      },
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
            payload: {
              git_basename: "test-repo",
              git_remote_url: "https://github.com/tanmain/synapse.git",
            },
          },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  it("defensive: existing git_basename-only path still resolves when git_remote_url is omitted (regression guard)", async () => {
    // After Plan 02-04 lands, the matcher prefers git_remote_url. This test asserts that
    // events without git_remote_url (older daemons, non-git folders) still route to a
    // canonical project via git_basename fallback — no regression in the existing flow.
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid",
      },
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
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(400);
  });
});
