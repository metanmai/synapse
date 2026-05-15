import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMonthlyCostUsd, recordRunComplete, recordRunStart } from "../../src/capture/daemon-cc.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-cost-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("cost tracking", () => {
  it("recordRunStart + recordRunComplete write events; getMonthlyCostUsd sums them", () => {
    const id = recordRunStart({ project_id: "p", purpose: "next_step_inferred" });
    recordRunComplete({
      project_id: "p",
      run_id: id,
      input_tokens: 1000,
      output_tokens: 200,
      model: "haiku",
    });
    const cost = getMonthlyCostUsd();
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });
});
