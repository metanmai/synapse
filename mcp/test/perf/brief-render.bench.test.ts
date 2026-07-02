import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderBriefFromCache } from "../../src/capture/handoff-brief.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "syn-brief-perf-"));
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("brief render latency", () => {
  it("renders from warm cache in <100ms", () => {
    const cacheDir = path.join(tmp, "projects/p/cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, "project_status.json"),
      JSON.stringify({
        project_id: "p",
        current_next_step: null,
        active_actors: [],
        recent_activity: [],
        open_issues: { decisions: [], questions: [] },
        open_subtasks: [],
        updated_at: "t",
      }),
    );
    const start = Date.now();
    for (let i = 0; i < 50; i++) renderBriefFromCache("p", "alex");
    const avg = (Date.now() - start) / 50;
    expect(avg).toBeLessThan(100);
  });
});
