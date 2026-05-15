import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFlushCycle } from "../../src/capture/handoff-sync.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-sync-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("runFlushCycle", () => {
  it("posts unflushed events and updates watermark", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "projects/p1/events.jsonl"),
      `${[makeEv("01HZA"), makeEv("01HZB")].map((e) => JSON.stringify(e)).join("\n")}\n`,
    );

    const calls: Array<{ url: string; body: { events: unknown[] } }> = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ accepted: 2, duplicates: 0 }), { status: 200 });
    }) as typeof fetch;

    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(2);
    expect(calls[0].body.events).toHaveLength(2);

    const wm = fs.readFileSync(path.join(tmp, "projects/p1/.watermark"), "utf-8").trim();
    expect(wm).toBe("01HZB");
  });

  it("does not re-flush events already past the watermark", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), `${JSON.stringify(makeEv("01HZA"))}\n`);
    fs.writeFileSync(path.join(tmp, "projects/p1/.watermark"), "01HZA");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;
    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(0);
  });
});

function makeEv(id: string) {
  return {
    event_id: id,
    project_id: "p1",
    session_id: "s",
    actor: { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null,
    kind: "session_opened" as const,
    occurred_at: "2026-05-11T09:00:00Z",
    received_at: "2026-05-11T09:00:01Z",
    payload: {},
  };
}
