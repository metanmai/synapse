import fs from "node:fs";

/**
 * Resolve a stable alias for the running node binary when the raw
 * `process.execPath` is version-pinned and will vanish on the next upgrade.
 *
 * Bug class (found 2026-06-10): everything the installer persists to disk —
 * the 6 Claude Code hook commands in `~/.claude/settings.json`, the launchd /
 * systemd / Task Scheduler service definitions, and the `.mcp.json` MCP
 * server command — embedded `process.execPath` verbatim. Under Homebrew that
 * is `/opt/homebrew/Cellar/node/<version>/bin/node`, a path that exists ONLY
 * for the currently-installed version. `brew upgrade node` deletes it,
 * silently killing every hook and leaving the daemon un-respawnable. Worse,
 * an already-running daemon keeps the deleted inode mapped, so the breakage
 * only surfaces on the next restart or reboot — long after the upgrade that
 * caused it.
 *
 * Fix: when execPath sits inside a Homebrew Cellar, prefer the formula's
 * stable symlinks, which Homebrew repoints on every upgrade:
 *   1. `<prefix>/opt/<formula>/bin/node`  (tracks the same formula, even for
 *      versioned formulae like `node@22` that aren't linked into bin/)
 *   2. `<prefix>/bin/node`                (the user-facing symlink)
 * Each candidate is verified to exist before being used; when neither does,
 * the raw execPath is returned unchanged — a pinned-but-working path beats a
 * stable-but-missing one.
 *
 * Non-Homebrew paths (system node, nvm, Windows, Linux distro packages) pass
 * through untouched: we only rewrite when we positively recognize the
 * version-pinned layout AND can verify a stable replacement.
 */
export function resolveStableNodePath(
  execPath: string = process.execPath,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const cellar = execPath.match(/^(\/opt\/homebrew|\/usr\/local)\/Cellar\/(node(?:@[\d.]+)?)\/[^/]+\/bin\/node$/);
  if (!cellar) return execPath;
  const [, prefix, formula] = cellar;
  for (const candidate of [`${prefix}/opt/${formula}/bin/node`, `${prefix}/bin/node`]) {
    if (exists(candidate)) return candidate;
  }
  return execPath;
}
