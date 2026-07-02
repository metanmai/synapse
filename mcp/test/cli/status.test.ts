import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor, runStatus } from "../../src/cli/status.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-status-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("synapse status", () => {
  it("shows healthy when healthcheck is fresh", async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date().toISOString());
    const out = await runStatus();
    expect(out).toContain("Daemon: healthy");
  });

  it("shows stale when healthcheck is older than 60s", async () => {
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date(Date.now() - 120_000).toISOString());
    const out = await runStatus();
    expect(out).toContain("Daemon: STALE");
  });
});

describe("synapse doctor", () => {
  it("reports project count, last push, last pull, queued events", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/events.jsonl"), `${JSON.stringify({ event_id: "x" })}\n`);
    const out = await runDoctor();
    expect(out).toContain("Projects tracked: 1");
    expect(out).toContain("Queued events");
  });
});
