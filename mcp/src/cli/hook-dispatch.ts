import { createHash } from "node:crypto";
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
export async function readHookPayloadFromStdin(): Promise<AnyHookPayload> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const parsed = JSON.parse(raw);
  // TODO: integrate with project-map.ts when resolveProjectIdFromCwd lands.
  // For now, derive a deterministic id from the cwd hash so events still flow.
  const project_id = hashCwd(parsed.cwd ?? process.cwd());
  return {
    project_id,
    user_id: process.env.SYNAPSE_USER_ID ?? "default",
    session_id: parsed.session_id,
    tool: parsed.tool_name,
    input: parsed.tool_input,
    output: parsed.tool_response,
    prompt: parsed.prompt,
    subagent: parsed.subagent_type,
    stdout: process.stdout,
  };
}

/** First 12 hex chars of cwd's sha1, prefixed with `cwd_`. */
export function hashCwd(cwd: string): string {
  return `cwd_${createHash("sha1").update(cwd).digest("hex").slice(0, 12)}`;
}
