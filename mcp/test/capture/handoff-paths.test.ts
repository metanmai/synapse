import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  briefCachePath,
  currentSessionPath,
  projectDir,
  statusCachePath,
  synapseRoot,
} from "../../src/capture/handoff-paths.js";

describe("handoff-paths", () => {
  afterEach(() => {
    process.env.SYNAPSE_HOME = undefined;
  });

  it("projectDir is under ~/.synapse/projects/<pid> by default", () => {
    expect(projectDir("p1")).toBe(path.join(os.homedir(), ".synapse", "projects", "p1"));
  });

  it("briefCachePath is <projectDir>/cache/brief.md", () => {
    expect(briefCachePath("p1")).toBe(path.join(projectDir("p1"), "cache", "brief.md"));
  });

  it("currentSessionPath and statusCachePath are wired correctly", () => {
    expect(currentSessionPath("p1")).toBe(path.join(projectDir("p1"), "current_session.json"));
    expect(statusCachePath("p1")).toBe(path.join(projectDir("p1"), "cache", "project_status.json"));
  });

  it("respects SYNAPSE_HOME env var override", () => {
    process.env.SYNAPSE_HOME = "/tmp/synapse-test-root";
    expect(synapseRoot()).toBe("/tmp/synapse-test-root");
    expect(projectDir("p1")).toBe("/tmp/synapse-test-root/projects/p1");
  });
});
