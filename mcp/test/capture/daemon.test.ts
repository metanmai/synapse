import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHandoffLoop } from "../../src/capture/daemon.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-daemon-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("handoff daemon loop", () => {
  it("touches healthcheck file periodically", async () => {
    const stop = startHandoffLoop({
      projects: ["p1"],
      api_key: "k",
      api_url: "https://api.test",
      pull_ms: 100,
      healthcheck_ms: 100,
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(fs.existsSync(path.join(tmp, "daemon.healthcheck"))).toBe(true);
    stop();
  });

  it("processes flush-now signal immediately", async () => {
    global.fetch = vi.fn(async () => new Response('{"accepted":0}', { status: 200 })) as typeof fetch;
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), `${JSON.stringify(makeEv())}\n`);
    const stop = startHandoffLoop({
      projects: ["p1"],
      api_key: "k",
      api_url: "https://api.test",
      pull_ms: 10000,
      healthcheck_ms: 1000,
    });
    fs.writeFileSync(path.join(tmp, "daemon-flush-now"), "");
    await new Promise((r) => setTimeout(r, 200));
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(0);
    stop();
  });
});

function makeEv() {
  return {
    event_id: "01HZA",
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
