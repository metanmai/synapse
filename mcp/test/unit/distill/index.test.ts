// mcp/test/unit/distill/index.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapturedSession } from "../../../src/capture/types.js";
import { distillSession } from "../../../src/distill/index.js";

describe("distillSession", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const session: CapturedSession = {
    id: "ses_test1234567890",
    tool: "claude-code",
    projectPath: "/tmp/project",
    startedAt: "2026-04-02T10:00:00Z",
    updatedAt: "2026-04-02T10:30:00Z",
    messages: [
      { role: "user", content: "Should we use Redis or Memcached?", timestamp: "2026-04-02T10:00:00Z" },
      {
        role: "assistant",
        content: "Redis is better here because of pub/sub support.",
        timestamp: "2026-04-02T10:00:05Z",
      },
    ],
  };

  it("runs the full pipeline: prompt → LLM → parse → write", async () => {
    // Mock Anthropic API
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify([
                  {
                    path: "decisions/chose-redis.md",
                    content: "# Chose Redis\n\nBecause pub/sub.",
                    tags: ["decision"],
                  },
                ]),
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      // Mock Synapse write API
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await distillSession(session, {
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      synapseApiKey: "synapse-key",
      project: "my-project",
    });

    expect(result.filesWritten).toBe(1);
    expect(result.files[0].path).toBe("decisions/chose-redis.md");
  });

  it("returns 0 files when LLM extracts nothing", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ content: [{ type: "text", text: "[]" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await distillSession(session, {
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-6",
      synapseApiKey: "synapse-key",
      project: "my-project",
    });

    expect(result.filesWritten).toBe(0);
    expect(result.files).toEqual([]);
  });

  it("throws when LLM provider fails", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(
      distillSession(session, {
        provider: "anthropic",
        apiKey: "bad-key",
        model: "claude-sonnet-4-6",
        synapseApiKey: "synapse-key",
        project: "my-project",
      }),
    ).rejects.toThrow();
  });
});
