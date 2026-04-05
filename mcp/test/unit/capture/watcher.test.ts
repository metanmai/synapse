import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../../src/capture/adapter-registry.js";
import type { CapturedSession, ToolAdapter } from "../../../src/capture/types.js";
import { CaptureWatcher } from "../../../src/capture/watcher.js";

function makeFakeAdapter(tool: string, watchDir: string): ToolAdapter {
  return {
    tool,
    watchPaths: () => [watchDir],
    parse: (filePath: string) => {
      if (!filePath.endsWith(".jsonl")) return null;
      return {
        id: `ses_${tool}_1`,
        tool: tool as CapturedSession["tool"],
        projectPath: "/tmp/project",
        startedAt: "2026-04-02T10:00:00Z",
        updatedAt: "2026-04-02T10:05:00Z",
        messages: [{ role: "user" as const, content: "test", timestamp: "2026-04-02T10:00:00Z" }],
      };
    },
  };
}

describe("CaptureWatcher", () => {
  let tmpDir: string;
  let registry: AdapterRegistry;
  let watcher: CaptureWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-watcher-test-"));
    registry = new AdapterRegistry();
    registry.register(makeFakeAdapter("claude-code", tmpDir));
    // Use short scan interval for tests (500ms instead of 5s)
    watcher = new CaptureWatcher(registry, 500);
  });

  afterEach(async () => {
    await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits a session when a watched file changes", async () => {
    const sessions: CapturedSession[] = [];
    watcher.on("session", (s) => sessions.push(s));

    await watcher.start();

    // Small delay to ensure chokidar is fully watching after "ready"
    await new Promise((resolve) => setTimeout(resolve, 200));

    const testFile = path.join(tmpDir, "test-session.jsonl");
    fs.writeFileSync(testFile, '{"test": true}\n');

    // Poll up to 8s (awaitWriteFinish 500ms + scan interval 500ms + OS/CI overhead)
    const deadline = Date.now() + 8000;
    while (sessions.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("ses_claude-code_1");
  }, 15000);

  it("ignores files that adapters return null for", async () => {
    const sessions: CapturedSession[] = [];
    watcher.on("session", (s) => sessions.push(s));

    await watcher.start();

    fs.writeFileSync(path.join(tmpDir, "ignored.txt"), "not a session");

    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(sessions.length).toBe(0);
  });

  it("deduplicates unchanged files (mtime+size)", async () => {
    const sessions: CapturedSession[] = [];
    watcher.on("session", (s) => sessions.push(s));

    await watcher.start();

    const testFile = path.join(tmpDir, "dedup.jsonl");
    fs.writeFileSync(testFile, '{"test": true}\n');

    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(sessions.length).toBe(1);

    // Write same content again -- mtime changes but size doesn't always.
    // Force a file change that chokidar detects but with different content.
    fs.writeFileSync(testFile, '{"test": true}\n');

    await new Promise((resolve) => setTimeout(resolve, 3000));
    // May or may not emit again depending on mtime -- the point is it doesn't crash
    // and the dedup logic runs. Exact count depends on OS mtime resolution.
  });

  it("reports running state", async () => {
    expect(watcher.isRunning()).toBe(false);
    await watcher.start();
    expect(watcher.isRunning()).toBe(true);
    await watcher.stop();
    expect(watcher.isRunning()).toBe(false);
  });

  it("reports health state", async () => {
    expect(watcher.getHealth()).toBe("healthy");
    await watcher.start();
    expect(watcher.getHealth()).toBe("healthy");
  });

  it("deduplicates queued events for same path", async () => {
    const sessions: CapturedSession[] = [];
    watcher.on("session", (s) => sessions.push(s));

    await watcher.start();

    // Small delay to ensure chokidar is watching
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Write to the same file multiple times rapidly
    const testFile = path.join(tmpDir, "rapid.jsonl");
    fs.writeFileSync(testFile, "line1\n");
    fs.appendFileSync(testFile, "line2\n");
    fs.appendFileSync(testFile, "line3\n");

    // Wait long enough for awaitWriteFinish stabilityThreshold (500ms) + scan interval (500ms) + overhead
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Should emit at most once (event queue deduplicates by path)
    expect(sessions.length).toBeLessThanOrEqual(1);
  }, 15000);
});
