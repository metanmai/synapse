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
import { readProjectMap } from "./project-map.js";
import { runDaemon } from "./run-daemon.js";
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
  doctor: async () => {
    process.stdout.write(`${await runHandoffDoctor()}\n`);
  },
  refresh: async () => runRefresh(),
  upgrade: async () => runUpgrade(),
  whoami: async () => runWhoami(),
  capture: async (args) => runCapture(args),
  hook: async (args) => runHook(args),
  reset: async () => runReset(),
  uninstall: async () => runUninstall(),
  init: async (args) => {
    const flagIdx = args.indexOf("--api-key");
    const api_key = flagIdx >= 0 ? (args[flagIdx + 1] ?? "") : (args.find((a) => !a.startsWith("--")) ?? "");
    if (!api_key) {
      throw new Error('usage: synapse init --api-key "<your-api-key>" [--skip-service]');
    }
    const skip_service = args.includes("--skip-service");
    await runInit({ api_key, skip_service });
  },
  // `daemon` is the entry the OS service (launchd plist / systemd unit
  // written by `synapse init`) invokes. It discovers tracked projects,
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
      throw new Error("usage: synapse invite <email> [--project <id>]");
    }
    const projectIdx = args.indexOf("--project");
    const project_id = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
    await runInviteCmd({ email, project_id });
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
