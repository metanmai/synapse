#!/usr/bin/env node
// scripts/e2e-smoke.mjs
//
// E2E TEST FOR `synapsesync doctor --smoke`.
//
// Asserts the promise: "After running `synapsesync wizard`, a user can
// verify their install with `synapsesync doctor --smoke` and either get
// 5 green checkmarks (install works) or actionable failure messages
// (and the failure is real, not a false negative)."
//
// Why this exists as E2E (not just unit tests): the smoke's value is in
// the round-trip against the LIVE backend — POST events/batch, GET
// /api/projects, DELETE force=true. Unit tests with mocked fetch prove
// the state machine and error classification logic, but can't catch:
//
//   - The endpoint shapes drifting on the backend
//   - The auth path silently passing 5xx through to "valid"
//   - The cleanup leaking projects under daemon-outlives-test race
//   - The CLI subprocess exit codes / argv parsing
//
// Stages:
//   S1  Happy path — spawn `doctor --smoke`, expect exit 0, parse output
//       for all 5 stage ✓ markers
//   S2  Idempotency — run a second time immediately, still exit 0
//       (no residue from S1 should affect S2)
//   S3  Zero-leak proof — snapshot account count, run smoke, snapshot
//       again immediately AND after a 60s settle. Account count must be
//       identical at all three points (catches the daemon-outlives-test
//       race we fixed in commit f96aa07).
//
// Usage:
//   npm run test:e2e:smoke
//   node scripts/e2e-smoke.mjs
//
// Cost per run: ~$0 (no LLM calls; pure CLI + REST against backend).
// Wall time: ~90s (the 60s settle dominates).
//
// Exit codes:
//   0 — all stages green, account clean
//   1 — any stage failed
//   2 — preflight error (missing prereq)

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

const results = [];

function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function header(s) {
  log("\n════════════════════════════════════════════════════════════════════");
  log(s);
  log("════════════════════════════════════════════════════════════════════");
}
function ok(stage, detail) {
  results.push({ id: stage, status: "PASS", detail });
  log(`  ✅ PASS · ${detail}`);
}
function fail(stage, detail) {
  results.push({ id: stage, status: "FAIL", detail });
  log(`  ❌ FAIL · ${detail}`);
}
function info(s) {
  log(`  · ${s}`);
}

function readApiKey() {
  const cfgPath = path.join(homedir(), ".synapse", "config.json");
  if (!existsSync(cfgPath)) return null;
  try {
    return JSON.parse(readFileSync(cfgPath, "utf-8")).api_key ?? null;
  } catch {
    return null;
  }
}

async function listProjectCount(apiKey) {
  const res = await fetch(`${API_BASE}/api/projects`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`GET /api/projects → ${res.status}`);
  const projects = await res.json();
  return projects.length;
}

function runSmokeOnce() {
  const start = Date.now();
  const out = spawnSync("node", [MCP_DIST, "doctor", "--smoke"], {
    encoding: "utf-8",
    timeout: 30_000,
  });
  return {
    code: out.status,
    stdout: out.stdout ?? "",
    stderr: out.stderr ?? "",
    elapsed: Date.now() - start,
  };
}

// ── Preflight ───────────────────────────────────────────────────────────
function preflight() {
  header("PREFLIGHT");
  if (!existsSync(MCP_DIST)) {
    fail("preflight", `MCP dist not built at ${MCP_DIST}. Run: cd mcp && npm run build`);
    return false;
  }
  info(`MCP dist at ${MCP_DIST}`);
  const apiKey = readApiKey();
  if (!apiKey) {
    fail("preflight", "no API key in ~/.synapse/config.json — doctor --smoke needs auth");
    return false;
  }
  info(`API key resolved (${apiKey.slice(0, 8)}…)`);
  ok("preflight", "all prereqs satisfied");
  return apiKey;
}

// ── S1: Happy path ──────────────────────────────────────────────────────
function s1_happy_path() {
  header("S1 · `doctor --smoke` happy path");
  const r = runSmokeOnce();

  if (r.code !== 0) {
    fail("S1.1 exit code", `expected 0, got ${r.code}. stderr: ${r.stderr.slice(0, 300)}`);
    info("--- stdout (last 1500 chars) ---");
    info(r.stdout.slice(-1500));
    return false;
  }
  ok("S1.1 exit code", `exit 0 in ${r.elapsed}ms`);

  // Parse the 5 stage markers. The smoke prints `✓ 1. Hooks installed…`
  // etc. We match each expected stage's number + name.
  const EXPECTED = [
    { n: 1, name: "Hooks installed" },
    { n: 2, name: "API key valid" },
    { n: 3, name: "Event roundtrip" },
    { n: 4, name: "Project list readable" },
    { n: 5, name: "Self-cleanup" },
  ];

  let allPresent = true;
  for (const { n, name } of EXPECTED) {
    // Match `✓ <n>. <name>` — survives whitespace/elapsedMs variation
    const re = new RegExp(`✓\\s+${n}\\.\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`);
    if (re.test(r.stdout)) {
      ok(`S1.${n + 1} stage ${n} (${name})`, "reported ✓");
    } else {
      fail(`S1.${n + 1} stage ${n} (${name})`, "missing ✓ marker in output");
      allPresent = false;
    }
  }

  if (!r.stdout.includes("Install verified")) {
    fail("S1.7 verdict line", "missing 'Install verified' summary");
    allPresent = false;
  } else {
    ok("S1.7 verdict line", "summary 'Install verified' present");
  }

  return allPresent;
}

// ── S2: Idempotency ─────────────────────────────────────────────────────
function s2_idempotency() {
  header("S2 · Second run immediately — no residue from S1");
  const r = runSmokeOnce();
  if (r.code !== 0) {
    fail("S2.1 exit code", `expected 0, got ${r.code}. stderr: ${r.stderr.slice(0, 300)}`);
    return false;
  }
  ok("S2.1 exit code", `exit 0 in ${r.elapsed}ms — back-to-back runs both pass`);
  return true;
}

// ── S3: Zero-leak proof ─────────────────────────────────────────────────
// The bug class: a smoke that cleans up at end-of-run but leaks via the
// daemon-outlives-test race (events.jsonl retried minutes later, backend
// auto-creates a fresh project). The smoke's cleanup is supposed to nuke
// the daemon's local state for the synthetic basename — this stage proves
// that's working by polling the account 60s after the smoke exits.
async function s3_zero_leak(apiKey) {
  header("S3 · Zero-leak proof — account count stable post-smoke");

  let before;
  try {
    before = await listProjectCount(apiKey);
  } catch (e) {
    fail("S3.0 baseline list", e.message);
    return false;
  }
  info(`baseline: ${before} project(s)`);

  const r = runSmokeOnce();
  if (r.code !== 0) {
    fail("S3.1 smoke run", `smoke failed unexpectedly (exit ${r.code})`);
    return false;
  }

  let immediate;
  try {
    immediate = await listProjectCount(apiKey);
  } catch (e) {
    fail("S3.2 immediate count", e.message);
    return false;
  }
  if (immediate !== before) {
    fail("S3.2 immediate count", `expected ${before}, got ${immediate} immediately after smoke — cleanup step failed`);
    return false;
  }
  ok("S3.2 immediate count", `${immediate} === baseline ${before}`);

  // The race window: daemon flushes can happen up to ~30s+ after the
  // process that wrote the events exits. 60s is enough headroom for the
  // typical batch interval; if a leak surfaces this would catch it.
  info("waiting 60s for daemon race window to close…");
  await new Promise((r) => setTimeout(r, 60_000));

  let settled;
  try {
    settled = await listProjectCount(apiKey);
  } catch (e) {
    fail("S3.3 post-settle count", e.message);
    return false;
  }
  if (settled !== before) {
    fail("S3.3 post-settle count", `expected ${before}, got ${settled} after 60s — daemon-outlives-test leak detected`);
    return false;
  }
  ok("S3.3 post-settle count", `${settled} === baseline ${before} after 60s settle — no late leak`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse doctor --smoke E2E test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);

  const apiKey = preflight();
  if (!apiKey) process.exit(2);

  try {
    s1_happy_path();
    s2_idempotency();
    await s3_zero_leak(apiKey);
  } catch (err) {
    log(`\n🚨 UNCAUGHT IN SUITE: ${err.message}\n${err.stack}`);
    results.push({ id: "uncaught", status: "FAIL", detail: err.message });
  }

  header("SUMMARY");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    log(`  ${icon} ${r.id.padEnd(35)} ${r.detail}`);
  }
  log("");
  log(`  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}`);
  log("");
  if (failed > 0) {
    log("❌ E2E SMOKE FAILED.");
    process.exit(1);
  } else {
    log("✅ E2E SMOKE PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
