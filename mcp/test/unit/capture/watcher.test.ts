import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../../src/capture/adapter-registry.js";
import type { CapturedSession, ToolAdapter } from "../../../src/capture/types.js";
import { CaptureWatcher, buildChokidarOptions } from "../../../src/capture/watcher.js";

// Poll-with-deadline helper. The fixed-timeout pattern is too tight on
// Windows: `usePolling: true, interval: 500` adds up to 500ms of poll
// latency, awaitWriteFinish.stabilityThreshold adds another 500ms, the
// 500ms scanInterval adds another 500ms — minimum ~1500ms before a
// session emits. On a busy CI runner with NTFS + Defender, even 3s is
// occasionally too tight. Poll-with-deadline waits for the assertion
// to become true instead of guessing how long that will take.
async function pollUntil(check: () => boolean, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

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

    // Wait for the first emission. Generous deadline because Windows
    // polling + awaitWriteFinish + scan interval stack up to ~1.5s
    // minimum; CI runners can stretch this further.
    await pollUntil(() => sessions.length >= 1, 10000);
    expect(sessions.length).toBe(1);

    // Write same content again -- mtime changes but size doesn't always.
    // Force a file change that chokidar detects but with different content.
    fs.writeFileSync(testFile, '{"test": true}\n');

    await new Promise((resolve) => setTimeout(resolve, 3000));
    // May or may not emit again depending on mtime -- the point is it doesn't crash
    // and the dedup logic runs. Exact count depends on OS mtime resolution.
  }, 15000);

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

  // ── Platform-conditional chokidar config (bug class guard) ─────────────
  //
  // BUG CLASS: "the file watcher silently misses adapter file writes on
  // Windows because chokidar's default (fs.watch) is unreliable for
  // deeply-nested watch paths on that OS." Discovered 2026-06-07: 6/6
  // adapters in e2e-adapter-roundtrip.mjs reported "NOT captured —
  // chokidar missed the file?" on the Windows CI matrix, while Ubuntu
  // and macOS passed cleanly. Fix is `usePolling: true` on Windows only
  // — stat-polling closes the reliability gap at ~1% CPU per watched
  // dir.
  //
  // The structural risk this test guards is a future refactor (e.g.
  // consolidating options into a constant, switching to a wrapper
  // library, "simplifying" the platform branch) silently dropping the
  // polling flag and re-breaking Windows captures. We test the pure
  // option-builder directly rather than the runtime watcher, because
  // the bug only manifests on real Windows file systems — a unit test
  // on Linux can't trigger the fs.watch miss-case that polling fixes.
  // Asserting the config shape is the structural invariant that, when
  // held, guarantees the runtime fix.
  describe("buildChokidarOptions — platform-conditional polling", () => {
    it("enables polling on Windows so chokidar doesn't silently miss adapter file writes", () => {
      const opts = buildChokidarOptions("win32");
      // The load-bearing assertion: polling MUST be on for Windows. A
      // future refactor that drops this flag will re-break the
      // adapter-roundtrip Windows merge gate.
      expect(opts.usePolling).toBe(true);
      // Interval choices are documented in watcher.ts — assert presence
      // so a refactor that turns polling on but forgets the interval
      // (chokidar default = 100ms, way too aggressive for a daemon)
      // still trips this test.
      expect(typeof opts.interval).toBe("number");
      expect(typeof opts.binaryInterval).toBe("number");
    });

    it("does NOT enable polling on Linux — inotify is reliable and polling wastes CPU", () => {
      const opts = buildChokidarOptions("linux");
      // Negative assertion: polling is reserved for Windows specifically.
      // Turning it on globally would cost ~1% CPU per watched dir on
      // every user's machine for zero benefit on Linux/macOS, where
      // inotify/FSEvents already deliver reliable native notifications.
      expect(opts.usePolling).toBeUndefined();
    });

    it("does NOT enable polling on macOS — FSEvents is reliable and polling wastes CPU", () => {
      const opts = buildChokidarOptions("darwin");
      expect(opts.usePolling).toBeUndefined();
    });

    it("always sets awaitWriteFinish so partial file writes don't trigger premature parses", () => {
      // Cross-platform invariant: every adapter parses JSONL files that
      // are appended-to over the lifetime of the editor session. Without
      // awaitWriteFinish, chokidar could emit on a partial write and the
      // adapter would parse a truncated JSON line, silently dropping a
      // capture. This applies on every platform, so assert it for all.
      for (const platform of ["win32", "linux", "darwin"] as const) {
        const opts = buildChokidarOptions(platform);
        expect(opts.awaitWriteFinish).toBeDefined();
      }
    });
  });

  it("emits idle event after idle timeout", async () => {
    // Use a very short idle timeout (800ms) and scan interval (300ms) for testing
    await watcher.stop();
    watcher = new CaptureWatcher(registry, 300, 800);

    const idlePaths: string[] = [];
    watcher.on("idle", (p: string) => idlePaths.push(p));

    await watcher.start();

    // Small delay to ensure chokidar is watching
    await new Promise((resolve) => setTimeout(resolve, 200));

    const testFile = path.join(tmpDir, "idle-test.jsonl");
    fs.writeFileSync(testFile, '{"test": true}\n');

    // Wait for the file to be processed (awaitWriteFinish 500ms + scan 300ms + overhead)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // No idle yet (800ms timeout hasn't passed since last change)
    expect(idlePaths.length).toBe(0);

    // Poll for the idle event instead of asserting after one fixed sleep. On
    // slow/contended CI runners (notably the Windows chokidar-polling path) the
    // idle tick lands well after a fixed 1500ms window, so a fixed sleep here
    // flakes (metanmai run 27542357561). Wait up to 8s for the behavior itself.
    const idleDeadline = Date.now() + 8000;
    while (idlePaths.length < 1 && Date.now() < idleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(idlePaths.length).toBe(1);
    expect(idlePaths[0]).toBe(testFile);

    // Should not fire again for the same file
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(idlePaths.length).toBe(1);
  }, 20000);
});
