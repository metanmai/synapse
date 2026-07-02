import { pullHandoff } from "../capture/pull-compact.js";

/**
 * CLI entry: `synapsesync pull-handoff (--cwd <path> | --project-id <uuid>)`.
 *
 * Runs the same `pullHandoff` logic the SessionStart hook uses, but with
 * NO timeout — the call can take 30-60s for a large session because it
 * spawns `claude -p` to recompute the handoff via the local LLM.
 *
 * Two intended callers, with different inputs:
 *   1. PreCompact hook → passes `--cwd <path>` so the resolver can map the
 *      hook's working directory to the project. Used at /compact time.
 *   2. capture daemon (continuous pre-warm) → passes `--project-id <uuid>`
 *      because it already knows the project. Fires periodically while the
 *      user works, so a `ctrl+C` exit still finds a warm handoff in the
 *      next session's SessionStart (which is otherwise unreachable: ctrl+C
 *      bypasses PreCompact and SessionEnd entirely).
 *
 * Exits 0 on success regardless of whether a handoff was produced — the
 * caller is fire-and-forget, and we don't want to surface failures as
 * exit-code noise in the parent's log scrape. Diagnostics go to stderr
 * which the spawner redirects to a log file.
 */
export async function runPullHandoff(args: string[]): Promise<void> {
  const cwdIdx = args.indexOf("--cwd");
  const pidIdx = args.indexOf("--project-id");
  const cwd = cwdIdx >= 0 ? args[cwdIdx + 1] : undefined;
  const projectId = pidIdx >= 0 ? args[pidIdx + 1] : undefined;
  if (!cwd && !projectId) {
    process.stderr.write("usage: synapsesync pull-handoff (--cwd <path> | --project-id <uuid>)\n");
    process.exit(2);
  }

  const label = projectId ? `project-id=${projectId}` : `cwd=${cwd}`;
  const start = Date.now();
  try {
    const result = await pullHandoff({
      cwd,
      projectId,
      log: (msg) => process.stderr.write(`[pull-handoff] ${msg}\n`),
    });
    const elapsed = Date.now() - start;
    process.stderr.write(`[pull-handoff] done ${label} elapsed=${elapsed}ms length=${result ? result.length : 0}\n`);
  } catch (err) {
    const elapsed = Date.now() - start;
    process.stderr.write(
      `[pull-handoff] FAILED ${label} elapsed=${elapsed}ms err=${err instanceof Error ? err.message : err}\n`,
    );
  }
  // Same Node 24 + Windows libuv shutdown race that surfaced in
  // index.ts: process.exit(0) here triggers UV_HANDLE_CLOSING because
  // pullHandoff opens fetch keep-alives via /api/projects/resolve and
  // /api/conversations. Run 27130861928 was the smoking gun — the
  // index.ts fix landed 4 of 5 tests green; pullHandoff still crashed
  // because this file has its own process.exit. Same fix pattern.
  process.exitCode = 0;
  setTimeout(() => process.exit(process.exitCode ?? 0), 5_000).unref();
}
