import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPostToolUseHook } from "../../src/hooks/post-tool-use.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/syn-perf-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("hook latency", () => {
  it("PostToolUse completes 100 invocations in <5s (avg <50ms)", () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      runPostToolUseHook({
        project_id: "p",
        user_id: "u",
        session_id: "s",
        tool: "Edit",
        input: { file_path: `f${i}.ts` },
        output: {},
      });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(elapsed / 100).toBeLessThan(50);
  });
});
