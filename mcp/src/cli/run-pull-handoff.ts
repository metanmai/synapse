import { pullHandoff } from "../capture/pull-compact.js";

/**
 * CLI entry: `synapsesync pull-handoff --cwd <path>`.
 *
 * Runs the same `pullHandoff` logic the SessionStart hook uses, but with
 * NO timeout — the call can take 30-60s for a large session because it
 * spawns `claude -p` to recompute the handoff via the local LLM.
 *
 * Intended caller: the PreCompact hook, which spawns this detached so the
 * recompute completes in the background and the handoff is ready when the
 * user opens their NEXT session. Without this pre-warm, the next session's
 * SessionStart hook (10s budget) times out before recompute finishes, and
 * the user sees a stale handoff (or no handoff at all) for that one
 * session before the system self-heals on the session after.
 *
 * Exits 0 on success regardless of whether a handoff was produced — the
 * caller is fire-and-forget, and we don't want to surface failures as
 * exit-code noise in the parent's log scrape. Diagnostics go to stderr
 * which the spawner redirects to a log file.
 */
export async function runPullHandoff(args: string[]): Promise<void> {
  const cwdIdx = args.indexOf("--cwd");
  if (cwdIdx < 0 || !args[cwdIdx + 1]) {
    process.stderr.write("usage: synapsesync pull-handoff --cwd <path>\n");
    process.exit(2);
  }
  const cwd = args[cwdIdx + 1];

  const start = Date.now();
  try {
    const result = await pullHandoff({
      cwd,
      log: (msg) => process.stderr.write(`[pull-handoff] ${msg}\n`),
    });
    const elapsed = Date.now() - start;
    process.stderr.write(`[pull-handoff] done cwd=${cwd} elapsed=${elapsed}ms length=${result ? result.length : 0}\n`);
  } catch (err) {
    const elapsed = Date.now() - start;
    process.stderr.write(
      `[pull-handoff] FAILED cwd=${cwd} elapsed=${elapsed}ms err=${err instanceof Error ? err.message : err}\n`,
    );
  }
  process.exit(0);
}
