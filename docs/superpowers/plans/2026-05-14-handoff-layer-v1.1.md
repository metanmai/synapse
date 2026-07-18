# Synapse Handoff Layer v1.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close v1 integration gaps, simplify the user-facing surface, and remove ~1100 lines of dead/legacy code.

**Architecture:** Same as v1 — local-first event log → daemon sync → backend reducer → materialized `ProjectStatus`. v1.1 fixes wiring, adds heuristic fallback for next-step inference, auto-creates projects, ships an invite flow + slash commands, and trims duplicated/legacy paths.

**Tech Stack:** unchanged from v1 (TypeScript, Hono on Cloudflare Workers, Supabase, Vitest, Biome).

**Prior context:** Spec at `docs/superpowers/specs/2026-05-14-handoff-layer-v1.1-design.md`. v1 plan at `docs/superpowers/plans/2026-05-11-claude-code-handoff-layer.md`. Dead-code scan at `.planning/milestones/archive/dead-code-scan-2026-05-14.md`.

**Working from:** the existing v1 worktree `handoff-layer-v1` at `/Users/Tanmai.N/Documents/synapse/.claude/worktrees/handoff-layer-v1`. v1.1 commits continue on the same branch. Final merge / split decision is the user's call.

**Environment notes (carried from v1):**
- Prepend `/opt/homebrew/opt/node/bin` to PATH before any npm/node command
- `node_modules` are symlinked; do NOT run `npm install` (corporate proxy blocks it)
- `mcp/node_modules/@synapse/shared` is a worktree-local override pointing at the worktree's `packages/shared` — don't break this
- Do NOT use `--no-verify` on `git push` without explicit user authorization
- Push is allowed after each task; if pre-push hook fails on pre-existing frontend errors, leave commits local

---

## Phase A — Critical wire-up fixes

### Task 1: Wire authored-CLI commands into HANDLERS

**Files:**
- Modify: `mcp/src/index.ts` (add HANDLERS entries)
- Create: `mcp/src/cli/handoff-arg-parse.ts` (small argument parsers)
- Test: `mcp/test/cli/cli-dispatcher.test.ts`

**Background:** v1 shipped `runHandoffCmd`, `runSetFocusCmd`, `runNoteCmd`, `runIssueCreate/Resolve/Supersede`, `runStatus`, `runDoctor` but none are reachable from `synapse <subcommand>`. The HANDLERS map in `mcp/src/index.ts` is missing entries for them.

- [ ] **Step 1: Inspect current HANDLERS shape**

Run: `grep -A 30 "HANDLERS" mcp/src/index.ts | head -50`. Note the existing pattern (handler signature, argv parsing, exit codes). Future entries follow this convention.

- [ ] **Step 2: Write failing dispatcher tests**

Create `mcp/test/cli/cli-dispatcher.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-dispatch-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

async function runCli(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // Wire up a helper that imports HANDLERS and dispatches a fake process.argv.
  // Capture stdout/stderr by replacing process.stdout.write/process.stderr.write briefly.
  // Return the exit code (handlers should return 0 on success, non-zero on error).
  // (Implementation deferred to test setup file or inline — design choice for the implementer.)
  // For purposes of this template, assume `runCli` exists and dispatches.
  ...
}

describe("CLI dispatcher", () => {
  it("synapse handoff '<text>' writes a next_step_set event", async () => {
    const { code } = await runCli("handoff", "wire /callback");
    expect(code).toBe(0);
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/<resolved>/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("next_step_set");
    expect(ev.payload.text).toBe("wire /callback");
  });

  it("synapse issue create --kind decision --title 'x' creates an issue_created event", async () => {
    const { code } = await runCli("issue", "create", "--kind", "decision", "--title", "x");
    expect(code).toBe(0);
    // ... assertion on events.jsonl
  });

  it("synapse status prints daemon health line", async () => {
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date().toISOString());
    const { code, stdout } = await runCli("status");
    expect(code).toBe(0);
    expect(stdout).toContain("Daemon:");
  });

  it("unknown subcommand exits non-zero with a helpful message", async () => {
    const { code, stderr } = await runCli("zzznotacommand");
    expect(code).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("unknown");
  });
});
```

- [ ] **Step 3: Implement argument parsers**

Create `mcp/src/cli/handoff-arg-parse.ts`:

```ts
export interface ParsedHandoff { text: string }
export function parseHandoffArgs(argv: string[]): ParsedHandoff {
  const text = argv.join(" ").trim();
  if (!text) throw new Error("usage: synapse handoff \"<text>\"");
  return { text };
}

export interface ParsedSetFocus { text: string }
export const parseSetFocusArgs = (argv: string[]): ParsedSetFocus => {
  const text = argv.join(" ").trim();
  if (!text) throw new Error("usage: synapse set-focus \"<text>\"");
  return { text };
};

export interface ParsedNote { target: string; text: string }
export function parseNoteArgs(argv: string[]): ParsedNote {
  const idx = argv.indexOf("--target");
  if (idx < 0 || idx + 1 >= argv.length) throw new Error("usage: synapse note --target <ref> \"<text>\"");
  const target = argv[idx + 1];
  const text = argv.filter((_, i) => i !== idx && i !== idx + 1).join(" ").trim();
  if (!text) throw new Error("usage: synapse note --target <ref> \"<text>\"");
  return { target, text };
}

export interface ParsedIssueCreate { kind: "decision" | "question"; title: string; body: string }
export function parseIssueCreateArgs(argv: string[]): ParsedIssueCreate {
  // argv after "issue create"
  const kindIdx = argv.indexOf("--kind");
  const titleIdx = argv.indexOf("--title");
  const bodyIdx = argv.indexOf("--body");
  if (kindIdx < 0 || titleIdx < 0) throw new Error("usage: synapse issue create --kind <decision|question> --title \"<t>\" [--body \"<b>\"]");
  const kind = argv[kindIdx + 1] as "decision" | "question";
  if (kind !== "decision" && kind !== "question") throw new Error("--kind must be 'decision' or 'question'");
  const title = argv[titleIdx + 1];
  const body = bodyIdx >= 0 ? argv[bodyIdx + 1] : "";
  return { kind, title, body };
}

export interface ParsedIssueResolve { issue_id: string; resolution: string }
export function parseIssueResolveArgs(argv: string[]): ParsedIssueResolve {
  if (argv.length < 2) throw new Error("usage: synapse issue resolve <id> \"<resolution>\"");
  return { issue_id: argv[0], resolution: argv.slice(1).join(" ") };
}

export interface ParsedIssueSupersede { issue_id: string; superseded_by: string }
export function parseIssueSupersedeArgs(argv: string[]): ParsedIssueSupersede {
  const byIdx = argv.indexOf("--by");
  if (argv.length < 1 || byIdx < 0 || byIdx + 1 >= argv.length) throw new Error("usage: synapse issue supersede <id> --by <new_id>");
  return { issue_id: argv[0], superseded_by: argv[byIdx + 1] };
}
```

- [ ] **Step 4: Wire HANDLERS in `mcp/src/index.ts`**

Add to the HANDLERS map (preserving existing entries):

```ts
import {
  runHandoffCmd,
  runSetFocusCmd,
  runNoteCmd,
  runIssueCreate,
  runIssueResolve,
  runIssueSupersede,
} from "./cli/handoff-commands.js";
import { runStatus, runDoctor } from "./cli/status.js";
import {
  parseHandoffArgs,
  parseSetFocusArgs,
  parseNoteArgs,
  parseIssueCreateArgs,
  parseIssueResolveArgs,
  parseIssueSupersedeArgs,
} from "./cli/handoff-arg-parse.js";
import { resolveProjectFromCwd } from "./cli/resolve-project.js"; // existing
import { readUserIdFromConfig } from "./cli/config.js"; // existing helper

async function handlerContext() {
  const project_id = await resolveProjectFromCwd(process.cwd());
  const user_id = readUserIdFromConfig();
  const session_id = `cli_${Date.now().toString(36)}`;
  return { project_id, user_id, session_id };
}

HANDLERS["handoff"] = async (argv: string[]) => {
  const { text } = parseHandoffArgs(argv);
  const ctx = await handlerContext();
  await runHandoffCmd({ ...ctx, text });
  return 0;
};

HANDLERS["set-focus"] = async (argv: string[]) => {
  const { text } = parseSetFocusArgs(argv);
  const ctx = await handlerContext();
  await runSetFocusCmd({ ...ctx, text });
  return 0;
};

HANDLERS["note"] = async (argv: string[]) => {
  const { target, text } = parseNoteArgs(argv);
  const ctx = await handlerContext();
  await runNoteCmd({ ...ctx, target, text });
  return 0;
};

HANDLERS["issue"] = async (argv: string[]) => {
  const sub = argv[0];
  const rest = argv.slice(1);
  const ctx = await handlerContext();
  if (sub === "create") {
    const args = parseIssueCreateArgs(rest);
    await runIssueCreate({ ...ctx, ...args });
    return 0;
  }
  if (sub === "resolve") {
    const args = parseIssueResolveArgs(rest);
    await runIssueResolve({ ...ctx, ...args });
    return 0;
  }
  if (sub === "supersede") {
    const args = parseIssueSupersedeArgs(rest);
    await runIssueSupersede({ ...ctx, ...args });
    return 0;
  }
  throw new Error(`unknown issue subcommand: ${sub}`);
};

HANDLERS["status"] = async () => {
  process.stdout.write(`${await runStatus()}\n`);
  return 0;
};

HANDLERS["doctor"] = async () => {
  process.stdout.write(`${await runDoctor()}\n`);
  return 0;
};
```

(Note: if `resolveProjectFromCwd` and `readUserIdFromConfig` don't exist in the form expected, implement minimal versions or read from `~/.synapse/config.json` directly.)

- [ ] **Step 5: Run tests, commit, push**

```bash
export PATH=/opt/homebrew/opt/node/bin:$PATH
npx vitest run mcp/test/cli/cli-dispatcher.test.ts
npm run typecheck -w mcp
npm run lint
git add mcp/src/cli/handoff-arg-parse.ts mcp/src/index.ts mcp/test/cli/cli-dispatcher.test.ts
git commit -m "fix(mcp): wire handoff/issue/note/status/doctor CLI subcommands into HANDLERS"
git push origin worktree-handoff-layer-v1   # without --no-verify
```

---

### Task 2: Add `daemon` subcommand to HANDLERS

**Files:**
- Modify: `mcp/src/index.ts` (new HANDLERS entry)
- Create: `mcp/src/cli/run-daemon.ts`
- Test: `mcp/test/cli/run-daemon.test.ts`

**Background:** `synapse init` writes a launchd plist / systemd unit invoking `synapse daemon`. That subcommand doesn't exist; the daemon is never starting.

- [ ] **Step 1: Failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemon } from "../../src/cli/run-daemon.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-daemon-cli-");
  process.env.SYNAPSE_HOME = tmp;
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ api_key: "k" }));
  fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "projects/p2"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

describe("runDaemon", () => {
  it("discovers tracked projects and starts handoff loop", async () => {
    const startSpy = vi.fn(() => () => {}); // returns a stop function
    const stop = runDaemon({ _testStartLoop: startSpy, _exitImmediately: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(startSpy).toHaveBeenCalled();
    const call = startSpy.mock.calls[0][0];
    expect(call.projects).toContain("p1");
    expect(call.projects).toContain("p2");
    expect(call.api_key).toBe("k");
    stop();
  });

  it("logs and exits cleanly with no projects to track", async () => {
    fs.rmSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.rmSync(path.join(tmp, "projects/p2"), { recursive: true });
    const startSpy = vi.fn(() => () => {});
    const stop = runDaemon({ _testStartLoop: startSpy, _exitImmediately: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ projects: [] }));
    stop();
  });
});
```

- [ ] **Step 2: Implement `runDaemon`**

```ts
// mcp/src/cli/run-daemon.ts
import fs from "node:fs";
import path from "node:path";
import { startHandoffLoop, type HandoffLoopArgs } from "../capture/daemon.js";
import { synapseRoot } from "../capture/handoff-paths.js";

const API_URL = "https://api.synapsesync.app";

export interface RunDaemonOpts {
  _testStartLoop?: (a: HandoffLoopArgs) => () => void;
  _exitImmediately?: boolean;
}

export function runDaemon(opts: RunDaemonOpts = {}): () => void {
  const startFn = opts._testStartLoop ?? startHandoffLoop;
  const root = synapseRoot();
  const configPath = path.join(root, "config.json");
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  const apiKey = config.api_key ?? process.env.SYNAPSE_API_KEY;
  if (!apiKey) {
    console.error("[synapse daemon] no API key configured. Run `synapse init` first.");
    return () => {};
  }
  const projectsDir = path.join(root, "projects");
  const projects = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
  if (projects.length === 0) {
    console.log("[synapse daemon] no projects tracked yet — waiting for hook activity to populate.");
  }
  const stop = startFn({
    projects,
    api_key: apiKey,
    api_url: API_URL,
    user_id: config.user_id,
  });
  if (!opts._exitImmediately) {
    process.on("SIGTERM", () => { stop(); process.exit(0); });
    process.on("SIGINT", () => { stop(); process.exit(0); });
  }
  return stop;
}
```

- [ ] **Step 3: Wire into HANDLERS**

```ts
// in mcp/src/index.ts
import { runDaemon } from "./cli/run-daemon.js";

HANDLERS["daemon"] = async () => {
  runDaemon();
  // Block forever (the daemon's intervals keep the event loop busy)
  return await new Promise<number>(() => {});
};
```

- [ ] **Step 4: Run tests, commit, push**

```bash
npx vitest run mcp/test/cli/run-daemon.test.ts
npm run typecheck -w mcp && npm run lint
git add mcp/src/cli/run-daemon.ts mcp/src/index.ts mcp/test/cli/run-daemon.test.ts
git commit -m "fix(mcp): wire \`synapse daemon\` subcommand to startHandoffLoop"
git push origin worktree-handoff-layer-v1
```

---

### Task 3: Drop FK constraints on handoff_sessions / handoff_issues

**Files:**
- Create: `supabase/migrations/016_drop_handoff_session_fks.sql`

**Background:** `handoff_events.session_id` has a FK to `handoff_sessions(id)` but nothing inserts session rows. First production event POST will fail.

- [ ] **Step 1: Write migration**

```sql
-- Drop FK constraints on handoff_events.session_id and handoff_issues.originated_in_session_id.
-- Sessions and issues are materialized in events; the reducer is the source of truth.
-- Tables stay (RLS preserved) but lose their referential integrity to session id.

alter table handoff_events
  drop constraint if exists handoff_events_session_id_fkey;

alter table handoff_issues
  drop constraint if exists handoff_issues_originated_in_session_id_fkey;

-- session_id and originated_in_session_id remain `text` columns; they're queryable but unenforced.
```

- [ ] **Step 2: Apply locally if Supabase is running**

```bash
cd supabase && supabase db reset --local
```

(If Docker isn't available, skip and verify by reading the migration file. Production will apply on deploy.)

- [ ] **Step 3: Commit, push**

```bash
git add supabase/migrations/016_drop_handoff_session_fks.sql
git commit -m "fix(backend): drop handoff session FKs — reducer is the source of truth"
git push origin worktree-handoff-layer-v1
```

---

## Phase B — Friction fixes

### Task 4: Delete cost-tracking, ai_enabled, daemon.model

**Files (delete or modify):**
- Modify: `mcp/src/capture/daemon-cc.ts` — remove cost helpers, rate constants, `estimateTokens`, `recordRunStart`, `recordRunComplete`, `getMonthlyCostUsd`
- Modify: `mcp/src/capture/daemon.ts` — remove `ai_enabled` field on `FireArgs`, remove the gate
- Modify: `mcp/src/cli/init.ts` — remove `daemon` block in default config
- Modify: `mcp/src/cli/status.ts` — remove cost line from `runDoctor`
- Modify: `packages/shared/src/handoff/events.ts` — remove `DaemonRunStarted`, `DaemonRunCompleted` from `EventKind`
- Delete: `mcp/test/capture/cost.test.ts`

- [ ] **Step 1: Inventory the deletions**

```bash
grep -rn "DaemonRun\|HAIKU_INPUT\|HAIKU_OUTPUT\|SONNET_INPUT\|SONNET_OUTPUT\|getMonthlyCostUsd\|recordRunStart\|recordRunComplete\|estimateTokens\|monthly_budget_usd\|ai_enabled\|daemon.model" mcp/ packages/ backend/ 2>/dev/null
```

Confirm: only references are in the files listed above. If anything is in `backend/` (it shouldn't be), abort and report.

- [ ] **Step 2: Apply deletions one file at a time**

For each file, remove the items listed. Keep the file if it still has other content; delete the file if its only remaining contents would be empty boilerplate.

After each file, run `npm run typecheck -w mcp` to confirm nothing cascades.

- [ ] **Step 3: Update `maybeFireInferNextStep` signature**

The new signature drops `ai_enabled`:

```ts
export interface FireArgs {
  project_id: string;
  idle_threshold_ms: number;
  spawnFn?: typeof spawnInferNextStep;
}

export async function maybeFireInferNextStep(a: FireArgs): Promise<void> {
  // No early return on ai_enabled
  // No cost gate
  // ... rest stays as-is, but updates needed in Task 5 for heuristic fallback
}
```

- [ ] **Step 4: Update tests**

`mcp/test/capture/idle-trigger.test.ts` — remove tests that exercised `ai_enabled: false`; keep the rest.

- [ ] **Step 5: Run all mcp tests, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "feat(mcp): delete cost tracking and ai_enabled — inference always runs (user pays via CC subscription)"
git push origin worktree-handoff-layer-v1
```

---

### Task 5: Heuristic fallback for next-step synthesis

**Files:**
- Create: `mcp/src/capture/heuristic-synth.ts`
- Modify: `mcp/src/capture/daemon.ts` (wrap `claude -p` call with try/catch + heuristic fallback)
- Modify: `mcp/src/capture/handoff-brief.ts` (show provenance label based on `inferred_method`)
- Test: `mcp/test/capture/heuristic-synth.test.ts`
- Extend: `mcp/test/capture/idle-trigger.test.ts` (test fallback path)

- [ ] **Step 1: Failing test for heuristic synthesizer**

```ts
import { describe, expect, it } from "vitest";
import { synthesizeHeuristicNextStep } from "../../src/capture/heuristic-synth.js";
import type { Event } from "@synapse/shared/handoff/types.js";

function ev(over: Partial<Event>): Event {
  return {
    event_id: Math.random().toString(36).slice(2), project_id: "p", session_id: "s",
    actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null, kind: "tool_used", occurred_at: new Date().toISOString(),
    received_at: new Date().toISOString(), payload: {}, ...over,
  };
}

describe("synthesizeHeuristicNextStep", () => {
  it("uses focus_set as the primary signal when present", () => {
    const out = synthesizeHeuristicNextStep([
      ev({ kind: "focus_set", payload: { text: "OAuth callback wiring" } }),
    ]);
    expect(out).toContain("OAuth callback wiring");
  });

  it("falls back to last user prompt excerpt when no focus_set", () => {
    const out = synthesizeHeuristicNextStep([
      ev({ kind: "user_prompted", payload: { prompt_excerpt: "implement /callback route" } }),
    ]);
    expect(out).toContain("/callback");
  });

  it("includes open subtasks in the synthesized text", () => {
    const out = synthesizeHeuristicNextStep([
      ev({ kind: "subtask_added", payload: { task_id: "t1", text: "wire route" } }),
      ev({ kind: "subtask_added", payload: { task_id: "t2", text: "write test" } }),
    ]);
    expect(out).toMatch(/wire route|write test/);
  });

  it("never returns empty for non-empty event input", () => {
    const out = synthesizeHeuristicNextStep([ev({ kind: "tool_used", payload: { tool: "Bash" } })]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns a clear empty-fallback for empty input", () => {
    const out = synthesizeHeuristicNextStep([]);
    expect(out).toMatch(/no recent activity/i);
  });
});
```

- [ ] **Step 2: Implement heuristic-synth.ts**

```ts
import type { Event } from "@synapse/shared/handoff/types.js";
import { EventKind } from "@synapse/shared/handoff/events.js";

export function synthesizeHeuristicNextStep(events: Event[]): string {
  if (events.length === 0) return "No recent activity to summarize.";

  const latestFocus = [...events].reverse().find((e) => e.kind === EventKind.FocusSet);
  const latestPrompt = [...events].reverse().find((e) => e.kind === EventKind.UserPrompted);
  const latestCommit = [...events].reverse().find((e) => e.kind === EventKind.CommitMade);
  const latestBranch = [...events].reverse().find((e) => e.kind === EventKind.BranchSwitched);

  const subtasksOpen = aggregateOpenSubtasks(events);
  const focusText = (latestFocus?.payload.text as string | undefined) ?? (latestPrompt?.payload.prompt_excerpt as string | undefined);

  const parts: string[] = [];
  if (focusText) {
    parts.push(`Continue working on ${focusText.slice(0, 100)}.`);
  }
  if (subtasksOpen.length > 0) {
    parts.push(`Pick up ${subtasksOpen[0]}${subtasksOpen.length > 1 ? ` (then ${subtasksOpen.length - 1} more)` : ""}.`);
  }
  if (latestCommit) {
    const sha = String((latestCommit.payload as { sha: string }).sha).slice(0, 7);
    const msg = String((latestCommit.payload as { message?: string }).message ?? "");
    parts.push(`Last commit: ${sha}${msg ? ` "${msg}"` : ""}.`);
  }
  if (latestBranch) {
    parts.push(`Branch: ${(latestBranch.payload as { branch: string }).branch}.`);
  }

  if (parts.length === 0) return "Recent activity recorded — see project status for details.";
  return parts.join(" ");
}

function aggregateOpenSubtasks(events: Event[]): string[] {
  const map = new Map<string, { text: string; state: "open" | "done" }>();
  for (const e of events) {
    if (e.kind === EventKind.SubtaskAdded) {
      const p = e.payload as { task_id?: string; text?: string };
      const id = String(p.task_id ?? e.event_id);
      map.set(id, { text: String(p.text ?? ""), state: "open" });
    } else if (e.kind === EventKind.SubtaskCompleted) {
      const id = String((e.payload as { task_id?: string }).task_id);
      const t = map.get(id);
      if (t) t.state = "done";
    }
  }
  return [...map.values()].filter((t) => t.state === "open").map((t) => t.text);
}
```

- [ ] **Step 3: Update `maybeFireInferNextStep`**

```ts
// in daemon.ts maybeFireInferNextStep, replace the existing spawn block with:

const summary = events.slice(-30).map((e) => `${e.kind}: ${JSON.stringify(e.payload).slice(0, 80)}`).join("\n");
const fn = a.spawnFn ?? spawnInferNextStep;

let text: string;
let inferred_method: "llm" | "heuristic";
try {
  text = await fn({ project_id: a.project_id, recent_events_summary: summary });
  inferred_method = "llm";
} catch (err) {
  console.warn("[handoff] LLM inference failed, falling back to heuristic:", err);
  text = synthesizeHeuristicNextStep(events);
  inferred_method = "heuristic";
}

if (!text || text.length === 0) return;

appendEvent(projectDir(a.project_id), {
  // ... existing payload ...
  kind: EventKind.NextStepInferred,
  payload: { text, on_behalf_of: lastEvent.actor.user_id, inferred_method },
});
```

Add `import { synthesizeHeuristicNextStep } from "./heuristic-synth.js";` at top.

- [ ] **Step 4: Update brief formatter to show provenance**

In `handoff-brief.ts` `render` function, where the next-step line is rendered:

```ts
if (s.current_next_step) {
  let provenance: string;
  if (s.current_next_step.inferred) {
    const method = (s.current_next_step as { inferred_method?: string }).inferred_method;
    provenance = method === "heuristic"
      ? "inferred from recent activity"
      : "inferred from activity by Claude Code";
  } else {
    provenance = `set by ${s.current_next_step.set_by.user_id}`;
  }
  lines.push(`Next step (${provenance}): "${s.current_next_step.text}"`);
}
```

Update `ProjectStatus.current_next_step` type in `packages/shared/src/handoff/types.ts` to optionally include `inferred_method?: "llm" | "heuristic"`.

- [ ] **Step 5: Extend idle-trigger test**

Add a test that the heuristic path activates when `spawnFn` throws:

```ts
it("falls back to heuristic when spawn fails", async () => {
  setupEvents(tmp, "p4", [{ kind: "user_prompted", occurred_at: minutesAgo(45), payload: { prompt_excerpt: "implement /callback" } }]);
  const failingSpawn = vi.fn(async () => { throw new Error("claude not found"); });
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  await maybeFireInferNextStep({ project_id: "p4", idle_threshold_ms: 30 * 60_000, spawnFn: failingSpawn as any });
  const events = fs.readFileSync(path.join(tmp, "projects/p4/events.jsonl"), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(events.at(-1).kind).toBe("next_step_inferred");
  expect(events.at(-1).payload.inferred_method).toBe("heuristic");
});
```

- [ ] **Step 6: Run all tests, commit, push**

```bash
npx vitest run mcp/test/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "feat(mcp): heuristic next-step synthesis as fallback when LLM unavailable"
git push origin worktree-handoff-layer-v1
```

---

### Task 6: Auto-create project on first event from unknown cwd

**Files:**
- Modify: `backend/src/api/events-batch.ts` (detect `cwd_<hash>` project_ids, create projects)
- Modify: `mcp/src/cli/hook-dispatch.ts` (include `git_basename` in resolved project_id flow)
- Modify: `mcp/src/cli/project-map.ts` (write-on-resolution, swap cwd_hash → uuid)
- Test: `backend/test/api/events-batch-auto-create.test.ts` (structural — auth-only without real DB)
- Test: `mcp/test/cli/auto-create-flow.test.ts`

- [ ] **Step 1: Write the backend test (structural)**

```ts
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("POST /api/events/batch — auto-create project", () => {
  it("recognizes a cwd_<hash> project_id pattern", async () => {
    const req = new Request("http://localhost/api/events/batch", {
      method: "POST",
      headers: { Authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({
        events: [{
          event_id: "01HZ001", project_id: "cwd_abcdef123456", session_id: "s",
          actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
          attached_to: null, kind: "session_opened",
          occurred_at: "2026-05-14T09:00:00Z", payload: { git_basename: "test-repo" },
        }],
      }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // Without real DB: route is registered, auth fails (or DB error surfaces).
    // We just verify the route is reachable and parses the cwd_<hash> pattern correctly.
    expect(res.status).not.toBe(404);
    if (res.status === 200) {
      const body = await res.json();
      expect(body).toHaveProperty("canonical_project_id");
    }
  });
});
```

- [ ] **Step 2: Implement detection + auto-create in backend**

In `backend/src/api/events-batch.ts`, before the upsert:

```ts
const cwdHashPattern = /^cwd_[a-f0-9]{12}$/;
const cwdHashProjectIds = [...new Set(rows.filter((r) => cwdHashPattern.test(r.project_id)).map((r) => r.project_id))];
const idMapping = new Map<string, string>(); // cwd_hash -> canonical uuid

for (const cwdHash of cwdHashProjectIds) {
  // Extract git_basename from the first event with this project_id
  const sample = body.events.find((e) => e.project_id === cwdHash);
  const gitBasename = (sample?.payload as { git_basename?: string })?.git_basename ?? "untitled";

  // Try to find existing project by name + member
  const { data: existing } = await db
    .from("projects")
    .select("id")
    .eq("name", gitBasename)
    .in("id", (await db.from("project_members").select("project_id").eq("user_id", user.id)).data?.map((m) => m.project_id) ?? [])
    .maybeSingle();

  if (existing) {
    idMapping.set(cwdHash, existing.id);
  } else {
    const { data: created, error: createErr } = await db
      .from("projects")
      .insert({ name: gitBasename, owner_id: user.id })
      .select("id")
      .single();
    if (createErr) throw createErr;
    await db.from("project_members").insert({ project_id: created.id, user_id: user.id, role: "owner" });
    idMapping.set(cwdHash, created.id);
  }
}

// Rewrite rows' project_id to canonical UUID
for (const r of rows) {
  if (idMapping.has(r.project_id)) r.project_id = idMapping.get(r.project_id)!;
}
```

Return shape adds `canonical_project_ids: Record<string, string>` so the daemon knows which to swap:

```ts
return c.json({
  accepted,
  duplicates,
  adjusted,
  canonical_project_ids: Object.fromEntries(idMapping),
});
```

- [ ] **Step 3: Update daemon's flush handler to apply remapping**

In `mcp/src/capture/handoff-sync.ts:runFlushCycle`, after a successful POST:

```ts
const body = await res.json();
const canonical = body?.canonical_project_ids as Record<string, string> | undefined;
if (canonical && canonical[a.project_id]) {
  const oldDir = projectDir(a.project_id);
  const newDir = projectDir(canonical[a.project_id]);
  if (!fs.existsSync(newDir)) {
    fs.renameSync(oldDir, newDir);
  } else {
    // Edge case: new dir exists; merge events.jsonl. For v1.1 simplicity, error.
    throw new Error(`auto-create remap collision: ${oldDir} -> ${newDir}`);
  }
  // Update project-map.ts cache
  await updateProjectMap(/* cwd, canonical id */);
}
```

(`updateProjectMap` is the existing function in `mcp/src/cli/project-map.ts`.)

- [ ] **Step 4: Update hook-dispatch to include git_basename in payloads**

`mcp/src/cli/hook-dispatch.ts` — when constructing event payloads, include `git_basename`:

```ts
import { execSync } from "node:child_process";

function getGitBasename(cwd: string): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return path.basename(root);
  } catch {
    return null;
  }
}

// In readHookPayloadFromStdin, when building the payload for event creation:
const git_basename = getGitBasename(parsed.cwd) ?? path.basename(parsed.cwd);
```

Pass through to the session_opened event's payload field.

- [ ] **Step 5: Run tests, commit, push**

```bash
npx vitest run backend/test/api/events-batch-auto-create.test.ts mcp/test/cli/auto-create-flow.test.ts
npm run typecheck -w mcp && npm run typecheck -w backend && npm run lint
git add -A
git commit -m "feat(backend,mcp): auto-create projects on first event from unknown cwd"
git push origin worktree-handoff-layer-v1
```

---

### Task 7: Invite endpoint + CLI + migration

**Files:**
- Create: `supabase/migrations/017_project_invites.sql`
- Create: `backend/src/api/invites.ts` (POST `/api/projects/:id/invites`, POST `/api/invites/:token/accept`)
- Create: `mcp/src/cli/invite.ts` (CLI: `synapse invite <email>`)
- Modify: `mcp/src/index.ts` (register `invite` HANDLERS entry)
- Test: `backend/test/api/invites.test.ts`
- Test: `mcp/test/cli/invite.test.ts`

- [ ] **Step 1: Migration**

`supabase/migrations/017_project_invites.sql`:

```sql
create table if not exists project_invites (
  token text primary key,
  project_id uuid not null references projects(id) on delete cascade,
  invited_by_user_id uuid not null references users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete set null
);

create index project_invites_email_idx on project_invites(email);
create index project_invites_project_id_idx on project_invites(project_id);

alter table project_invites enable row level security;

create policy project_invites_member_read on project_invites for select
  using (exists (select 1 from project_members pm where pm.project_id = project_invites.project_id and pm.user_id = auth.uid()));
```

- [ ] **Step 2: Implement backend routes**

```ts
// backend/src/api/invites.ts
import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { randomBytes } from "node:crypto";

const invites = new Hono<{ Bindings: Env }>();
invites.use("*", authMiddleware);

invites.post("/projects/:id/invites", async (c) => {
  const project_id = c.req.param("id");
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: "email required" }, 400);

  const user = c.get("user");
  const db = c.get("db");

  // Verify caller is a member
  const { data: membership } = await db
    .from("project_members").select("user_id").eq("project_id", project_id).eq("user_id", user.id).maybeSingle();
  if (!membership) return c.json({ error: "not a project member" }, 403);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await db.from("project_invites").insert({
    token, project_id, invited_by_user_id: user.id, email, expires_at: expiresAt,
  });
  if (error) throw error;

  // TODO(post-v1.1): wire email sending. For v1.1, return the join URL in the response so CLI can print.
  const joinUrl = `https://synapsesync.app/invite/${token}`;
  return c.json({ token, join_url: joinUrl, expires_at: expiresAt });
});

invites.post("/invites/:token/accept", async (c) => {
  const token = c.req.param("token");
  const user = c.get("user");
  const db = c.get("db");

  const { data: invite, error: inviteErr } = await db
    .from("project_invites").select("*").eq("token", token).maybeSingle();
  if (inviteErr) throw inviteErr;
  if (!invite) return c.json({ error: "invite not found" }, 404);
  if (invite.accepted_at) return c.json({ error: "already accepted" }, 409);
  if (new Date(invite.expires_at).getTime() < Date.now()) return c.json({ error: "expired" }, 410);

  const { error: memberErr } = await db.from("project_members").insert({
    project_id: invite.project_id, user_id: user.id, role: "member",
  });
  if (memberErr) throw memberErr;

  await db.from("project_invites").update({
    accepted_at: new Date().toISOString(), accepted_by_user_id: user.id,
  }).eq("token", token);

  return c.json({ project_id: invite.project_id });
});

export { invites };
```

Register in `backend/src/index.ts`:
```ts
import { invites } from "./api/invites";
app.route("/api", invites);
```

- [ ] **Step 3: Implement CLI**

```ts
// mcp/src/cli/invite.ts
import { resolveProjectFromCwd } from "./resolve-project.js";
import { readConfig } from "./config.js";

export async function runInviteCmd(a: { email: string; project_id?: string }): Promise<void> {
  const config = readConfig();
  const project_id = a.project_id ?? await resolveProjectFromCwd(process.cwd());
  if (!project_id) throw new Error("no project — run from a tracked project directory or pass --project");
  const res = await fetch(`${config.api_url}/api/projects/${project_id}/invites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ email: a.email }),
  });
  if (!res.ok) throw new Error(`invite failed: ${res.status}`);
  const body = await res.json();
  console.log(`Invited ${a.email}.`);
  console.log(`Send them this link: ${body.join_url}`);
  console.log(`Expires: ${body.expires_at}`);
}
```

Wire into `mcp/src/index.ts:HANDLERS`:

```ts
HANDLERS["invite"] = async (argv: string[]) => {
  const email = argv[0];
  if (!email) throw new Error("usage: synapse invite <email>");
  const projectIdx = argv.indexOf("--project");
  const project_id = projectIdx >= 0 ? argv[projectIdx + 1] : undefined;
  await runInviteCmd({ email, project_id });
  return 0;
};
```

- [ ] **Step 4: Tests + commit + push**

Tests assert: 400 on missing email, 403 on non-member, 200 with `join_url` on success. CLI test stubs fetch.

```bash
npx vitest run backend/test/api/invites.test.ts mcp/test/cli/invite.test.ts
npm run typecheck && npm run lint
git add -A
git commit -m "feat(backend,mcp): project invite flow — endpoint, migration, CLI"
git push origin worktree-handoff-layer-v1
```

---

### Task 8: Slash command files installed by `synapse init`

**Files:**
- Modify: `mcp/src/cli/init.ts` (write slash command markdown files)
- Test: `mcp/test/cli/init.test.ts` (extend existing tests)

- [ ] **Step 1: Extend init test**

```ts
it("installs slash command files in ~/.claude/commands/synapse/", async () => {
  await runInit({ api_key: "k", skip_service: true });
  const dir = path.join(tmp, ".claude/commands/synapse");
  expect(fs.existsSync(dir)).toBe(true);
  const files = fs.readdirSync(dir);
  expect(files).toContain("handoff.md");
  expect(files).toContain("focus.md");
  expect(files).toContain("issue.md");
  expect(files).toContain("status.md");
  expect(files).toContain("doctor.md");
  expect(files).toContain("invite.md");
});

it("slash command files are idempotent — re-running init doesn't duplicate", async () => {
  await runInit({ api_key: "k", skip_service: true });
  await runInit({ api_key: "k", skip_service: true });
  const dir = path.join(tmp, ".claude/commands/synapse");
  const files = fs.readdirSync(dir);
  expect(files).toHaveLength(6);
});
```

- [ ] **Step 2: Implement slash command installer**

In `mcp/src/cli/init.ts`, add:

```ts
const SLASH_COMMANDS: Record<string, string> = {
  "handoff.md": `---
name: synapse-handoff
description: Record an explicit next-step handoff for whoever picks up this work next.
---

Run \`synapse handoff "$ARGUMENTS"\` via the Bash tool. After it completes, briefly confirm what you recorded.
`,
  "focus.md": `---
name: synapse-focus
description: Set the current focus for this work session.
---

Run \`synapse set-focus "$ARGUMENTS"\` via the Bash tool. Confirm what was set.
`,
  "issue.md": `---
name: synapse-issue
description: Create, resolve, or supersede an issue. Args: create|resolve|supersede [kind] <title|id> [extra]
---

Parse \`$ARGUMENTS\` to determine the action:
- "create <kind?> <title>" — run \`synapse issue create --kind <decision|question> --title "<title>"\`. If kind is missing, ask the user which kind it should be.
- "resolve <id> <resolution>" — run \`synapse issue resolve <id> "<resolution>"\`.
- "supersede <id> --by <new_id>" — run \`synapse issue supersede <id> --by <new_id>\`.

Confirm the action taken.
`,
  "status.md": `---
name: synapse-status
description: One-line health check of the Synapse daemon.
---

Run \`synapse status\` via the Bash tool and report the output.
`,
  "doctor.md": `---
name: synapse-doctor
description: Detailed Synapse daemon diagnostics.
---

Run \`synapse doctor\` via the Bash tool and report the output.
`,
  "invite.md": `---
name: synapse-invite
description: Invite a teammate to this project. Args: <email>
---

Run \`synapse invite "$ARGUMENTS"\` via the Bash tool. Report the join URL.
`,
};

function installSlashCommands(): void {
  const dir = path.join(os.homedir(), ".claude/commands/synapse");
  fs.mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(SLASH_COMMANDS)) {
    const p = path.join(dir, filename);
    if (!fs.existsSync(p)) fs.writeFileSync(p, content);
  }
}
```

Call `installSlashCommands()` from `runInit`.

- [ ] **Step 3: Run tests, commit, push**

```bash
npx vitest run mcp/test/cli/init.test.ts
npm run lint
git add -A
git commit -m "feat(mcp): synapse init installs slash command files for handoff workflow"
git push origin worktree-handoff-layer-v1
```

---

## Phase C — Dead code removal

### Task 9: Remove dead CLI auth helpers + types

**Files:**
- Delete (or trim): `mcp/src/cli/api.ts` (`cliAuthSignup`, `cliAuthLogin`, `LoginResponse`, `SignupResponse`)
- Delete: `mcp/test/unit/api.test.ts`

- [ ] **Step 1: Verify no callers remain**

```bash
grep -rn "cliAuthSignup\|cliAuthLogin\|LoginResponse\|SignupResponse" mcp/ packages/ backend/ 2>/dev/null
```

Confirm: only test file references remain.

- [ ] **Step 2: Delete**

```bash
# Edit mcp/src/cli/api.ts — remove the four exports + the two interface declarations
# Delete the matching test file
rm mcp/test/unit/api.test.ts
```

- [ ] **Step 3: Verify, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "chore(mcp): remove unused cliAuthSignup/cliAuthLogin and response types"
git push origin worktree-handoff-layer-v1
```

---

### Task 10: Remove `validateMessage` / `validateSession` and stray helpers

**Files:**
- Modify: `mcp/src/capture/types.ts` (remove `validateMessage`, `validateSession`)
- Modify: `mcp/test/unit/capture/types.test.ts` (remove related tests, keep type tests)
- Modify: `backend/src/db/queries/entries.ts` (remove `countUniqueConnections`, `updateEmbedding`)
- Modify: `backend/src/lib/storage.ts` (remove `deleteMedia`)

- [ ] **Step 1: Verify**

```bash
grep -rn "validateMessage\|validateSession\|countUniqueConnections\|updateEmbedding\|deleteMedia" mcp/ packages/ backend/ 2>/dev/null
```

Confirm: only the to-be-deleted definitions + their direct tests.

- [ ] **Step 2: Apply deletions**

Delete the function bodies and any matching test cases.

- [ ] **Step 3: Verify, commit, push**

```bash
npx vitest run
npm run typecheck && npm run lint
git add -A
git commit -m "chore: remove unused validateMessage/validateSession + 3 backend helpers"
git push origin worktree-handoff-layer-v1
```

---

### Task 11: Trim editor barrel re-exports + stale TODO + unnecessary exports

**Files:**
- Modify: `mcp/src/cli/editors/index.ts` (trim re-exports to only what consumers actually need)
- Modify: `mcp/src/cli/editors/orchestrate.ts` (delete `writeAllDetected` if unused)
- Modify: `mcp/src/cli/hook-dispatch.ts` (remove stale TODO, drop `export` from `hashCwd`)

- [ ] **Step 1: Audit current consumers**

```bash
grep -rn "from \".*/cli/editors\"" mcp/src mcp/test 2>/dev/null
grep -rn "from \".*/cli/editors/index\"" mcp/src mcp/test 2>/dev/null
```

Keep only the symbols actually imported. Drop the rest from the barrel.

- [ ] **Step 2: Apply**

Trim `index.ts`. If `writeAllDetected` in `orchestrate.ts` has no callers, delete it.

In `hook-dispatch.ts`:
- Remove the `// TODO: integrate with project-map.ts...` comment
- Change `export function hashCwd` to `function hashCwd` (no longer exported)

- [ ] **Step 3: Verify, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "chore(mcp): trim unused barrel re-exports and stale TODO"
git push origin worktree-handoff-layer-v1
```

---

## Phase D — Architectural cleanup

### Task 12: Retire `capture hook-install` + `capture/hooks.ts`

**Files (delete):**
- `mcp/src/capture/hooks.ts`
- `mcp/test/unit/capture/hooks.test.ts`
- The `hook-install` / `hook-uninstall` subcommand entries in `mcp/src/capture/cli.ts`

**Files (modify):**
- `mcp/src/cli/commands.ts` — update `runUninstall` to remove new-format hooks from `~/.claude/settings.json` instead of calling old `uninstallHooks`
- `README.md` — remove mentions of `capture hook-install`

- [ ] **Step 1: Verify the migration of uninstall logic**

`runUninstall` should now:
1. Read `~/.claude/settings.json`
2. Filter each hook event's array for blocks where `hooks[*].command.startsWith("synapse hook ")`
3. Remove those blocks
4. Write back

- [ ] **Step 2: Apply**

Delete the old files; write the new uninstall logic.

- [ ] **Step 3: Run all tests, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "refactor(mcp): retire \`capture hook-install\` — \`synapse init\` is now the canonical install path"
git push origin worktree-handoff-layer-v1
```

---

### Task 13: Retire `cli/brief.ts` + `cli/brief-format.ts`

**Files (delete):**
- `mcp/src/cli/brief.ts`
- `mcp/src/cli/brief-format.ts`
- Their tests

**Files (modify):**
- `mcp/src/index.ts` — if `brief` HANDLERS entry pointed at the legacy renderer, redirect to a thin wrapper around `renderBriefFromCache`
- `backend/src/api/session-context.ts` — remove (no callers after this task) OR mark deprecated
- `README.md` — remove mentions of the legacy brief path

- [ ] **Step 1: Replacement brief handler**

In `mcp/src/index.ts`:

```ts
import { renderBriefFromCache } from "./capture/handoff-brief.js";
import { resolveProjectFromCwd } from "./cli/resolve-project.js";

HANDLERS["brief"] = async () => {
  const project_id = await resolveProjectFromCwd(process.cwd());
  const config = readConfig();
  if (!project_id) {
    process.stdout.write("<synapse-brief>\n(no project resolved for current directory)\n</synapse-brief>\n");
    return 0;
  }
  process.stdout.write(`<synapse-brief>\n${renderBriefFromCache(project_id, config.user_id ?? "unknown")}\n</synapse-brief>\n`);
  return 0;
};
```

- [ ] **Step 2: Delete legacy files + commit + push**

```bash
rm mcp/src/cli/brief.ts mcp/src/cli/brief-format.ts mcp/test/cli/brief.test.ts 2>/dev/null
# Remove session-context.ts route if no caller remains
npx vitest run
npm run typecheck && npm run lint
git add -A
git commit -m "refactor(mcp): retire legacy brief renderer; \`synapse brief\` reads from daemon cache"
git push origin worktree-handoff-layer-v1
```

---

### Task 14: Drop `SYNAPSE_PASSPHRASE` encryption

**Files (modify):**
- `mcp/src/index.ts` — remove `decryptContent`, `getEncKey`, `deriveKeyNode`, any conditional encryption branches
- `README.md` — remove the "Optional environment variables" mentions of `SYNAPSE_PASSPHRASE` and `SYNAPSE_USER_EMAIL`

- [ ] **Step 1: Apply**

Delete the three functions. Remove any `if (process.env.SYNAPSE_PASSPHRASE)` branches by taking the unencrypted path unconditionally.

- [ ] **Step 2: Verify, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "refactor(mcp): remove undocumented SYNAPSE_PASSPHRASE encryption escape hatch"
git push origin worktree-handoff-layer-v1
```

---

### Task 15: Trim legacy MCP server (keep save_insight + list_insights)

**Files (modify):**
- `mcp/src/index.ts` (the big MCP server block lines ~322-958) — remove `ls`, `read`, `search`, `history`, `tree`, `list_conversations`, `load_conversation`, `resolvePath`, local duplicate `Conversation*` interfaces
- `README.md` — update MCP section: mark "Legacy" header, note that ls/read/search/history/tree/list_conversations/load_conversation are removed; `save_insight` + `list_insights` remain for backward compatibility

**Keep (mark as deprecated in comments):**
- `save_insight` tool registration + handler
- `list_insights` tool registration + handler

- [ ] **Step 1: Apply**

This is a large surgical edit. Approach:
1. Open `mcp/src/index.ts` and locate the MCP `server.setRequestHandler` calls
2. Keep only `save_insight` and `list_insights` registrations
3. Delete the others and their handlers
4. Delete the local `Conversation*` interfaces (use the shared package types if needed elsewhere)
5. Add `// DEPRECATED: legacy MCP surface. Prefer REST API or handoff CLI. Removal target: v2.0` above the remaining registrations

- [ ] **Step 2: Verify, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "refactor(mcp): deprecate legacy MCP server — keep save_insight + list_insights, drop the rest"
git push origin worktree-handoff-layer-v1
```

---

### Task 16: Update README and ARCHITECTURE.md

**Files (modify):**
- `README.md`
- `docs/ARCHITECTURE.md`

Updates needed across both:
- Reflect v1.1's user flow (handoff is the headline; slash commands are the primary CC surface; daemon auto-creates projects; invite flow exists)
- Remove mentions of deprecated/removed surfaces (`SYNAPSE_PASSPHRASE`, `capture hook-install`, legacy brief)
- Add a "Slash commands" section listing the 6 commands
- Add an "Invite a teammate" section

- [ ] **Step 1: Apply edits**

Surgical, don't rewrite the whole files.

- [ ] **Step 2: Commit, push**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: update for v1.1 — slash commands, invite flow, removed legacy surfaces"
git push origin worktree-handoff-layer-v1
```

---

## Phase E — Final integration

### Task 17: Surgical cleanup within `capture/*` (Q1 — keep capture, trim noise)

**Files:**
- Audit and trim: `mcp/src/capture/types.ts` (already partly done in Task 10), and any other small dead exports in `mcp/src/capture/adapters/*.ts`
- No structural changes — capture daemon stays

- [ ] **Step 1: Run a focused dead-export audit on capture/**

```bash
npx ts-unused-exports mcp/tsconfig.json 2>/dev/null | grep -i capture | head -30
```

Remove anything that's clearly orphaned but be conservative — adapter exports may be intentionally public for future hosts.

- [ ] **Step 2: Apply, commit, push**

```bash
npx vitest run mcp/
npm run typecheck -w mcp && npm run lint
git add -A
git commit -m "chore(mcp/capture): trim residual unused exports — capture daemon architecture preserved"
git push origin worktree-handoff-layer-v1
```

---

### Task 18: Final verification

Run the full test suite and confirm v1.1 acceptance criteria.

- [ ] **Step 1: Full verification**

```bash
export PATH=/opt/homebrew/opt/node/bin:$PATH
npx vitest run mcp/
npx vitest run packages/shared/
cd backend && npx vitest run test/ && cd ..
npm run typecheck -w mcp && npm run typecheck -w backend
npm run lint
```

Expect: all tests pass, typecheck clean, lint clean.

- [ ] **Step 2: Manual smoke (if possible)**

1. `npm run build -w mcp` — build the CLI
2. `node mcp/dist/index.js init --api-key test --skip-service` — verify hooks installed, slash commands written
3. `node mcp/dist/index.js status` — should print "Daemon: not running" (no live daemon)
4. `node mcp/dist/index.js handoff "test next step"` — should write event to `~/.synapse/projects/<id>/events.jsonl`
5. Verify `~/.synapse/config.json` contains only `{ api_key: "test" }` — no `daemon` sub-object

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-05-14-handoff-layer-v1.1-design.md`, change:
```
**Status:** Draft — pending review
```
to:
```
**Status:** Implemented (v1.1.0)
```

- [ ] **Step 4: Count line delta**

```bash
git diff main --stat mcp/src backend/src packages/shared/src | tail -5
```

Expect: net negative or near-zero (we removed more than we added).

- [ ] **Step 5: Final commit, push**

```bash
git add docs/superpowers/specs/2026-05-14-handoff-layer-v1.1-design.md
git commit -m "docs: mark v1.1 spec as Implemented"
git push origin worktree-handoff-layer-v1
```

---

## Out of scope (deferred to v1.2+)

- Sub-second presence (B3)
- Decision extraction from raw events
- Periodic project digests
- Onboarding-tailored summaries
- Windows OS service installer
- Manual issue merge (dedup)
- Frontend dashboard changes
- Capture-adapter expansion for new hosts
- Migration of `save_insight` writes into structured `Issue` records (`save_insight` keeps working as legacy)
