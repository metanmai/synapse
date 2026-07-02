#!/usr/bin/env node
/**
 * scripts/cleanup-dev-projects.mjs — maintainer cleanup tool.
 *
 * Why this exists: each E2E run creates ~5-10 projects (one per test stage's
 * synthetic git remote). Tests don't reliably DELETE their own artifacts on
 * exit (timeouts / failures / killed processes leak them), and the CLI's
 * `synapsesync purge-empty` only targets `untitled`-named empties by default.
 * After a few dozen runs the dev account hits the tier cap and can't create
 * new projects, breaking the next E2E run.
 *
 * What it does: lists every project on the authenticated account, deletes
 * everything except the names in KEEP_NAMES. Uses `?force=true` so non-empty
 * test artifacts go too (the merge-required guard on DELETE is a UX feature
 * for end users, not what we want when wiping our own test mess).
 *
 * Safety: dry-run by default; pass --yes to actually delete.
 *
 * IMPORTANT: this is a maintainer tool. NEVER run it on a real user's
 * account — it doesn't ask "are you sure" and it bypasses the non-empty
 * guard. Customize KEEP_NAMES below for your own dev account before running.
 *
 * Usage:
 *   node scripts/cleanup-dev-projects.mjs          # dry-run (lists what would go)
 *   node scripts/cleanup-dev-projects.mjs --yes    # actually delete
 *
 * Auth: reads ~/.synapse/config.json for api_key (same path `synapsesync`
 * CLI uses), or honors SYNAPSE_API_KEY env var as a fallback.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const API = process.env.SYNAPSE_API_URL ?? "https://api.synapsesync.app";

// Edit this set for your own dev account. Everything NOT named here is
// considered cleanup-eligible (force-deleted even if non-empty).
// THE Synapse project itself is "synapse" — keep it first so it's hard to miss.
const KEEP_NAMES = new Set(["synapse", "Sunshine", "options-exchange-monorepo", "Rust Cheat Sheet", "warp"]);

const DO_IT = process.argv.includes("--yes");

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

const keep = all.filter((p) => KEEP_NAMES.has(p.name));
const drop = all.filter((p) => !KEEP_NAMES.has(p.name));

console.log(`Account has ${all.length} projects`);
console.log(`Keep: ${keep.length} | Drop: ${drop.length}\n`);

console.log("=== KEEP ===");
for (const p of keep) {
  console.log(`  ${p.name}  (conv=${p.conversation_count ?? 0} ins=${p.insight_count ?? 0})`);
}

console.log(`\n=== DROP ${DO_IT ? "" : "(dry-run — pass --yes to execute)"} ===`);
for (const p of drop) {
  console.log(`  ${p.id.slice(0, 8)}  ${p.name}`);
}

if (!DO_IT) {
  console.log("\n(dry-run complete — re-run with --yes to actually delete)");
  process.exit(0);
}

console.log("\n--- executing ---");
let ok = 0;
const failed = [];

// Sequential to avoid rate-limit; ~50 calls is fast enough. Always
// pass ?force=true: the API's `GET /api/projects` is currently known to
// undercount conversation_count, so we can't trust the list response to
// pre-classify empty-vs-not. Force-delete is the cleanup intent regardless.
for (const p of drop) {
  const url = `${API}/api/projects/${p.id}?force=true`;
  const r = await fetch(url, { method: "DELETE", headers: auth });
  if (r.ok) {
    ok += 1;
  } else {
    const text = await r.text().catch(() => "");
    failed.push({ id: p.id, name: p.name, status: r.status, body: text.slice(0, 200) });
  }
}

console.log(`\nDeleted ${ok} of ${drop.length}`);
if (failed.length > 0) {
  console.log(`\nFailed (${failed.length}):`);
  for (const f of failed) {
    console.log(`  ${f.id.slice(0, 8)} (${f.name}): ${f.status} ${f.body}`);
  }
}
