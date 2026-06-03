#!/usr/bin/env node
/**
 * scripts/cleanup-spam-projects.mjs — interactive pattern-match cleanup.
 *
 * Why this exists: ephemeral cwds (Claude Code agent worktrees,
 * /tmp scratch dirs, multi-device test runners) used to trigger
 * the capture daemon → backend auto-create a project per throwaway
 * cwd. The user's dashboard accumulated 11+ test-pattern projects.
 *
 * The source-of-truth fix lives in mcp/src/cli/hook-dispatch.ts
 * (`shouldSkipDispatch` predicate, ship in commit 68e6ceb). This
 * script is the retroactive cleanup for the pollution that landed
 * before the predicate did.
 *
 * Difference from cleanup-dev-projects.mjs (the existing tool):
 *   - cleanup-dev-projects: ALLOW-LIST (keep KEEP_NAMES, force-delete
 *     everything else). Aggressive. For the maintainer's dev account
 *     after E2E runs leak artifacts.
 *   - cleanup-spam-projects (this file): PATTERN-MATCH (find names
 *     matching known spam patterns, prompt before deleting). Safer.
 *     For any account that has accumulated daemon-from-ephemeral-cwd
 *     pollution.
 *
 * What this does:
 *   1. GET /api/projects
 *   2. Filter to names matching any of SPAM_PATTERNS below.
 *   3. Print the candidate list with id + conv/insight counts.
 *   4. Prompt: "Delete these N projects? Type 'yes' to confirm:"
 *   5. On 'yes' → DELETE /api/projects/:id?force=true per project,
 *      print per-result success/failure.
 *   6. On anything else → "Cancelled. No projects deleted." → exit 0.
 *
 * Safety: never auto-runs. Always interactive. Always shows the list
 * before asking. force=true is used (matches cleanup-dev-projects'
 * rationale: conv counts in the list endpoint may undercount; force
 * is the cleanup intent regardless).
 *
 * Usage:
 *   node scripts/cleanup-spam-projects.mjs
 *
 * Auth: reads ~/.synapse/config.json `api_key` (same path the
 * synapsesync CLI uses), or honors SYNAPSE_API_KEY env var.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const API = process.env.SYNAPSE_API_URL ?? "https://api.synapsesync.app";

// Patterns that strongly suggest "auto-created from an ephemeral cwd."
// Edit cautiously — false positives delete real projects.
const SPAM_PATTERNS = [
  /-[A-Za-z0-9]{6}$/, // 6-char random suffix (Claude Code agent worktree basename)
  /^multi-device-/, // multi-device-<unix-timestamp> from multi-device E2E test runs
  /^cwd_[a-f0-9]{12}$/, // un-rewritten daemon placeholder (no git_basename / git_remote_url)
  /^unknown$/, // backend fallback when name resolution failed entirely
];

function matchesSpam(name) {
  return SPAM_PATTERNS.some((re) => re.test(name));
}

function loadApiKey() {
  const envKey = process.env.SYNAPSE_API_KEY;
  if (envKey) return envKey;
  const cfgPath = path.join(homedir(), ".synapse", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  if (!cfg.api_key) throw new Error(`no api_key in ${cfgPath}`);
  return cfg.api_key;
}

const apiKey = loadApiKey();
const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const res = await fetch(`${API}/api/projects`, { headers: auth });
if (!res.ok) {
  console.error("LIST failed:", res.status, await res.text());
  process.exit(1);
}
const all = await res.json();

const candidates = all.filter((p) => matchesSpam(p.name));
const kept = all.filter((p) => !matchesSpam(p.name));

console.log(`Account has ${all.length} projects`);
console.log(`Pattern-matched candidates: ${candidates.length}`);
console.log(`Not matched (kept): ${kept.length}\n`);

if (candidates.length === 0) {
  console.log("No spam-pattern matches found. Nothing to clean up.");
  process.exit(0);
}

console.log("=== CANDIDATES (will be deleted on confirmation) ===");
for (const p of candidates) {
  const conv = p.conversation_count ?? 0;
  const ins = p.insight_count ?? 0;
  console.log(`  ${p.id.slice(0, 8)}  ${p.name}  (conv=${conv} ins=${ins})`);
}

console.log("\n=== NOT MATCHED (kept) ===");
for (const p of kept) {
  console.log(`  ${p.name}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`\nDelete these ${candidates.length} projects? Type 'yes' to confirm: `);
rl.close();

if (answer.trim().toLowerCase() !== "yes") {
  console.log("Cancelled. No projects deleted.");
  process.exit(0);
}

console.log("\n--- executing ---");
let ok = 0;
const failed = [];

// Sequential to avoid rate-limiting; the candidate list is bounded
// (low double-digits in the worst case the user will ever face).
for (const p of candidates) {
  const url = `${API}/api/projects/${p.id}?force=true`;
  const r = await fetch(url, { method: "DELETE", headers: auth });
  if (r.ok) {
    ok += 1;
    console.log(`  ✓ ${p.id.slice(0, 8)}  ${p.name}`);
  } else {
    const text = await r.text().catch(() => "");
    failed.push({ id: p.id, name: p.name, status: r.status, body: text.slice(0, 200) });
    console.log(`  ✗ ${p.id.slice(0, 8)}  ${p.name}  (${r.status})`);
  }
}

console.log(`\nDeleted ${ok} of ${candidates.length}`);
if (failed.length > 0) {
  console.log(`\nFailed (${failed.length}):`);
  for (const f of failed) {
    console.log(`  ${f.id.slice(0, 8)} (${f.name}): ${f.status} ${f.body}`);
  }
  process.exit(1);
}
