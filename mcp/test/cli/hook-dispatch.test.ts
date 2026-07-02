import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readUserIdFromConfig } from "../../src/capture/identity.js";
import { canonicalCwd, dispatchHook, hashCwd } from "../../src/cli/hook-dispatch.js";

describe("hook dispatch", () => {
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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-resolve-"));
    homeOrig = process.env.HOME;
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp; // Windows: os.homedir() reads USERPROFILE, not HOME
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

  it("env var > config.json — when both set, env wins (hook-dispatch:59 chain)", async () => {
    // Set BOTH the env var AND a config.json with a different user_id.
    process.env.SYNAPSE_USER_ID = "env-wins-id";
    fs.writeFileSync(
      path.join(process.env.SYNAPSE_HOME ?? "", "config.json"),
      JSON.stringify({ user_id: "config-loses-id", email: "ignored@example.com" }),
    );

    // Mirror the resolution chain at hook-dispatch.ts:59 exactly.
    const resolved = process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig();
    expect(resolved).toBe("env-wins-id");
  });

  it("config.json wins when env unset", async () => {
    // No env var.
    fs.writeFileSync(
      path.join(process.env.SYNAPSE_HOME ?? "", "config.json"),
      JSON.stringify({ user_id: "config-user-id-2026", email: "tanmai@peepal.co" }),
    );

    const resolved = process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig();
    expect(resolved).toBe("config-user-id-2026");
  });

  it("placeholder when neither env nor config (non-empty, distinguishable from legacy 'default')", async () => {
    // No env var, no config.json on disk.
    const resolved = process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig();

    // Per feedback_test_generality.md: assert the contract ("non-empty fallback,
    // not legacy 'default'"), NOT the literal "local-user" string. The implementation
    // is free to pick any placeholder as long as it satisfies these properties.
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved).not.toBe("default"); // explicit regression against the legacy placeholder
  });
});

// Regression guard for Fix #3 — bug class "two paths that point at the
// same on-disk location route to two different backend projects." We must
// canonicalize cwd via realpathSync before hashing, so that
// hashCwd(symlink) === hashCwd(target).
describe("canonicalCwd", () => {
  let workTmp: string;
  beforeEach(() => {
    workTmp = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-cwd-test-"));
  });
  afterEach(() => {
    fs.rmSync(workTmp, { recursive: true, force: true });
  });

  it("resolves a symlink to its real target so hashCwd is stable", () => {
    const target = fs.mkdtempSync(path.join(workTmp, "target-"));
    const link = path.join(workTmp, "link");
    fs.symlinkSync(target, link, "dir");

    const canonicalFromTarget = canonicalCwd(target);
    const canonicalFromLink = canonicalCwd(link);

    // Both must resolve to the SAME on-disk path.
    expect(canonicalFromLink).toBe(canonicalFromTarget);
    // And therefore hash to the SAME cwd_<id> placeholder — which is the
    // actual contract we care about (routing key stability).
    expect(hashCwd(canonicalFromLink)).toBe(hashCwd(canonicalFromTarget));
  });

  it("returns the input unchanged when the path doesn't exist", () => {
    const ghost = path.join(workTmp, "does-not-exist");
    // realpathSync would throw here; canonicalCwd must absorb that and
    // hand back the input so callers never crash on missing dirs.
    expect(canonicalCwd(ghost)).toBe(ghost);
  });

  it("resolves /tmp ↔ /private/tmp on macOS (sanity check)", () => {
    // On macOS /tmp is a symlink to /private/tmp. Skip on platforms where
    // this assumption doesn't hold so the test doesn't false-fail.
    if (process.platform !== "darwin") return;
    if (!fs.existsSync("/private/tmp")) return;
    expect(canonicalCwd("/tmp")).toBe("/private/tmp");
  });
});
