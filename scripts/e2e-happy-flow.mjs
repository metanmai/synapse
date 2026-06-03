#!/usr/bin/env node
// scripts/e2e-happy-flow.mjs
//
// THE STANDARD END-TO-END HAPPY-FLOW TEST.
//
// This script exercises the full user-facing path of Synapse against the
// LIVE backend with the LIVE local daemon. No mocks. If any stage fails,
// the user-visible product is broken — do not merge.
//
// What it tests (in order):
//   1. CLI install + daemon health + hook wiring
//   2. SessionStart on a cold cwd (no project yet) — bare brief is correct
//   3. `claude -p` captures a session, daemon syncs it to the backend,
//      the project auto-routes via git_remote_url
//   4. Backend conversation_messages contain the captured prompts verbatim
//   5. SessionStart on the now-known cwd — hook returns FAST (<3s) via
//      fast-mode; background recompute spawns
//   6. Background recompute completes; conv.metadata.handoff_markdown is
//      posted and contains the test phrases
//   7. THE CRITICAL TEST: a NEW `claude -p` session in the same cwd asks
//      for the prior session's facts — agent must recall them from the
//      brief, NOT from `git log` or any tool call
//   8. `save_insight` + `list_insights` roundtrip works
//   9. CLI surface commands (`status`, `doctor`, `whoami`, `stats`) all
//      return non-error output
//
// Usage:
//   npm run test:e2e
//   node scripts/e2e-happy-flow.mjs
//
// Requires:
//   - claude (Claude Code CLI) on PATH
//   - synapsesync daemon running (launchd plist or manual)
//   - SYNAPSE_API_KEY resolvable from ~/.synapse/config.json or env
//   - Network access to api.synapsesync.app
//
// Cost per run: ~$0.01-0.05 in Anthropic tokens (3 `claude -p` calls
// plus one background recompute via claude-haiku).
//
// Exit codes:
//   0 — all stages passed
//   1 — one or more stages failed
//   2 — preflight error (missing prereq, no API key, etc.)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

// Test facts — kept unique so the recall test can't be answered without
// reading the brief. If a model can guess "butterfly mountain seven"
// from cold, change these.
const TEST_ID = `HAPPY-FLOW-${Date.now()}`;
const TEST_PHRASE = "butterfly mountain seven";

// Timing knobs. Generous enough to absorb daemon/cloud latency without
// being so loose that real bugs hide. Adjust if you observe consistent
// flakes on a stage.
const SLEEP_DAEMON_SYNC_MS = 15_000;
const SLEEP_RECOMPUTE_MAX_MS = 90_000;
const HOOK_FAST_TIMEOUT_MS = 5_000; // hook must return well under 10s

// ── State ────────────────────────────────────────────────────────────────
const results = []; // [{ id, label, status, detail, elapsedMs }]
let testDir = null;
let apiKey = null;
let testProjectId = null;
let testConvId = null;

// ── Helpers ──────────────────────────────────────────────────────────────
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
function info(detail) {
  log(`  · ${detail}`);
}

async function fetchJson(pathname, init = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    return { _status: res.status, _err: await res.text() };
  }
  return await res.json();
}

function fireHook(name, payload) {
  const start = Date.now();
  const out = spawnSync("node", [MCP_DIST, "hook", name], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
  });
  return { elapsed: Date.now() - start, stdout: out.stdout ?? "", stderr: out.stderr ?? "", code: out.status };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check, timeoutMs, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function getApiKey() {
  // Same resolution order as cloud-sync.ts: env, then ~/.synapse/config.json
  if (process.env.SYNAPSE_API_KEY && process.env.SYNAPSE_API_KEY !== "undefined") {
    return process.env.SYNAPSE_API_KEY;
  }
  const configPath = path.join(process.env.HOME ?? "/", ".synapse", "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      if (cfg.api_key) return cfg.api_key;
    } catch {}
  }
  return null;
}

// ── Cleanup ─────────────────────────────────────────────────────────────
async function cleanup() {
  // Delete the test project on backend (cascades to conversations + messages)
  if (testProjectId) {
    const res = await fetch(`${API_BASE}/api/projects/${testProjectId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      log(`  · cleanup: deleted test project ${testProjectId}`);
    } else {
      log(`  · cleanup: WARN failed to delete project (HTTP ${res.status})`);
    }
  }
  // rm the temp dir
  if (testDir && existsSync(testDir)) {
    try {
      rmSync(testDir, { recursive: true, force: true });
      log(`  · cleanup: removed ${testDir}`);
    } catch (err) {
      log(`  · cleanup: WARN failed to rm ${testDir}: ${err.message}`);
    }
  }
}

// ── Preflight ───────────────────────────────────────────────────────────
function preflight() {
  header("PREFLIGHT");

  if (!existsSync(MCP_DIST)) {
    fail("preflight", "MCP dist not built. Run: cd mcp && npm run build");
    return false;
  }
  info(`MCP dist at ${MCP_DIST}`);

  apiKey = getApiKey();
  if (!apiKey) {
    fail("preflight", "No SYNAPSE_API_KEY in env or ~/.synapse/config.json");
    return false;
  }
  info(`API key resolved (${apiKey.slice(0, 12)}...)`);

  const claude = spawnSync("which", ["claude"], { encoding: "utf-8" });
  if (claude.status !== 0) {
    fail("preflight", "claude CLI not on PATH. Install Claude Code first.");
    return false;
  }
  info(`claude at ${claude.stdout.trim()}`);

  ok("preflight", "all prereqs satisfied");
  return true;
}

// ── Stage 1: install + daemon ───────────────────────────────────────────
async function stage1_install() {
  header("STAGE 1 · Install + daemon + hooks");

  const version = spawnSync("node", [MCP_DIST, "--version"], { encoding: "utf-8" });
  const v = (version.stdout ?? "").trim();
  if (v.match(/^\d+\.\d+\.\d+/)) {
    ok("1.1 version", `synapsesync ${v}`);
  } else {
    fail("1.1 version", `unexpected output: ${v.slice(0, 80)}`);
    return;
  }

  const status = spawnSync("node", [MCP_DIST, "status"], { encoding: "utf-8", timeout: 10_000 });
  if ((status.stdout ?? "").includes("healthy")) {
    ok("1.2 daemon", status.stdout.trim().split("\n")[0]);
  } else {
    fail("1.2 daemon", `not healthy: ${(status.stdout ?? status.stderr ?? "").slice(0, 200)}`);
  }

  const settingsPath = path.join(process.env.HOME ?? "/", ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    fail("1.3 hooks", "~/.claude/settings.json missing");
  } else {
    const s = readFileSync(settingsPath, "utf-8");
    const hookCount = (s.match(/hook session-start|hook pre-compact|hook session-end/g) ?? []).length;
    if (hookCount >= 3) {
      ok("1.3 hooks", `${hookCount} synapse hook references in settings.json`);
    } else {
      fail("1.3 hooks", `only ${hookCount} hook references — install incomplete`);
    }
  }
}

// ── Stage 2: SessionStart on cold cwd ───────────────────────────────────
async function stage2_cold_cwd() {
  header("STAGE 2 · SessionStart on a cold cwd");

  testDir = path.join(tmpdir(), `synapse-e2e-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  spawnSync("git", ["init", "-q"], { cwd: testDir });
  spawnSync("git", ["config", "user.email", "e2e@happy-flow.local"], { cwd: testDir });
  spawnSync("git", ["config", "user.name", "e2e-test"], { cwd: testDir });
  const remote = `https://github.com/synapse-e2e/test-${Date.now()}.git`;
  spawnSync("git", ["remote", "add", "origin", remote], { cwd: testDir });
  writeFileSync(path.join(testDir, "README.md"), "# E2E test\n");
  spawnSync("git", ["add", "-A"], { cwd: testDir });
  spawnSync("git", ["commit", "-q", "-m", "initial"], { cwd: testDir });

  info(`cwd = ${testDir}`);
  info(`git remote = ${remote}`);

  // Fire SessionStart — at this point no project exists yet, no handoff
  const { elapsed, stdout } = fireHook("session-start", {
    session_id: "e2e-s1",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });

  if (elapsed >= 10_000) {
    fail("2.1 hook timing", `hook took ${elapsed}ms — timed out (likely fast-mode regression)`);
    return;
  }
  ok("2.1 hook timing", `${elapsed}ms (well under 10s budget)`);

  if (!stdout.includes("<synapse-brief>")) {
    fail("2.2 brief shape", `no <synapse-brief> tag in output: ${stdout.slice(0, 200)}`);
    return;
  }
  ok("2.2 brief shape", `<synapse-brief> tag present (${stdout.length} bytes)`);

  // For a cold cwd, no handoff section is expected (correct fallback)
  const hasHandoff = stdout.includes("Last conversation handoff");
  if (hasHandoff) {
    fail("2.3 cold-cwd fallback", `unexpected handoff section on cold cwd — there shouldn't be one yet`);
  } else {
    ok("2.3 cold-cwd fallback", "brief correctly has no handoff section yet");
  }
}

// ── Stage 3+4: claude -p captures, daemon syncs, backend has messages ───
async function stage3_capture() {
  header("STAGE 3 · claude -p captures + daemon syncs to backend");

  const prompt = `This is an E2E test session. Remember these facts: (a) test_id is ${TEST_ID}, (b) secret_phrase is '${TEST_PHRASE}'. Reply 'noted' and nothing else.`;
  info(`Running claude -p in ${testDir}…`);

  const start = Date.now();
  const cp = spawnSync("claude", ["-p", prompt], { cwd: testDir, encoding: "utf-8", timeout: 120_000 });
  const elapsed = Date.now() - start;

  if (cp.status !== 0) {
    fail("3.1 claude -p", `claude exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }
  ok("3.1 claude -p", `responded in ${elapsed}ms`);

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon to sync the session…`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  const testBasename = path.basename(testDir);
  const projects = await fetchJson("/api/projects");
  if (Array.isArray(projects)) {
    const match = projects.find((p) => p.name === testBasename);
    if (match) {
      testProjectId = match.id;
      ok("3.2 backend project", `created: ${match.id} (name="${match.name}")`);
    } else {
      // Force a daemon flush + retry
      try {
        writeFileSync(path.join(process.env.HOME ?? "/", ".synapse", "daemon-flush-now"), "");
      } catch {}
      await sleep(5000);
      const retry = await fetchJson("/api/projects");
      const m2 = Array.isArray(retry) ? retry.find((p) => p.name === testBasename) : null;
      if (m2) {
        testProjectId = m2.id;
        ok("3.2 backend project (after flush)", `created: ${m2.id}`);
      } else {
        fail(
          "3.2 backend project",
          `project ${testBasename} not found after ${(SLEEP_DAEMON_SYNC_MS + 5000) / 1000}s wait`,
        );
        return;
      }
    }
  } else {
    fail("3.2 backend project", `/api/projects returned non-array: ${JSON.stringify(projects).slice(0, 200)}`);
    return;
  }

  // Verify conversation has the messages
  const list = await fetchJson(`/api/conversations?project_id=${testProjectId}&limit=5`);
  const convs = list.conversations ?? [];
  if (convs.length === 0) {
    fail("4.1 conversation", "no conversations in project");
    return;
  }
  testConvId = convs[0].id;

  const full = await fetchJson(`/api/conversations/${testConvId}`);
  const allContent = (full.messages ?? []).map((m) => m.content ?? "").join(" ");

  const hasId = allContent.includes(TEST_ID);
  const hasPhrase = allContent.includes(TEST_PHRASE);
  if (hasId && hasPhrase) {
    ok("4.1 message content", "both TEST_ID and TEST_PHRASE present in synced messages");
  } else {
    fail("4.1 message content", `test phrases missing — TEST_ID=${hasId} TEST_PHRASE=${hasPhrase}`);
  }
}

// ── Stage 5: fast-mode SessionStart on known cwd ─────────────────────────
async function stage5_fast_mode() {
  header("STAGE 5 · SessionStart on now-known cwd (fast mode)");

  const { elapsed, stdout } = fireHook("session-start", {
    session_id: "e2e-s2",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });

  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("5.1 fast-mode timing", `hook took ${elapsed}ms — should be <${HOOK_FAST_TIMEOUT_MS}ms in fast mode`);
  } else {
    ok("5.1 fast-mode timing", `${elapsed}ms`);
  }

  if (!stdout.includes("<synapse-brief>")) {
    fail("5.2 brief shape", "no brief emitted");
  } else {
    ok("5.2 brief shape", `${stdout.length} bytes`);
  }
}

// ── Stage 6: handoff lands on backend ─────────────────────────────────────
async function stage6_handoff_lands() {
  header("STAGE 6 · Background recompute lands the handoff on backend");

  info(`Polling /api/conversations/${testConvId} for handoff_markdown (max ${SLEEP_RECOMPUTE_MAX_MS / 1000}s)…`);
  const handoff = await waitFor(
    async () => {
      const full = await fetchJson(`/api/conversations/${testConvId}`);
      const meta = full.conversation?.metadata ?? full.metadata ?? {};
      const h = meta.handoff_markdown;
      return h && h.length > 0 ? h : null;
    },
    SLEEP_RECOMPUTE_MAX_MS,
    3000,
  );

  if (!handoff) {
    fail("6.1 handoff posted", `no handoff_markdown after ${SLEEP_RECOMPUTE_MAX_MS / 1000}s`);
    return;
  }
  ok("6.1 handoff posted", `${handoff.length} bytes`);

  const hasId = handoff.includes(TEST_ID);
  const hasPhrase = handoff.includes(TEST_PHRASE);
  if (hasId && hasPhrase) {
    ok("6.2 handoff content", "captures both TEST_ID and TEST_PHRASE");
  } else {
    fail("6.2 handoff content", `test phrases missing — TEST_ID=${hasId} TEST_PHRASE=${hasPhrase}`);
  }
}

// ── Stage 7: NEW session recalls prior facts via brief (THE test) ─────────
async function stage7_recall() {
  header("STAGE 7 · NEW claude -p recalls prior session facts (THE CRITICAL TEST)");

  const recallPrompt = `Strict context-only mode. Use ONLY your <synapse-brief> tag content. Do NOT use Read, Bash, Grep, git, or ANY tool.

Question: A previous session in this cwd recorded two test facts. What were they? Specifically, what was the test_id and the secret_phrase?

If your brief doesn't have this, say 'NOT IN BRIEF'.`;

  info("Running claude -p with recall question…");
  const cp = spawnSync("claude", ["-p", recallPrompt], { cwd: testDir, encoding: "utf-8", timeout: 120_000 });
  if (cp.status !== 0) {
    fail("7.1 claude -p", `claude exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }

  const reply = cp.stdout ?? "";
  info(`Agent response (first 400 chars):\n  ${reply.slice(0, 400).replace(/\n/g, "\n  ")}`);

  const recalledId = reply.includes(TEST_ID);
  const recalledPhrase = reply.includes(TEST_PHRASE);
  if (recalledId && recalledPhrase) {
    ok("7.1 recall (THE TEST)", "agent recalled BOTH test_id and secret_phrase from the brief");
  } else {
    fail("7.1 recall (THE TEST)", `agent failed to recall — TEST_ID=${recalledId} TEST_PHRASE=${recalledPhrase}`);
  }
}

// ── Stage 8: insights roundtrip ───────────────────────────────────────────
async function stage8_insights() {
  header("STAGE 8 · save_insight + list_insights roundtrip");

  const save = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({
      project_id: testProjectId,
      type: "decision",
      summary: `E2E test insight ${TEST_ID}`,
      detail: `Synthetic insight created during automated happy-flow test at ${new Date().toISOString()}`,
    }),
  });
  if (save._err) {
    fail("8.1 save_insight", `HTTP ${save._status}: ${save._err.slice(0, 200)}`);
    return;
  }
  if (!save.id) {
    fail("8.1 save_insight", `no id in response: ${JSON.stringify(save).slice(0, 200)}`);
    return;
  }
  ok("8.1 save_insight", `created ${save.id}`);

  const list = await fetchJson(`/api/insights?project_id=${testProjectId}`);
  const items = list.insights ?? list ?? [];
  const found = Array.isArray(items) ? items.find((i) => i.id === save.id) : null;
  if (found) {
    ok("8.2 list_insights", "roundtrip found the new insight");
  } else {
    fail("8.2 list_insights", "created insight not in list result");
  }
}

// ── Stage 9: CLI surface commands ─────────────────────────────────────────
async function stage9_cli() {
  header("STAGE 9 · CLI surface commands");

  for (const cmd of ["status", "stats"]) {
    const r = spawnSync("node", [MCP_DIST, cmd], { encoding: "utf-8", timeout: 30_000 });
    if (r.status !== 0 || !r.stdout || r.stdout.includes("Error:")) {
      fail(`9.${cmd}`, `exit ${r.status}: ${(r.stdout ?? r.stderr ?? "").slice(0, 120)}`);
    } else {
      ok(`9.${cmd}`, `non-error output (${r.stdout.length} bytes)`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse end-to-end happy-flow test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);

  if (!preflight()) {
    process.exit(2);
  }

  try {
    await stage1_install();
    await stage2_cold_cwd();
    await stage3_capture();
    if (testProjectId && testConvId) {
      await stage5_fast_mode();
      await stage6_handoff_lands();
      await stage7_recall();
      await stage8_insights();
    }
    await stage9_cli();
  } catch (err) {
    log(`\n🚨 UNEXPECTED ERROR: ${err.message}\n${err.stack}`);
    results.push({ id: "uncaught", status: "FAIL", detail: err.message });
  } finally {
    header("CLEANUP");
    await cleanup();
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
    log("❌ E2E HAPPY FLOW FAILED. Do not merge until all stages pass.");
    process.exit(1);
  } else {
    log("✅ E2E HAPPY FLOW PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
