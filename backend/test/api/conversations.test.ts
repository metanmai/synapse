import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

describe("Conversations API — auth enforcement", () => {
  it("POST /api/conversations without auth returns 401", async () => {
    const req = new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: FAKE_UUID,
        title: "Test conversation",
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/conversations without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/conversations?project_id=${FAKE_UUID}`);
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/conversations/:id without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/conversations/${FAKE_UUID}`);
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("PATCH /api/conversations/:id without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/conversations/${FAKE_UUID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/conversations/:id/messages without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/conversations/${FAKE_UUID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Hello", source_agent: "test" },
        ],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/conversations/:id/media without auth returns 401", async () => {
    const formData = new FormData();
    formData.append("file", new Blob(["test"]), "test.txt");
    formData.append("message_id", FAKE_UUID);
    const req = new Request(`http://localhost/api/conversations/${FAKE_UUID}/media`, {
      method: "POST",
      body: formData,
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/conversations/:id/media/:mediaId without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/conversations/${FAKE_UUID}/media/${FAKE_UUID}`);
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("POST /api/conversations/import without auth returns 401", async () => {
    const req = new Request("http://localhost/api/conversations/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: FAKE_UUID,
        messages: [],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/conversations/:id/export/:format without auth returns 401", async () => {
    const req = new Request(`http://localhost/api/conversations/${FAKE_UUID}/export/anthropic`);
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
