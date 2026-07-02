import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeNpmRegistry, resolveSynapseMcpCommand } from "../../src/cli/util/mcp-command.js";
import { resolveStableNodePath } from "../../src/cli/util/node-path.js";

// VALIDATION row mapping (mcp/.../01-VALIDATION.md "Per-Task Verification Map"):
//   BUG-03 → "resolves to absolute bin path when `which synapsesync` succeeds"
//   BUG-03 → "resolves to `node <abs>/dist/index.js` when which fails but dist exists"
//   BUG-03 → "returns `npx synapsesync` last-resort when neither resolves"
//   BUG-03 → "probeNpmRegistry returns false on 2s timeout"
//
// All 4 cases below are RED until Plan 01-03 (Wave 2) lands. They MUST FAIL
// against the Wave 0 stub which throws "not implemented — Wave 2".

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("resolveSynapseMcpCommand (BUG-03)", () => {
  it("resolves to absolute bin path when `which synapsesync` succeeds", () => {
    // `which` returns an absolute path; the file exists; resolver MUST prefer it.
    vi.spyOn(child_process, "execSync").mockReturnValue("/usr/local/bin/synapsesync\n" as unknown as Buffer);
    vi.spyOn(fs, "existsSync").mockReturnValue(true);

    const cmd = resolveSynapseMcpCommand("sk-test-key");

    expect(cmd.command).toBe("/usr/local/bin/synapsesync");
    expect(cmd.args).toEqual([]);
    expect(cmd.env.SYNAPSE_API_KEY).toBe("sk-test-key");
  });

  it("resolves to `node <abs>/dist/index.js` when which fails but dist exists", () => {
    // `which` throws (command not found); dist/index.js exists; resolver MUST
    // fall through to absolute `node + dist/index.js` per RESEARCH §"Pattern 4"
    // decision tree step 2.
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("which: command not found");
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);

    const cmd = resolveSynapseMcpCommand("sk-test-key");

    // The persisted command must be the STABLE node alias, never a
    // version-pinned Homebrew Cellar path (dies on `brew upgrade node`).
    // With existsSync mocked true above, resolveStableNodePath
    // deterministically picks the opt symlink on Cellar-installed nodes and
    // passes execPath through everywhere else.
    expect(cmd.command).toBe(resolveStableNodePath(process.execPath));
    expect(cmd.command).not.toMatch(/\/Cellar\//);
    expect(cmd.args).toHaveLength(1);
    // path.sep-aware endsWith: matches `dist/index.js` on POSIX and
    // `dist\index.js` on Windows.
    expect(cmd.args[0].endsWith(path.join("dist", "index.js"))).toBe(true);
    expect(cmd.env.SYNAPSE_API_KEY).toBe("sk-test-key");
  });

  it("returns `npx synapsesync` last-resort when neither resolves", () => {
    // `which` throws AND dist/index.js absent → only `npx` is left.
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("which: command not found");
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const cmd = resolveSynapseMcpCommand("sk-test-key");

    expect(cmd.command).toBe("npx");
    expect(cmd.args).toEqual(["synapsesync"]);
    expect(cmd.env.SYNAPSE_API_KEY).toBe("sk-test-key");
  });
});

describe("probeNpmRegistry (BUG-03)", () => {
  it("probeNpmRegistry returns false on 2s timeout", async () => {
    // fetch never settles → AbortController must fire at the 2s mark and the
    // promise resolves to `false`. Mirrors RESEARCH §"Pattern 4" algorithm step 1.
    vi.useFakeTimers();
    // A never-settling promise; the `fetch` itself is hung, so the only way to
    // proceed is via the resolver's internal AbortController + clearTimeout.
    const neverSettles = new Promise<Response>(() => {
      /* intentionally never resolves */
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        // Honor abort so the implementation's AbortController.abort() actually
        // rejects the in-flight fetch; many production fetch impls do this.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          // Otherwise hang forever (the test never advances time past 2001ms
          // without abort firing).
          void neverSettles;
        });
      }),
    );

    const probe = probeNpmRegistry();
    // Prevent unhandled-rejection noise if the implementation throws sync.
    probe.catch(() => {});

    await vi.advanceTimersByTimeAsync(2001);

    await expect(probe).resolves.toBe(false);
  });
});
