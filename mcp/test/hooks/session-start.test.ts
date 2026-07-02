import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectMapPath } from "../../src/cli/project-map.js";
import { runSessionStartHook } from "../../src/hooks/session-start.js";

describe("SessionStart hook", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-test-"));
    process.env.SYNAPSE_HOME = tmp;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_HOME;
  });

  it("prints empty <synapse-brief> when no cache exists, still writes session_opened event", async () => {
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, skipFallback: true });
    expect(out.join("")).toContain("<synapse-brief>");
    const events = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p1/events.jsonl"), "utf-8").trim());
    expect(events.kind).toBe("session_opened");
  });

  it("exits silently if SYNAPSE_DAEMON_SESSION env var is set (loop prevention)", async () => {
    process.env.SYNAPSE_DAEMON_SESSION = "1";
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout });
    expect(out).toEqual([]);
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_DAEMON_SESSION;
  });

  // --- STATE.md fallback behavior ---
  // The bug class: when the daemon's brief cache is missing or stale, the hook
  // used to emit a useless "no cached context" string even when the repo's
  // .planning/STATE.md held fresher hand-curated context. These four cases
  // pin the freshness contract, not the specific strings either side emits.

  function setupRepo(): { repo: string; stateMd: string } {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-repo-"));
    fs.mkdirSync(path.join(repo, ".planning"), { recursive: true });
    return { repo, stateMd: path.join(repo, ".planning/STATE.md") };
  }

  function captureBrief(out: string[]): string {
    const joined = out.join("");
    const match = joined.match(/<synapse-brief>\n([\s\S]*?)\n<\/synapse-brief>/);
    return match ? match[1] : "";
  }

  it("prefers STATE.md when brief cache is missing", async () => {
    const { repo, stateMd } = setupRepo();
    const sentinel = "# State — Sentinel Project\n\n## Current Position\n- Phase: 99 of 100";
    fs.writeFileSync(stateMd, sentinel);
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, cwd: repo, skipFallback: true });

    const brief = captureBrief(out);
    expect(brief).toContain("Sentinel Project");
    expect(brief).toContain("Phase: 99");
    expect(brief).not.toContain("no cached context");
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("prefers STATE.md when it is newer than the brief cache", async () => {
    const { repo, stateMd } = setupRepo();
    // Write cache first, then STATE.md — STATE.md is newer.
    const cachePath = path.join(tmp, "projects/p1/cache/brief.md");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "STALE_CACHE_CONTENT");
    // Force cache mtime to be older by 60s.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(cachePath, past, past);
    fs.writeFileSync(stateMd, "# State — Fresher Than Cache\n\nCurrent: phase 5");

    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, cwd: repo });

    const brief = captureBrief(out);
    expect(brief).toContain("Fresher Than Cache");
    expect(brief).not.toContain("STALE_CACHE_CONTENT");
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("uses brief cache when it is newer than STATE.md", async () => {
    const { repo, stateMd } = setupRepo();
    // Write STATE.md first, then cache — cache is newer.
    fs.writeFileSync(stateMd, "# OLD_STATE_MD");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(stateMd, past, past);
    const cachePath = path.join(tmp, "projects/p1/cache/brief.md");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "FRESH_DAEMON_BRIEF");

    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, cwd: repo });

    const brief = captureBrief(out);
    expect(brief).toContain("FRESH_DAEMON_BRIEF");
    expect(brief).not.toContain("OLD_STATE_MD");
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("emits fallback string when neither cache nor STATE.md exists", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-empty-"));
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, cwd: repo });

    const brief = captureBrief(out);
    expect(brief).toContain("no cached context");
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // Regression guard for the bug class "we built pull-compact but forgot to
  // wire it into the SessionStart hook." Asserts that when pull-compact
  // returns a non-null handoff (here: a cached one served from the backend),
  // the rendered brief actually surfaces it under a labelled section so the
  // next agent picks it up via the standard <synapse-brief> channel.
  it("appends pull-compact handoff to the brief when available", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-pull-"));
    const mapFile = getProjectMapPath();
    fs.mkdirSync(path.dirname(mapFile), { recursive: true });
    fs.writeFileSync(
      mapFile,
      JSON.stringify({
        [repo]: { project_id: "proj-uuid-pull", project_name: "PullRepo", updated_at: new Date().toISOString() },
      }),
    );
    process.env.SYNAPSE_API_KEY = "session-test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          conversations: [
            {
              id: "conv_pull",
              updated_at: "2026-05-24T03:00:00Z",
              metadata: {
                handoff_markdown: "## PREV_SESSION_HANDOFF_BODY",
                handoff_at: "2026-05-24T03:00:01Z",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, cwd: repo, skipFallback: true });

    const brief = captureBrief(out);
    expect(brief).toContain("## Last conversation handoff");
    expect(brief).toContain("PREV_SESSION_HANDOFF_BODY");

    fetchSpy.mockRestore();
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_API_KEY;
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
