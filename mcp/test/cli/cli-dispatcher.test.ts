/**
 * Dispatcher unit tests for the v1.1 handoff-layer CLI subcommands.
 *
 * v1 shipped the underlying command implementations
 * (runHandoffCmd / runSetFocusCmd / runNoteCmd / runIssueCreate /
 *  runIssueResolve / runIssueSupersede / runStatus / runDoctor)
 * but they weren't reachable from `synapse <cmd>` because the HANDLERS
 * map in `mcp/src/index.ts` was missing entries. These tests guard
 * against that regression by invoking HANDLERS directly with synthesized
 * argv arrays and asserting the expected side effects on the local event
 * log under a temporary `SYNAPSE_HOME`.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HANDLERS } from "../../src/cli/handlers.js";

const TEST_PROJECT_ID = "test-project";

let tmp: string;
let originalCwd: string;
let stdoutChunks: string[];
let stderrChunks: string[];
let restoreStdout: () => void;
let restoreStderr: () => void;

function captureStdio(): void {
  stdoutChunks = [];
  stderrChunks = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  // biome-ignore lint/suspicious/noExplicitAny: matching node's overloaded write signature is awkward to type fully
  (process.stdout.write as any) = (chunk: any, ...rest: any[]) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof rest[0] === "function") rest[0]();
    if (typeof rest[1] === "function") rest[1]();
    return true;
  };
  // biome-ignore lint/suspicious/noExplicitAny: matching node's overloaded write signature is awkward to type fully
  (process.stderr.write as any) = (chunk: any, ...rest: any[]) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof rest[0] === "function") rest[0]();
    if (typeof rest[1] === "function") rest[1]();
    return true;
  };
  restoreStdout = () => {
    // biome-ignore lint/suspicious/noExplicitAny: restoring the original write
    (process.stdout.write as any) = origStdout;
  };
  restoreStderr = () => {
    // biome-ignore lint/suspicious/noExplicitAny: restoring the original write
    (process.stderr.write as any) = origStderr;
  };
}

interface DispatchResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(...argv: string[]): Promise<DispatchResult> {
  captureStdio();
  let code = 0;
  try {
    const cmd = argv[0];
    const handler = HANDLERS[cmd];
    if (!handler) {
      process.stderr.write(`Unknown command: ${cmd}\n`);
      code = 1;
    } else {
      await handler(argv.slice(1));
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    code = 1;
  } finally {
    restoreStdout();
    restoreStderr();
  }
  return { code, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
}

beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-dispatch-");
  process.env.SYNAPSE_HOME = tmp;
  process.env.SYNAPSE_TEST_PROJECT_ID = TEST_PROJECT_ID;
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_TEST_PROJECT_ID;
});

function readEvents(): Array<{ kind: string; payload: Record<string, unknown> }> {
  const p = path.join(tmp, "projects", TEST_PROJECT_ID, "events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("CLI dispatcher — handoff layer subcommands", () => {
  it("`synapse handoff '<text>'` writes a next_step_set event", async () => {
    const { code, stderr } = await runCli("handoff", "wire", "/callback");
    expect(code, stderr).toBe(0);
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("next_step_set");
    expect(events[0].payload.text).toBe("wire /callback");
  });

  it("`synapse set-focus '<text>'` writes a focus_set event", async () => {
    const { code } = await runCli("set-focus", "OAuth", "wiring");
    expect(code).toBe(0);
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("focus_set");
    expect(events[0].payload.text).toBe("OAuth wiring");
  });

  it("`synapse note --target <ref> '<text>'` writes an issue_noted event", async () => {
    const { code } = await runCli("note", "--target", "issue:42", "looks", "wrong");
    expect(code).toBe(0);
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("issue_noted");
    expect(events[0].payload.target).toBe("issue:42");
    expect(events[0].payload.text).toBe("looks wrong");
  });

  it("`synapse issue create --kind decision --title <t>` writes an issue_created event", async () => {
    const { code } = await runCli(
      "issue",
      "create",
      "--kind",
      "decision",
      "--title",
      "Use Hono",
      "--body",
      "lighter than Express",
    );
    expect(code).toBe(0);
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("issue_created");
    expect(events[0].payload.kind).toBe("decision");
    expect(events[0].payload.title).toBe("Use Hono");
    expect(events[0].payload.body).toBe("lighter than Express");
  });

  it("`synapse issue resolve <id> '<resolution>'` writes an issue_state_changed event", async () => {
    const { code } = await runCli("issue", "resolve", "iss_abc123", "shipped", "in", "v1.1");
    expect(code).toBe(0);
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("issue_state_changed");
    expect(events[0].payload.state).toBe("resolved");
    expect(events[0].payload.resolution).toBe("shipped in v1.1");
  });

  it("`synapse issue supersede <id> --by <new>` writes a superseded event", async () => {
    const { code } = await runCli("issue", "supersede", "iss_old", "--by", "iss_new");
    expect(code).toBe(0);
    const events = readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("issue_state_changed");
    expect(events[0].payload.state).toBe("superseded");
    expect(events[0].payload.superseded_by).toBe("iss_new");
  });

  it("`synapse status` prints the daemon health line", async () => {
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date().toISOString());
    const { code, stdout } = await runCli("status");
    expect(code).toBe(0);
    expect(stdout).toContain("Daemon:");
  });

  it("`synapse doctor` prints detailed diagnostics including projects line", async () => {
    fs.mkdirSync(path.join(tmp, "projects", TEST_PROJECT_ID), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "projects", TEST_PROJECT_ID, "events.jsonl"),
      `${JSON.stringify({ event_id: "x" })}\n`,
    );
    const { code, stdout } = await runCli("doctor");
    expect(code).toBe(0);
    expect(stdout).toContain("Daemon:");
    expect(stdout).toContain("Projects tracked");
  });

  it("unknown subcommand exits non-zero with a helpful message", async () => {
    const { code, stderr } = await runCli("zzznotacommand");
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("unknown");
  });

  it("`synapse handoff` with no args exits non-zero with a usage hint", async () => {
    const { code, stderr } = await runCli("handoff");
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("usage");
  });

  it("`synapse issue create` without required flags exits non-zero", async () => {
    const { code, stderr } = await runCli("issue", "create", "--kind", "decision");
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("usage");
  });
});
