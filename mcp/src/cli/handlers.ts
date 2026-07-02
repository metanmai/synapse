/**
 * CLI subcommand dispatch table.
 *
 * Lifted out of `mcp/src/index.ts` so the map can be imported by tests
 * without triggering the entry-point code at the bottom of `index.ts`
 * (which calls `handleCli` / spawns the MCP server at module load).
 *
 * Entries here are the single source of truth for `synapse <cmd>`
 * dispatch — `index.ts` looks up the cmd in this map and runs the
 * handler. Tests can invoke handlers directly with synthesized argv.
 */

import crypto from "node:crypto";

import { runCapture } from "../capture/cli.js";
import { renderBriefFromCache } from "../capture/handoff-brief.js";
import { readUserIdFromConfig } from "../capture/identity.js";
import {
  runHook,
  runStatus as runLegacyStatus,
  runRefresh,
  runReset,
  runTree,
  runUninstall,
  runUpgrade,
  runWhoami,
} from "./commands.js";
import {
  parseHandoffArgs,
  parseIssueCreateArgs,
  parseIssueResolveArgs,
  parseIssueSupersedeArgs,
  parseNoteArgs,
  parseSetFocusArgs,
} from "./handoff-arg-parse.js";
import {
  runHandoffCmd,
  runIssueCreate,
  runIssueResolve,
  runIssueSupersede,
  runNoteCmd,
  runSetFocusCmd,
} from "./handoff-commands.js";
import { runInit } from "./init.js";
import { runInviteCmd } from "./invite.js";
import { runMoveCmd } from "./move.js";
import { readProjectMap } from "./project-map.js";
import { runPurgeEmptyCmd } from "./purge-empty.js";
import { runDaemon } from "./run-daemon.js";
import { runPullHandoff } from "./run-pull-handoff.js";
import { formatSmokeResult, runSmoke } from "./smoke.js";
import { runStats } from "./stats.js";
import { runDoctor as runHandoffDoctor, runStatus as runHandoffStatus } from "./status.js";

// Re-export the legacy status function so callers (e.g. the interactive
// menu in `index.ts`) keep their existing wiring after this refactor.
export { runLegacyStatus };

// ── Handler context resolution ──────────────────────────────────────────
//
// project_id: a `SYNAPSE_TEST_PROJECT_ID` override (tests), then the local
//   project-map keyed by cwd, then a deterministic `cwd_<hash>` fallback so
//   first-run agents still write events. The backend auto-create flow
//   (v1.1 Task 6) rewrites that placeholder to a canonical UUID.
// user_id: pulled from `~/.synapse/config.json` if it exposes one,
//   otherwise falls back to a stable local placeholder. The reducer keys on
//   the API-key owner anyway; user_id is provenance only.
// session_id: per-invocation, monotonic so events from one CLI call group.

interface HandlerContext {
  project_id: string;
  user_id: string;
  session_id: string;
}

function hashCwdShort(cwd: string): string {
  return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

function resolveProjectFromCwd(cwd: string): string {
  const override = process.env.SYNAPSE_TEST_PROJECT_ID;
  if (override) return override;
  try {
    const map = readProjectMap();
    const entry = map[cwd];
    if (entry?.project_id) return entry.project_id;
  } catch {
    /* fall through to cwd_hash */
  }
  return `cwd_${hashCwdShort(cwd)}`;
}

function handlerContext(): HandlerContext {
  return {
    project_id: resolveProjectFromCwd(process.cwd()),
    user_id: readUserIdFromConfig(),
    session_id: `cli_${Date.now().toString(36)}`,
  };
}

// ── Help printer hook ───────────────────────────────────────────────────
//
// `printHelp` lives in `index.ts` because it references the CLI banner +
// theme. Tests don't exercise `help`; `index.ts` overrides the entry at
// module load time.

let _printHelp: () => void = () => {
  process.stdout.write("synapse: help unavailable in this context\n");
};

export function registerPrintHelp(fn: () => void): void {
  _printHelp = fn;
}

// ── HANDLERS map ────────────────────────────────────────────────────────

export const HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  brief: async () => {
    const ctx = handlerContext();
    process.stdout.write(`${renderBriefFromCache(ctx.project_id, ctx.user_id)}\n`);
  },
  help: async () => {
    _printHelp();
  },
  stats: async () => runStats(),
  tree: async () => runTree(),
  // `status` reports daemon health for the v1.1 handoff layer. The legacy
  // account/connection status is still reachable via the interactive menu
  // in `index.ts` (it imports `runLegacyStatus` from this module).
  status: async () => {
    process.stdout.write(`${await runHandoffStatus()}\n`);
  },
  // `doctor` reports daemon health by default. `doctor --smoke` adds a
  // 5-stage roundtrip check against the live backend: hooks installed, API
  // key valid, synthetic event POST, brief readable, self-cleanup. The
  // smoke is opt-in because it costs a network roundtrip and creates +
  // deletes a project — useful after `wizard` or when debugging "why does
  // Claude open without a brief" but not what every `doctor` call needs.
  doctor: async (args) => {
    process.stdout.write(`${await runHandoffDoctor()}\n`);
    if (args.includes("--smoke")) {
      const result = await runSmoke();
      process.stdout.write(`${formatSmokeResult(result)}\n`);
      if (!result.ok) process.exit(1);
    }
  },
  refresh: async (args) => runRefresh({ dryRun: args.includes("--dry-run") }),
  // Phase 03-05: `sync` is Free-tier's manual flush+pull command (the
  // daemon's 5-min auto-cycle is gated off on Free). Streams progress
  // per step + final summary. Plus users can also use it as a debug
  // tool to force a sync without waiting for the next cron tick.
  sync: async () => {
    const { runSync } = await import("./sync.js");
    const code = await runSync();
    if (code !== 0) process.exit(code);
  },
  upgrade: async (args) => runUpgrade({ dryRun: args.includes("--dry-run") }),
  whoami: async () => runWhoami(),
  capture: async (args) => runCapture(args),
  hook: async (args) => runHook(args),
  // `pull-handoff` is the same code path the SessionStart hook uses, but
  // exposed as a CLI so PreCompact can spawn it detached + run in the
  // background. The next session's 10s hook budget is too tight to
  // recompute large transcripts; this pre-warms the backend cache so the
  // next SessionStart hits cache instead of timing out.
  "pull-handoff": async (args) => runPullHandoff(args),
  reset: async (args) => runReset({ yes: args.includes("--yes"), dryRun: args.includes("--dry-run") }),
  uninstall: async (args) => runUninstall({ yes: args.includes("--yes") }),
  init: async (args) => {
    const flagIdx = args.indexOf("--api-key");
    const api_key = flagIdx >= 0 ? (args[flagIdx + 1] ?? "") : (args.find((a) => !a.startsWith("--")) ?? "");
    if (!api_key) {
      throw new Error('usage: synapsesync init --api-key "<your-api-key>" [--skip-service]');
    }
    const skip_service = args.includes("--skip-service");
    await runInit({ api_key, skip_service });
  },
  // `daemon` is the entry the OS service (launchd plist / systemd unit
  // written by `synapsesync init`) invokes. It discovers tracked projects,
  // starts the handoff loop, and blocks forever — the loop's intervals +
  // signal handlers keep the event loop alive and supervise shutdown.
  daemon: async () => {
    runDaemon();
    await new Promise<void>(() => {});
  },
  // ── v1.1 handoff-layer subcommands ────────────────────────────────────
  handoff: async (args) => {
    const { text } = parseHandoffArgs(args);
    const ctx = handlerContext();
    await runHandoffCmd({ ...ctx, text });
  },
  "set-focus": async (args) => {
    const { text } = parseSetFocusArgs(args);
    const ctx = handlerContext();
    await runSetFocusCmd({ ...ctx, text });
  },
  note: async (args) => {
    const { target, text } = parseNoteArgs(args);
    const ctx = handlerContext();
    await runNoteCmd({ ...ctx, target, text });
  },
  invite: async (args) => {
    const email = args[0];
    if (!email || email.startsWith("--")) {
      throw new Error("usage: synapsesync invite <email> [--project <id>]");
    }
    const projectIdx = args.indexOf("--project");
    const project_id = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
    await runInviteCmd({ email, project_id });
  },
  // `move` reassigns a misrouted conversation to a different project.
  // <conv> = UUID or the literal "latest"; <project> = UUID or name
  // (exact, then unique-substring fuzzy match).
  move: async (args) => {
    const positional = args.filter((a) => !a.startsWith("--"));
    const conv = positional[0];
    const project = positional[1];
    if (!conv || !project) {
      throw new Error("usage: synapsesync move <conv-uuid|latest> <project-uuid|name> [--dry-run]");
    }
    await runMoveCmd({ conv, project, dryRun: args.includes("--dry-run") });
  },
  // `purge-empty` bulk-deletes the user's empty (zero-conversation,
  // zero-insight) projects. Defaults to a dry-run; pass --yes to actually
  // delete. Without --include-named, only `untitled` projects are
  // considered — this is intentionally conservative so a user can't
  // accidentally nuke an empty-but-real project like `get-shit-done`
  // before they've captured anything to it. Pair with the backend's
  // 409 PROJECT_NOT_EMPTY guard so a stale local view can't drop data.
  "purge-empty": async (args) => {
    const yes = args.includes("--yes");
    const includeIdx = args.indexOf("--include-named");
    const includeNamed = includeIdx >= 0 ? args[includeIdx + 1] : undefined;
    if (includeIdx >= 0 && !includeNamed) {
      throw new Error("usage: synapsesync purge-empty [--yes] [--include-named <pattern>]");
    }
    await runPurgeEmptyCmd({ yes, includeNamed });
  },
  issue: async (args) => {
    const sub = args[0];
    const rest = args.slice(1);
    const ctx = handlerContext();
    if (sub === "create") {
      const parsed = parseIssueCreateArgs(rest);
      await runIssueCreate({ ...ctx, ...parsed });
      return;
    }
    if (sub === "resolve") {
      const parsed = parseIssueResolveArgs(rest);
      await runIssueResolve({ ...ctx, ...parsed });
      return;
    }
    if (sub === "supersede") {
      const parsed = parseIssueSupersedeArgs(rest);
      await runIssueSupersede({ ...ctx, ...parsed });
      return;
    }
    throw new Error(`unknown issue subcommand: ${sub ?? "(missing)"}`);
  },
};

// `wizard` is registered from `index.ts` because it depends on the
// readPackageVersion helper that needs `import.meta.url`. We keep that
// wiring close to its dependency rather than duplicate file-path logic here.
