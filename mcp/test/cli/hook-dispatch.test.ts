import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchHook, hashCwd } from "../../src/cli/hook-dispatch.js";

describe("hook dispatch", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync("/tmp/synapse-test-");
    process.env.SYNAPSE_HOME = tmp;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_HOME;
  });

  it("routes session-start hook payload to runSessionStartHook", async () => {
    const out: string[] = [];
    const stdout = {
      write: (s: string) => {
        out.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    await dispatchHook("session-start", {
      project_id: "p1",
      user_id: "u1",
      stdout,
      skipFallback: true,
    });
    expect(out.join("")).toContain("<synapse-brief>");
    const events = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p1/events.jsonl"), "utf-8").trim());
    expect(events.kind).toBe("session_opened");
  });

  it("routes post-tool-use hook payload to runPostToolUseHook", async () => {
    await dispatchHook("post-tool-use", {
      project_id: "p2",
      user_id: "u1",
      session_id: "s1",
      tool: "Edit",
      input: { file_path: "/tmp/x" },
      output: { ok: true },
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p2/events.jsonl"), "utf-8");
    expect(log).toContain("file_touched");
  });

  it("routes pre-compact hook payload to runPreCompactHook", async () => {
    await dispatchHook("pre-compact", {
      project_id: "p3",
      user_id: "u1",
      session_id: "s1",
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p3/events.jsonl"), "utf-8");
    expect(log.length).toBeGreaterThan(0);
  });

  it("routes session-end hook payload to runSessionEndHook", async () => {
    await dispatchHook("session-end", {
      project_id: "p4",
      user_id: "u1",
      session_id: "s1",
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p4/events.jsonl"), "utf-8");
    expect(log).toContain("session_closed");
  });

  it("routes subagent-stop hook payload to runSubagentStopHook", async () => {
    await dispatchHook("subagent-stop", {
      project_id: "p5",
      user_id: "u1",
      session_id: "s1",
      subagent: "general-purpose",
    });
    const log = fs.readFileSync(path.join(tmp, "projects/p5/events.jsonl"), "utf-8");
    expect(log).toContain("general-purpose");
  });

  it("writes unknown hook kind to stderr and does not throw", async () => {
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // biome-ignore lint/suspicious/noExplicitAny: stub stderr.write
    process.stderr.write = ((s: any) => {
      errs.push(String(s));
      return true;
    }) as typeof process.stderr.write;
    try {
      await dispatchHook("bogus-kind", {});
    } finally {
      process.stderr.write = origWrite;
    }
    expect(errs.join("")).toContain("unknown hook: bogus-kind");
  });

  it("hashCwd produces deterministic cwd_<12hex> ids", () => {
    const a = hashCwd("/Users/me/project");
    const b = hashCwd("/Users/me/project");
    expect(a).toBe(b);
    expect(a).toMatch(/^cwd_[a-f0-9]{12}$/);
    expect(hashCwd("/Users/me/other")).not.toBe(a);
  });
});

// Phase 2 (IDENT-01, D-03): hook-dispatch must resolve user_id from a richer source
// than today's `SYNAPSE_USER_ID ?? "default"` (hook-dispatch.ts:59). The new resolution
// chain (Plan 02-02): SYNAPSE_USER_ID env var > ~/.synapse/config.json user_id > placeholder.
//
// The contract tests below guard the BUG CLASS (env precedence over config, config over
// placeholder, no silent "default" leak after Plan 02-02 lands) — not the specific helper
// signature. The .skip cases document the contracts that flip GREEN once Plan 02-02 wires
// the helper into readHookPayloadFromStdin.

describe("hook dispatch — user_id resolution chain (Phase 2 IDENT-01)", () => {
  let tmp: string;
  let homeOrig: string | undefined;
  beforeEach(() => {
    tmp = fs.mkdtempSync("/tmp/synapse-resolve-");
    homeOrig = process.env.HOME;
    process.env.HOME = tmp;
    process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
    fs.mkdirSync(process.env.SYNAPSE_HOME, { recursive: true });
  });
  afterEach(() => {
    if (homeOrig !== undefined) process.env.HOME = homeOrig;
    // biome-ignore lint/performance/noDelete: real delete required
    delete process.env.SYNAPSE_USER_ID;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("SYNAPSE_USER_ID env var still flows through dispatchHook today (regression guard)", async () => {
    // Today (pre-Plan 02-02): the resolution happens at the CLI entry point (hook-dispatch.ts:59
    // via readHookPayloadFromStdin) which uses `process.env.SYNAPSE_USER_ID ?? "default"`.
    // dispatchHook itself takes user_id as an arg, so we simulate the CLI-entry behavior here.
    process.env.SYNAPSE_USER_ID = "env-user-id";
    const resolved = process.env.SYNAPSE_USER_ID ?? "default";

    await dispatchHook("session-end", {
      project_id: "p-env",
      user_id: resolved,
      session_id: "s1",
    });

    const log = fs.readFileSync(path.join(process.env.SYNAPSE_HOME ?? "", "projects/p-env/events.jsonl"), "utf-8");
    const event = JSON.parse(log.trim().split("\n")[0]);
    expect(event.actor?.user_id).toBe("env-user-id");
  });

  it.skip("RED: env var > config.json — when both set, env wins (Plan 02-02)", async () => {
    // Plan 02-02 contract: a `resolveUserId()` helper (in mcp/src/capture/identity.ts) returns:
    //   process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig() ?? "local-user"
    // This .skip case becomes active once that helper exists. The flip-to-active is the
    // executor's job in Plan 02-02 Task T2 ("identity helper + fetchMe + init").
    //
    // Setup: process.env.SYNAPSE_USER_ID = "env-wins"; config.json has user_id = "config-loses".
    // Assert: resolveUserId() returns "env-wins".
  });

  it.skip("RED: config.json wins when env unset (Plan 02-02)", async () => {
    // Setup: env unset; config.json user_id = "config-user-id".
    // Assert: resolveUserId() returns "config-user-id".
  });

  it.skip("RED: placeholder when neither env nor config (Plan 02-02)", async () => {
    // Setup: env unset; no config.json on disk (or config.json with no user_id field).
    // Assert: resolveUserId() returns a non-empty placeholder string (e.g., "local-user").
    // Per feedback_test_generality.md: do not assert literal "local-user" — the contract is
    // "non-empty fallback that is distinguishable from a real UUID and from the legacy 'default'".
  });
});
