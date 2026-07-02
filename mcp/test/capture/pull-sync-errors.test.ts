import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pullSyncErrorsSection } from "../../src/capture/pull-sync-errors.js";

/**
 * Bug class under test: "the brief silently swallows sync errors, leaving
 * the user wondering why captures aren't reaching the backend". The
 * SessionStart brief MUST render an actionable `## Sync error` section
 * when the daemon's last flush hit PROJECT_QUOTA_EXCEEDED or similar.
 *
 * Tests use a tmpdir SYNAPSE_HOME so they don't touch the real user
 * state — the file under inspection is `~/.synapse/sync-errors.json`.
 */

describe("pullSyncErrorsSection", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-test-"));
    process.env.SYNAPSE_HOME = tmpHome;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: real delete needed; assigning `undefined` coerces to string "undefined" in Node
    delete process.env.SYNAPSE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty string when the errors file does not exist", () => {
    expect(pullSyncErrorsSection()).toBe("");
  });

  it("returns empty string when the file is corrupted JSON", () => {
    fs.writeFileSync(path.join(tmpHome, "sync-errors.json"), "{ not json");
    expect(pullSyncErrorsSection()).toBe("");
  });

  it("renders a PROJECT_QUOTA_EXCEEDED entry as a brief section", () => {
    fs.writeFileSync(
      path.join(tmpHome, "sync-errors.json"),
      JSON.stringify({
        errors: [{ code: "PROJECT_QUOTA_EXCEEDED", at: new Date().toISOString() }],
      }),
    );
    const out = pullSyncErrorsSection();
    expect(out).toMatch(/^## Sync error/);
    expect(out).toMatch(/50 of 50 projects/);
    expect(out).toMatch(/Delete one in the dashboard/);
  });

  it("prunes entries older than 24h (stale errors don't haunt the brief forever)", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(tmpHome, "sync-errors.json"),
      JSON.stringify({
        errors: [{ code: "PROJECT_QUOTA_EXCEEDED", at: twoDaysAgo }],
      }),
    );
    expect(pullSyncErrorsSection()).toBe("");
  });

  it("dedupes by code — 5 quota entries become 1 message", () => {
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(tmpHome, "sync-errors.json"),
      JSON.stringify({
        errors: Array.from({ length: 5 }, () => ({ code: "PROJECT_QUOTA_EXCEEDED", at: now })),
      }),
    );
    const out = pullSyncErrorsSection();
    // One ## header + one bullet line
    const bullets = out.split("\n").filter((l) => l.startsWith("-"));
    expect(bullets).toHaveLength(1);
  });

  it("renders unknown error codes with a generic fallback (forward-compat)", () => {
    fs.writeFileSync(
      path.join(tmpHome, "sync-errors.json"),
      JSON.stringify({
        errors: [{ code: "FUTURE_NEW_ERROR", at: new Date().toISOString(), detail: "x" }],
      }),
    );
    const out = pullSyncErrorsSection();
    expect(out).toMatch(/## Sync error/);
    expect(out).toMatch(/FUTURE_NEW_ERROR/);
  });

  it("ignores entries with malformed at timestamps (no crash, no render)", () => {
    fs.writeFileSync(
      path.join(tmpHome, "sync-errors.json"),
      JSON.stringify({
        errors: [{ code: "PROJECT_QUOTA_EXCEEDED", at: "not-a-date" }],
      }),
    );
    expect(pullSyncErrorsSection()).toBe("");
  });
});
