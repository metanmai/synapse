import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent } from "../../src/capture/events-log.js";
import { runFlushCycle } from "../../src/capture/handoff-sync.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-crash-"));
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("crash resilience", () => {
  it("survives interrupted flush and resumes from watermark on next cycle", async () => {
    let callCount = 0;
    global.fetch = (async () => {
      callCount++;
      if (callCount === 1) throw new Error("network kill");
      return new Response(JSON.stringify({ accepted: 2 }), { status: 200 });
    }) as typeof fetch;

    const dir = path.join(tmp, "projects/p");
    fs.mkdirSync(dir, { recursive: true });
    appendEvent(dir, makeEv());
    appendEvent(dir, makeEv());

    await expect(runFlushCycle({ project_id: "p", api_key: "k", api_url: "http://x" })).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, ".watermark"))).toBe(false);

    await runFlushCycle({ project_id: "p", api_key: "k", api_url: "http://x" });
    const wm = fs.readFileSync(path.join(dir, ".watermark"), "utf-8").trim();
    expect(wm).toMatch(/.+/); // some event id is now the watermark; nothing was lost
  });
});

function makeEv() {
  return {
    project_id: "p",
    session_id: "s",
    actor: actor(),
    attached_to: null,
    kind: "tool_used" as const,
    occurred_at: new Date().toISOString(),
    payload: {},
  };
}
function actor() {
  return { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" };
}
