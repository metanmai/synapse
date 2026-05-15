import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";

let tmp: string;
let origHome: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/syn-init-perf-");
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (origHome !== undefined) {
    process.env.HOME = origHome;
  } else {
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.HOME;
  }
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("synapse init time", () => {
  it("completes installer (without OS service registration) in <30s", async () => {
    const start = Date.now();
    await runInit({ api_key: "k", skip_service: true });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(30_000);
  });
});
