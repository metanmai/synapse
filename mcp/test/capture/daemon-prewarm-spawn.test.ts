import type child_process from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnPrewarm } from "../../src/capture/daemon.js";

// Bug class guard: `spawnPrewarm` spawns a detached child via
// `child_process.spawn`. If the spawn fails asynchronously (missing dist/,
// PATH mismatch, AV blocking on Windows, etc.) the ChildProcess emits an
// 'error' event. Without an attached listener, Node's default behavior is
// to throw "Unhandled 'error' event" — which kills the daemon AND, when
// the daemon code runs inside a vitest worker fork, kills the worker
// mid-suite (manifests as "Worker exited unexpectedly" in CI).
//
// This test guards the bug class, not the Windows-specific instance:
// ANY async spawn error must NOT propagate as an unhandled rejection.

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-prewarm-spawn-"));
  process.env.SYNAPSE_HOME = tmp;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("spawnPrewarm — async spawn error handling", () => {
  it("attaches an 'error' listener on the child process", () => {
    // A real ChildProcess inherits from EventEmitter. We pass a fake spawn
    // that returns a plain emitter — the production code attaches its own
    // error handler before unref/detach takes effect.
    const fakeChild = new EventEmitter() as unknown as ReturnType<typeof child_process.spawn>;
    (fakeChild as unknown as { unref: () => void }).unref = () => {};
    const spawnFn = vi.fn(() => fakeChild);

    spawnPrewarm("test-project", "test-key", "https://api.test", spawnFn as unknown as typeof child_process.spawn);

    expect(spawnFn).toHaveBeenCalledOnce();
    // The bug class: if no error listener is attached, EventEmitter throws
    // synchronously when 'error' is emitted with no listener. The fact that
    // listenerCount > 0 means production code defended against this.
    expect((fakeChild as unknown as EventEmitter).listenerCount("error")).toBeGreaterThan(0);
  });

  it("does NOT crash the parent when the child emits 'error' after spawn", () => {
    // The killer assertion: emit 'error' on the fake child. If production
    // forgot the listener, EventEmitter's default would throw and abort
    // this test. If the listener is attached, the throw is swallowed and
    // the test continues to the assertion below.
    const fakeChild = new EventEmitter() as unknown as ReturnType<typeof child_process.spawn>;
    (fakeChild as unknown as { unref: () => void }).unref = () => {};
    const spawnFn = vi.fn(() => fakeChild);

    spawnPrewarm("test-project", "test-key", "https://api.test", spawnFn as unknown as typeof child_process.spawn);

    // This MUST NOT throw.
    expect(() => {
      (fakeChild as unknown as EventEmitter).emit("error", new Error("ENOENT: synthetic spawn failure"));
    }).not.toThrow();

    // And the failure should be persisted to the prewarm log so operators
    // can diagnose chronic spawn failures (e.g. corrupt dist install).
    const logPath = path.join(tmp, "daemon-prewarm.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const log = fs.readFileSync(logPath, "utf-8");
    expect(log).toContain("ENOENT: synthetic spawn failure");
    expect(log).toContain("test-project");
  });
});
