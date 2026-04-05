// mcp/test/unit/distill/writer.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedFile } from "../../../src/distill/parser.js";
import { DistillWriter } from "../../../src/distill/writer.js";

describe("DistillWriter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.SYNAPSE_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env.SYNAPSE_API_KEY = undefined;
  });

  it("writes each extracted file via the Synapse API", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const writer = new DistillWriter("test-key", "my-project");
    const files: ExtractedFile[] = [
      { path: "decisions/chose-redis.md", content: "# Chose Redis", tags: ["decision"] },
      { path: "learnings/gotcha.md", content: "# Gotcha", tags: ["learning"] },
    ];

    const count = await writer.writeAll(files);
    expect(count).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify API call structure
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/context/save");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.path).toBe("decisions/chose-redis.md");
    expect(body.content).toContain("Chose Redis");
    expect(body.project).toBe("my-project");
    expect(body.tags).toEqual(["decision"]);
  });

  it("returns 0 for empty file list", async () => {
    const writer = new DistillWriter("test-key", "my-project");
    const count = await writer.writeAll([]);
    expect(count).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("continues writing remaining files if one fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const logs: string[] = [];
    const writer = new DistillWriter("test-key", "my-project", (msg) => logs.push(msg));
    const files: ExtractedFile[] = [
      { path: "decisions/fail.md", content: "# Fail", tags: [] },
      { path: "decisions/ok.md", content: "# OK", tags: [] },
    ];

    const count = await writer.writeAll(files);
    expect(count).toBe(1);
    expect(logs.some((l) => l.includes("fail.md"))).toBe(true);
  });
});
