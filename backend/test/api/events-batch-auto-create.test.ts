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
