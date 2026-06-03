/**
 * scripts/e2e-cleanup.mjs — shared sweep helper for E2E test artifact cleanup.
 *
 * Why this exists: every E2E suite already has a per-script `cleanup()` that
 * tracks a single `testProjectId`, but the daemon-side `auto-create on first
 * sync` path can land *additional* projects during a test (e.g. when the
 * router resolves the same git remote to two URLs, or when a stage retries).
 * Single-ID tracking misses those. A name-pattern sweep at the end catches
 * everything the test created — both this-run leaks and any historical
 * residue from prior runs whose process was killed before cleanup() ran.
 *
 * Contract:
 *   - Non-throwing: a sweep failure must NOT change the test's exit code.
 *     The test's PASS/FAIL is the signal; cleanup is hygiene.
 *   - Idempotent: running twice in a row is safe (second run finds 0 matches).
 *   - Opt-out via env: E2E_SKIP_SWEEP=1 skips the sweep entirely (for
 *     post-mortem inspection — you'd want the projects to stay so you can
 *     poke at them in the dashboard).
 *
 * Pattern matching: a "pattern" is a substring matched against project.name
 * via String.prototype.includes. The standard usage is to pass the test's
 * RUN_ID timestamp as a pattern — every project name in a self-cleaning
 * test embeds the RUN_ID, so `[`-${RUN_ID}`]` catches them all in one call.
 *
 * Force-deletes (?force=true) because we KNOW these are test artifacts:
 * the merge-into-or-force-true guard on DELETE is a UX feature for end
 * users worried about losing real data, not a constraint for our own
 * test mess.
 */

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_API_URL = process.env.SYNAPSE_API_URL ?? "https://api.synapsesync.app";
const DEFAULT_SYNAPSE_HOME = process.env.SYNAPSE_HOME ?? path.join(homedir(), ".synapse");

/**
 * Remove the daemon's local state directory for a project — kills the source
 * of pending event flushes that would otherwise auto-recreate the project
 * after a backend DELETE. See sweepArtifacts() jsdoc for the race.
 *
 * Safe: it only removes `~/.synapse/projects/<uuid>/`, never anything else.
 * Non-throwing: filesystem errors are logged but don't propagate.
 */
export function removeLocalProjectState(
  projectId,
  { synapseHome = DEFAULT_SYNAPSE_HOME, log = (m) => console.log(m) } = {},
) {
  if (!projectId) return;
  const dir = path.join(synapseHome, "projects", projectId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
    log(`  · cleanup: removed local daemon state ${dir}`);
  } catch (e) {
    log(`  · cleanup: WARN failed to rm ${dir}: ${e.message}`);
  }
}

/**
 * Sweep test artifacts on the account belonging to `apiKey`.
 *
 * @param {object} opts
 * @param {string} opts.apiKey - Bearer token for the account to sweep.
 * @param {string[]} opts.patterns - Substrings to match against project.name.
 *   A project whose name contains ANY of these is deleted.
 * @param {string} [opts.apiUrl] - Backend base URL (defaults to public prod).
 * @param {Function} [opts.log] - log(msg) — defaults to console.log.
 * @param {string} [opts.label] - Short tag printed in log lines for context
 *   when sweeping multiple accounts (e.g. "User A" / "User B").
 * @param {number} [opts.settleMs] - Sleep before sweeping to let the
 *   globally-supervised daemon drain its in-flight batch. The leak class
 *   this guards against: test deletes project X, daemon still has queued
 *   events from this test, daemon flushes AFTER the test's cleanup, backend
 *   auto-creates a fresh project with the same name. Default 3000ms is
 *   based on the daemon's default flush interval; bump it if you observe
 *   recurring same-name leaks. Set 0 to skip the sleep entirely.
 * @returns {Promise<{matched: number, deleted: number, failed: object[]}>}
 *   Returns counts even on partial failure. Never throws.
 */
export async function sweepArtifacts({
  apiKey,
  patterns,
  apiUrl = DEFAULT_API_URL,
  log = (m) => console.log(m),
  label = "",
  settleMs = 5000,
}) {
  const tag = label ? `sweep[${label}]` : "sweep";

  if (process.env.E2E_SKIP_SWEEP) {
    log(`  · ${tag}: skipped (E2E_SKIP_SWEEP set)`);
    return { matched: 0, deleted: 0, failed: [] };
  }

  // Settling delay lets the daemon flush before we list — see settleMs jsdoc.
  if (settleMs > 0) {
    log(`  · ${tag}: settling ${settleMs}ms for daemon flush…`);
    await new Promise((r) => setTimeout(r, settleMs));
  }

  if (!apiKey) {
    log(`  · ${tag}: WARN no apiKey provided — cannot sweep`);
    return { matched: 0, deleted: 0, failed: [] };
  }

  if (!patterns || patterns.length === 0) {
    log(`  · ${tag}: WARN no patterns provided — refusing to sweep all projects`);
    return { matched: 0, deleted: 0, failed: [] };
  }

  const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  let all;
  try {
    const res = await fetch(`${apiUrl}/api/projects`, { headers: auth });
    if (!res.ok) {
      log(`  · ${tag}: WARN list failed (HTTP ${res.status})`);
      return { matched: 0, deleted: 0, failed: [] };
    }
    all = await res.json();
  } catch (e) {
    log(`  · ${tag}: WARN list errored (${e.message})`);
    return { matched: 0, deleted: 0, failed: [] };
  }

  const matches = all.filter((p) => patterns.some((pat) => p.name.includes(pat)));

  if (matches.length === 0) {
    log(`  · ${tag}: 0 artifacts to delete`);
    return { matched: 0, deleted: 0, failed: [] };
  }

  // Sequential — ~5-10 deletes per script, no need to parallelize and risk
  // rate-limit. Backend has 120 req/min limit per the constants we kept.
  let deleted = 0;
  const failed = [];
  for (const p of matches) {
    try {
      const r = await fetch(`${apiUrl}/api/projects/${p.id}?force=true`, {
        method: "DELETE",
        headers: auth,
      });
      if (r.ok) {
        deleted += 1;
        // Also nuke the daemon's local state for this project so it stops
        // retrying queued events → otherwise backend auto-recreates the
        // project from git_remote_url, leaking it again.
        removeLocalProjectState(p.id, { log: () => {} });
      } else {
        failed.push({ id: p.id.slice(0, 8), name: p.name, status: r.status });
      }
    } catch (e) {
      failed.push({ id: p.id.slice(0, 8), name: p.name, error: e.message });
    }
  }

  log(`  · ${tag}: deleted ${deleted} of ${matches.length} artifact(s)`);
  for (const f of failed) {
    const reason = f.status ? `HTTP ${f.status}` : f.error;
    log(`  · ${tag}: WARN ${f.id} (${f.name}) → ${reason}`);
  }

  return { matched: matches.length, deleted, failed };
}
