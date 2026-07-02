import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readUserIdFromConfig } from "../capture/identity.js";
import { runPostToolUseHook } from "../hooks/post-tool-use.js";
import { runPreCompactHook } from "../hooks/pre-compact.js";
import { runSessionEndHook } from "../hooks/session-end.js";
import { runSessionStartHook } from "../hooks/session-start.js";
import { runSubagentStopHook } from "../hooks/subagent-stop.js";
import { runUserPromptSubmitHook } from "../hooks/user-prompt-submit.js";

// biome-ignore lint/suspicious/noExplicitAny: hook payloads are heterogeneous and shape-checked per handler
type AnyHookPayload = Record<string, any>;

/**
 * Dispatch a hook event to its handler. `kind` is the Claude Code hook event kind
 * passed as a subcommand argument (e.g. `synapse hook session-start`).
 */
export async function dispatchHook(kind: string, payload: AnyHookPayload): Promise<void> {
  switch (kind) {
    case "session-start":
      return runSessionStartHook(payload as Parameters<typeof runSessionStartHook>[0]);
    case "user-prompt-submit":
      return runUserPromptSubmitHook(payload as Parameters<typeof runUserPromptSubmitHook>[0]);
    case "post-tool-use":
      return runPostToolUseHook(payload as Parameters<typeof runPostToolUseHook>[0]);
    case "pre-compact":
      return runPreCompactHook(payload as Parameters<typeof runPreCompactHook>[0]);
    case "session-end":
      return runSessionEndHook(payload as Parameters<typeof runSessionEndHook>[0]);
    case "subagent-stop":
      return runSubagentStopHook(payload as Parameters<typeof runSubagentStopHook>[0]);
    default:
      process.stderr.write(`unknown hook: ${kind}\n`);
      return;
  }
}

/**
 * Read the hook event JSON from stdin (Claude Code's hook protocol) and shape it
 * into the per-handler args. Fields per event kind:
 *   SessionStart      → { session_id, cwd, source }
 *   UserPromptSubmit  → { session_id, cwd, prompt }
 *   PostToolUse       → { session_id, cwd, tool_name, tool_input, tool_response }
 *   PreCompact        → { session_id, cwd, trigger }
 *   SessionEnd        → { session_id, cwd, reason }
 *   SubagentStop      → { session_id, cwd, subagent_type }
 */
export async function readHookPayloadFromStdin(): Promise<AnyHookPayload | null> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const parsed = JSON.parse(raw);
  const cwd: string = canonicalCwd(parsed.cwd ?? process.cwd());

  // Short-circuit BEFORE shelling out to git or emitting any event when the
  // cwd is ephemeral (agent worktree, scratch dir, marker opt-out, env opt-out).
  // Without this guard the backend's findOrCreateProjectByGit happily creates
  // a project per throwaway cwd, polluting the user's dashboard.
  const skip = shouldSkipDispatch(cwd, process.env);
  if (skip.skip) {
    if (process.env.SYNAPSE_DEBUG === "1") {
      process.stderr.write(`synapsesync hook skipped: ${skip.reason}\n`);
    }
    return null;
  }

  // Derive a cwd-hash placeholder; the backend's auto-create flow rewrites
  // it to a canonical UUID using `git_basename` as the project name.
  const project_id = hashCwd(cwd);
  const git_basename = getGitBasename(cwd) ?? path.basename(cwd);
  const git_remote_url = getGitRemoteUrl(cwd);
  return {
    project_id,
    user_id: process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig(),
    session_id: parsed.session_id,
    tool: parsed.tool_name,
    input: parsed.tool_input,
    output: parsed.tool_response,
    prompt: parsed.prompt,
    subagent: parsed.subagent_type,
    cwd,
    git_basename,
    git_remote_url,
    stdout: process.stdout,
  };
}

/**
 * Predicate: should the daemon skip event emission for this cwd?
 *
 * Returns `{ skip: true, reason }` when ANY of these hold:
 *   (a) cwd is under `~/.claude/worktrees/` — Claude Code's agent-isolation
 *       namespace; agent worktrees are throwaway and capturing them creates
 *       dashboard pollution.
 *   (b) cwd is under `$TMPDIR` / `/tmp/` / `/private/tmp/` — scratch dirs
 *       from tests, spikes, throwaway experiments. macOS aliases `/tmp` →
 *       `/private/tmp` so we list both.
 *   (c) a `.synapse-skip` marker file exists in cwd or any ancestor up to
 *       (and including) the user's home directory — per-dir opt-out.
 *   (d) `SYNAPSE_SKIP_DISPATCH=1` env var is set — scripted opt-out for E2E
 *       test runners and CI.
 *
 * Pure: takes `cwd` + `env`. `opts` exists only for DI in unit tests (override
 * homeDir, tmpDir, markerFile, fileExists). No side effects.
 */
export interface SkipDispatchOpts {
  homeDir?: string;
  markerFile?: string;
  fileExists?: (p: string) => boolean;
}

export type SkipDispatchResult = { skip: true; reason: string } | { skip: false };

export function shouldSkipDispatch(
  cwd: string,
  env: NodeJS.ProcessEnv,
  opts: SkipDispatchOpts = {},
): SkipDispatchResult {
  // (e) Force-allow override — wins over EVERYTHING. Used by E2E tests
  // that intentionally run in tmp dirs and need capture to fire there.
  // Production users never set this; tests opt-in explicitly.
  if (env.SYNAPSE_DISPATCH_FORCE_ALLOW === "1") {
    return { skip: false };
  }

  // (d) env var — cheapest check after the override, do first.
  if (env.SYNAPSE_SKIP_DISPATCH === "1") {
    return { skip: true, reason: "SYNAPSE_SKIP_DISPATCH=1" };
  }

  const homeDir = opts.homeDir ?? os.homedir();
  const markerFile = opts.markerFile ?? ".synapse-skip";
  const fileExists = opts.fileExists ?? ((p) => fs.existsSync(p));

  const normCwd = path.resolve(cwd);

  // (a) Claude Code agent worktree paths.
  const worktreesDir = path.resolve(homeDir, ".claude", "worktrees");
  if (isPathStrictlyUnder(normCwd, worktreesDir)) {
    return { skip: true, reason: `cwd under ${worktreesDir}` };
  }

  // (b) Marker file walk: cwd → parent → ... → home (inclusive). Stop at
  // home so a stray marker in `/` or `/Users` doesn't silently disable
  // everything for the entire user.
  const stopAt = path.resolve(homeDir);
  let cur = normCwd;
  // Cap the loop in case of unusual filesystems / symlink cycles.
  for (let i = 0; i < 64; i++) {
    if (fileExists(path.join(cur, markerFile))) {
      return { skip: true, reason: `${markerFile} marker found in ${cur}` };
    }
    if (cur === stopAt) break;
    const parent = path.dirname(cur);
    if (parent === cur) break; // hit filesystem root before reaching home
    cur = parent;
  }

  return { skip: false };
}

/**
 * True iff `child` is strictly the same as `parent` or a path under it.
 * Uses `path.relative` so `/tmp` does NOT match `/tmpfoo` (relative would be
 * `../tmpfoo`, starting with `..`).
 */
function isPathStrictlyUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true; // same path
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Resolve symlinks + normalize the cwd so that two paths that point at the
 * same on-disk location (e.g. `/Users/me/work/proj` symlinked to
 * `/Users/me/Documents/proj`, or `/tmp` → `/private/tmp` on macOS) hash to
 * the same `cwd_<...>` placeholder and route to the same backend project.
 *
 * Falls back to the input path when the file no longer exists at resolve
 * time (e.g. dir was deleted between SessionStart and now). Callers must
 * never depend on the post-canonical path being readable — it's only used
 * as a routing key.
 */
export function canonicalCwd(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/** First 12 hex chars of cwd's sha1, prefixed with `cwd_`. */
export function hashCwd(cwd: string): string {
  return `cwd_${createHash("sha1").update(cwd).digest("hex").slice(0, 12)}`;
}

/**
 * Resolve a git repository's basename from `cwd`. Falls back to `null` when
 * cwd is not inside a git repo; callers should default to `path.basename(cwd)`.
 */
export function getGitBasename(cwd: string): string | null {
  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return root ? path.basename(root) : null;
  } catch {
    return null;
  }
}

// Phase 2 (D-06): per-process cache so repeated hook fires in the same Claude
// Code session don't re-shell-out for an unchanged remote URL. NOT persisted —
// each process starts cold (which is fine; hooks are short-lived).
const gitRemoteCache = new Map<string, string | undefined>();

/**
 * Resolve the git repository's origin remote URL from `cwd`. Returns `undefined`
 * for non-git directories OR git repos without an `origin` remote. The matcher
 * in events-batch.ts treats `undefined` as "no URL signal — fall back to name
 * match," so this function is safe to call in environments without git.
 */
export function getGitRemoteUrl(cwd: string): string | undefined {
  if (gitRemoteCache.has(cwd)) return gitRemoteCache.get(cwd);
  let url: string | undefined;
  try {
    const out = execSync("git config --get remote.origin.url", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    url = out || undefined;
  } catch {
    url = undefined;
  }
  gitRemoteCache.set(cwd, url);
  return url;
}
