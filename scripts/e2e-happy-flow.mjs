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
//   3. The universal LLM driver (curl + Anthropic API via Synapse proxy)
//      captures a session, daemon syncs it to the backend, the project
//      auto-routes via git_remote_url. Harness-agnostic — no Claude Code
//      required; runs identically on macOS, Linux, Windows.
//   4. Backend conversation_messages contain the captured prompts verbatim
//   5. SessionStart on the now-known cwd — hook returns FAST (<3s) via
//      fast-mode; background recompute spawns
//   6. Background recompute completes; conv.metadata.handoff_markdown is
//      posted and contains the test phrases
//   7. CRITICAL RECALL TEST (universal): fires the SessionStart hook to
//      get the brief content, feeds it into the universal LLM driver,
//      asks for the prior session's facts. Agent must recall them from
//      the brief, NOT from `git log` or any tool call. Runs on any OS
//      via direct-API (curl + ANTHROPIC_API_KEY) or any CLI driver
//      (claude/crush/etc via SYNAPSE_E2E_DRIVER). No soft-skip — same
//      LLM driver Stage 3 uses.
//   7b. CRITICAL CONTENT TEST (universal, no LLM): fires the SessionStart
//      hook and asserts the resulting <synapse-brief> tag contains the
//      test phrases. Fast deterministic check; complements Stage 7 by
//      isolating brief-generation correctness from LLM behavior.
//   8. `save_insight` + `list_insights` roundtrip works
//   9. CLI surface commands (`status`, `stats`) all return non-error
//
// Usage:
//   npm run test:e2e
//   node scripts/e2e-happy-flow.mjs
//
// Requires:
//   - curl on PATH (ships natively on macOS, Linux, Windows 10+)
//   - Stage 3 LLM driver: EITHER ANTHROPIC_API_KEY in env (direct-API
//     mode) OR an AI CLI on PATH like `claude` or `crush` (CLI-driver
//     mode; override the default `claude -p` via SYNAPSE_E2E_DRIVER env
//     var, e.g. `SYNAPSE_E2E_DRIVER="crush run"`).
//   - Synapse proxy installed + enabled (~/.synapse/proxy/ca.pem present)
//   - synapsesync daemon running (launchd / systemd / Task Scheduler)
//   - SYNAPSE_API_KEY resolvable from ~/.synapse/config.json or env
//   - Network access to api.synapsesync.app + api.anthropic.com
//
// Cost per run: ~$0.02-0.10 in Anthropic tokens (2 driver-driven Anthropic
// calls — Stage 3 capture + Stage 7 recall — plus 1 server-side recompute
// via claude-haiku).
//
// Exit codes:
//   0 — all stages passed
//   1 — one or more stages failed
//   2 — preflight error (missing prereq, no API key, etc.)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeLocalProjectState, removeLocalProjectsByBasename, sweepArtifacts } from "./e2e-cleanup.mjs";
import { generateSession } from "./e2e-llm-driver.mjs";

// E2E tests run in mkdtemp dirs (`os.tmpdir()` → /var/folders on macOS,
// /tmp on Linux). The daemon's `shouldSkipDispatch` predicate normally
// drops those paths to keep ephemeral cwds out of the user's dashboard.
// Tests are LEGITIMATE uses of tmp paths that DO want capture — they
// set `SYNAPSE_DISPATCH_FORCE_ALLOW=1` so the predicate's force-allow
// override fires, all subprocess spawns inherit it via process.env.
process.env.SYNAPSE_DISPATCH_FORCE_ALLOW = "1";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

// Single per-run timestamp embedded in TEST_ID, testDir, and the synthetic
// git remote — so cleanup can sweep every artifact by matching `-${RUN_ID}`.
// Was Date.now() inline at every use site; that made it impossible to find
// all this-run's projects from cleanup without tracking each one explicitly.
const RUN_ID = Date.now();
// Test facts — kept unique so the recall test can't be answered without
// reading the brief. If a model can guess "butterfly mountain seven"
// from cold, change these.
const TEST_ID = `HAPPY-FLOW-${RUN_ID}`;
const TEST_PHRASE = "butterfly mountain seven";

// Timing knobs. Generous enough to absorb daemon/cloud latency without
// being so loose that real bugs hide. Adjust if you observe consistent
// flakes on a stage.
// Backend-side handoff recompute polled below. On a fast network the brief
// usually lands within ~30s; on a slow / proxied network the upstream
// message-sync that triggers recompute can lag minutes, so we share the
// same 8-min budget as the project / conversation arrival polls.
const SLEEP_RECOMPUTE_MAX_MS = 8 * 60_000;
// Hook fast-mode budget. Linux/macOS runners hit this comfortably (~600ms
// observed). Windows GitHub Actions runners are systematically ~50% slower
// for filesystem + process-spawn work (NTFS overhead, Defender real-time
// scan, slower CreateProcess) — a 6420ms reading on metanmai run
// 27117823971 tripped the 5s budget despite no code regression. Bumping
// to 7500ms on Windows preserves regression-detection (anything >>7500ms
// is still a real problem) while tolerating the OS-level overhead.
const HOOK_FAST_TIMEOUT_MS = process.platform === "win32" ? 7_500 : 5_000;
// Backend-arrival poll budget for sync-bound assertions (project + conversation).
// On the happy-path / fast network these resolve in seconds; on slow / proxied
// networks the daemon's events-batch + capture-sync paths can lag minutes
// because their cycle backs off on transient fetch errors. Polling with a
// flush-now nudge every 30s lets the test ride out either condition without
// turning sync timing into a phantom regression.
const POLL_BACKEND_MAX_MS = 8 * 60_000;
const POLL_BACKEND_INTERVAL_MS = 10_000;
const POLL_BACKEND_FLUSH_INTERVAL_MS = 30_000;

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
    // Remove daemon's local state for this project so it stops retrying
    // queued events that would otherwise auto-recreate the project on
    // the backend (different UUID, same name from git_remote_url).
    removeLocalProjectState(testProjectId, { log });
  }
  // Also remove any cwd_<hash> PLACEHOLDER dirs that the daemon wrote BEFORE
  // backend assigned canonical UUIDs. testProjectId only knows the canonical
  // one; placeholders linger in ~/.synapse/projects/cwd_* with the test's
  // events.jsonl, and the daemon retries them post-cleanup → backend creates
  // a fresh project (same name, new UUID) → silent leak hours later.
  removeLocalProjectsByBasename(`synapse-e2e-${RUN_ID}`, { log });
  // Belt-and-suspenders sweep: the auto-router can land additional projects
  // during stage 3 if the remote URL parses ambiguously; this catches them.
  await sweepArtifacts({
    apiKey,
    apiUrl: API_BASE,
    patterns: [`-${RUN_ID}`],
    log,
  });
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

  // Universal driver (curl + Synapse proxy) — see scripts/e2e-llm-driver.mjs.
  // Replaces the previous `claude -p` requirement so this test runs on Linux
  // and Windows, not just macOS.
  const curl = spawnSync(process.platform === "win32" ? "where" : "which", ["curl"], { encoding: "utf-8" });
  if (curl.status !== 0) {
    fail(
      "preflight",
      "curl not on PATH (required by harness-agnostic LLM driver — ships natively on macOS, Linux, Windows 10+)",
    );
    return false;
  }
  info(`curl at ${curl.stdout.trim().split("\n")[0]}`);

  // Driver selection: check for any direct-API key (ANTHROPIC, OPENROUTER,
  // DEEPSEEK) first; fall back to CLI-driver mode. Direct-API mode is
  // preferred because it works without any AI CLI installed — truly
  // portable across macOS, Linux, Windows.
  const directKeys = [
    { env: "ANTHROPIC_API_KEY", label: "Anthropic" },
    { env: "OPENROUTER_API_KEY", label: "OpenRouter" },
    { env: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  ].filter((k) => process.env[k.env]);

  if (directKeys.length > 0) {
    info(
      `${directKeys.map((k) => k.env).join(" / ")} present — Stage 3 will use direct-API mode (${directKeys.map((k) => k.label).join(" → ")})`,
    );
  } else {
    const driverCmd = process.env.SYNAPSE_E2E_DRIVER ?? "claude -p";
    const driverBin = driverCmd.trim().split(/\s+/)[0];
    const whichDriver = spawnSync(process.platform === "win32" ? "where" : "which", [driverBin], { encoding: "utf-8" });
    if (whichDriver.status !== 0) {
      fail(
        "preflight",
        `no LLM driver available — no direct-API key set (ANTHROPIC_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY) AND "${driverBin}" not on PATH. Either set one of the API key env vars (direct-API mode) or install an AI CLI (claude, crush, etc.) and set SYNAPSE_E2E_DRIVER if not "claude -p".`,
      );
      return false;
    }
    info(`Stage 3 will use CLI-driver mode: "${driverCmd}" (binary at ${whichDriver.stdout.trim().split("\n")[0]})`);
  }

  const caPath = path.join(process.env.HOME ?? "/", ".synapse", "proxy", "ca.pem");
  if (!existsSync(caPath)) {
    fail(
      "preflight",
      `Synapse proxy CA not found at ${caPath}. Run: synapsesync capture proxy install && synapsesync capture proxy enable`,
    );
    return false;
  }
  info(`Synapse proxy CA at ${caPath}`);

  // Verify the daemon's proxy is currently enabled (config-file driven).
  const proxyStatus = spawnSync("node", [MCP_DIST, "capture", "proxy", "status"], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (
    !(proxyStatus.stdout ?? "").includes("Enabled") ||
    !(proxyStatus.stdout ?? "").match(/Enabled\s+(on|true|yes)/i)
  ) {
    info("Proxy not enabled — enabling now so Stage 3 can capture via the universal path");
    const enable = spawnSync("node", [MCP_DIST, "capture", "proxy", "enable"], { encoding: "utf-8", timeout: 15_000 });
    if (enable.status !== 0) {
      fail("preflight", `failed to enable proxy: ${(enable.stderr ?? enable.stdout ?? "").slice(0, 200)}`);
      return false;
    }
    info("Proxy enabled");
  } else {
    info("Proxy already enabled");
  }

  ok("preflight", "all prereqs satisfied (curl + LLM driver + proxy CA + proxy enabled)");
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

  testDir = path.join(tmpdir(), `synapse-e2e-${RUN_ID}`);
  mkdirSync(testDir, { recursive: true });

  spawnSync("git", ["init", "-q"], { cwd: testDir });
  spawnSync("git", ["config", "user.email", "e2e@happy-flow.local"], { cwd: testDir });
  spawnSync("git", ["config", "user.name", "e2e-test"], { cwd: testDir });
  const remote = `https://github.com/synapse-e2e/test-${RUN_ID}.git`;
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

// ── Stage 3+4: universal LLM call captures via proxy, daemon syncs ──────
async function stage3_capture() {
  header("STAGE 3 · universal LLM driver captures + daemon syncs to backend");

  const prompt = `This is an E2E test session. Remember these facts: (a) test_id is ${TEST_ID}, (b) secret_phrase is '${TEST_PHRASE}'. Reply 'noted' and nothing else.`;
  info(`Calling api.anthropic.com via Synapse proxy from ${testDir}…`);

  // generateSession() auto-selects direct-API mode (curl + ANTHROPIC_API_KEY)
  // OR CLI-driver mode (claude -p / crush / etc. with HTTPS_PROXY env).
  // Either path's HTTPS call is captured by the Synapse proxy; the daemon
  // syncs the resulting session to backend. Same downstream as a real client.
  // Replaces the prior `spawnSync("claude", ["-p", prompt])` invocation,
  // which only worked on macOS because Linux/WSL2 doesn't persist session
  // files. Universal: works wherever EITHER an API key OR an AI CLI exists.
  let driverResult;
  try {
    driverResult = generateSession({
      prompt,
      // User-Agent only fires in direct-API mode; CLI mode uses whatever
      // UA the CLI sends. Either way the proxy's classifier handles it.
      userAgent: "claude-cli/e2e-driver synapse-e2e",
      cwd: testDir, // CLI-driver mode runs in the test cwd
      timeoutMs: 120_000,
    });
  } catch (e) {
    fail("3.1 universal driver", e.message);
    return;
  }
  ok(
    "3.1 universal driver",
    `mode=${driverResult.mode} driver=${driverResult.driver} responded in ${driverResult.elapsedMs}ms`,
  );

  // Poll up to POLL_BACKEND_MAX_MS for the project to land on backend. The
  // daemon pushes events-batch on its cycle loop; on a fast network this is
  // sub-second, on a slow/proxied network it can take several minutes because
  // fetch errors push the cycle into backoff. We nudge the cycle with a
  // flush-now signal every POLL_BACKEND_FLUSH_INTERVAL_MS so we don't sit
  // through a long backoff window unnecessarily.
  info(`Polling backend for project (up to ${POLL_BACKEND_MAX_MS / 1000}s, with periodic flush nudges)…`);
  const testBasename = path.basename(testDir);
  const flushPath = path.join(process.env.HOME ?? "/", ".synapse", "daemon-flush-now");
  const matchedProject = await pollBackend({
    label: `project name="${testBasename}"`,
    flushPath,
    fetch: async () => {
      const projects = await fetchJson("/api/projects?limit=200");
      if (!Array.isArray(projects)) return null;
      return projects.find((p) => p.name === testBasename) ?? null;
    },
  });
  if (matchedProject) {
    testProjectId = matchedProject.id;
    ok("3.2 backend project", `created: ${matchedProject.id} (name="${matchedProject.name}")`);
  } else {
    fail("3.2 backend project", `project ${testBasename} not found after ${POLL_BACKEND_MAX_MS / 1000}s wait`);
    return;
  }

  // Verify conversation has the messages. Same polling shape as the project
  // check — capture-watcher's idle window can also push this many seconds out.
  const conv = await pollBackend({
    label: `conversation under project ${testProjectId}`,
    flushPath,
    fetch: async () => {
      const list = await fetchJson(`/api/conversations?project_id=${testProjectId}&limit=5`);
      const convs = list?.conversations ?? [];
      return convs[0] ?? null;
    },
  });
  if (!conv) {
    fail("4.1 conversation", `no conversations in project ${testProjectId} after ${POLL_BACKEND_MAX_MS / 1000}s`);
    return;
  }
  testConvId = conv.id;

  // Final assertion: the test prompt's secrets actually rode the proxy →
  // daemon → backend pipeline. Poll the full conversation body until the
  // messages contain both phrases (the append-messages call can lag the
  // create-conversation by a beat on slow networks).
  const matchedContent = await pollBackend({
    label: "messages with TEST_ID + TEST_PHRASE",
    flushPath,
    fetch: async () => {
      const full = await fetchJson(`/api/conversations/${testConvId}`);
      const all = (full?.messages ?? []).map((m) => m.content ?? "").join(" ");
      return all.includes(TEST_ID) && all.includes(TEST_PHRASE) ? all : null;
    },
  });
  if (matchedContent) {
    ok("4.1 message content", "both TEST_ID and TEST_PHRASE present in synced messages");
  } else {
    fail(
      "4.1 message content",
      `test phrases missing after ${POLL_BACKEND_MAX_MS / 1000}s — TEST_ID + TEST_PHRASE never reached backend`,
    );
  }
}

/**
 * Generic backend poll with periodic flush-now nudges. `fetch()` is called on
 * each tick; the first non-null return wins. Returns null on timeout. Keeps
 * the noisy "I'm still waiting" line live so the test doesn't look hung.
 */
async function pollBackend({ label, flushPath, fetch }) {
  const start = Date.now();
  let nextFlushAt = 0;
  let lastError = null;
  while (Date.now() - start < POLL_BACKEND_MAX_MS) {
    if (Date.now() >= nextFlushAt) {
      try {
        writeFileSync(flushPath, "");
      } catch {}
      nextFlushAt = Date.now() + POLL_BACKEND_FLUSH_INTERVAL_MS;
    }
    try {
      const result = await fetch();
      if (result) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        info(`  ✓ ${label} found after ${elapsed}s`);
        return result;
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(POLL_BACKEND_INTERVAL_MS);
  }
  const elapsed = Math.round((Date.now() - start) / 1000);
  info(`  ✗ ${label} not found after ${elapsed}s${lastError ? ` (last error: ${lastError.message})` : ""}`);
  return null;
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

// ── Stage 7: NEW session recalls prior facts via brief (universal) ────────
//
// This stage tests the recall property: an agent given the brief can use
// it to answer questions about prior sessions. To stay agent-agnostic
// we drive it via the universal LLM driver — the same one Stage 3 uses
// (direct-API curl OR a configurable CLI harness via SYNAPSE_E2E_DRIVER).
// We fire the SessionStart hook ourselves to get the brief content, then
// inject it into the prompt. This decouples the recall test from any
// specific harness's hook-protocol implementation.
//
// What this covers vs Stage 7b:
//   Stage 7b: brief content correct (no LLM call)
//   Stage 7:  LLM given the brief answers the recall question correctly
async function stage7_recall() {
  header("STAGE 7 · NEW session recalls prior facts via brief (universal)");

  // Step 1: get the brief that any harness would see by firing the
  // SessionStart hook directly. This is the source of truth — same
  // text Claude Code (or any other hook-protocol harness) would
  // prepend to the agent's context.
  const {
    stdout: hookStdout,
    code: hookCode,
    stderr: hookErr,
  } = fireHook("session-start", {
    session_id: "e2e-s7-recall",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  if (hookCode !== 0) {
    fail("7.1 brief from hook", `hook exit ${hookCode}: ${(hookErr ?? "").slice(0, 200)}`);
    return;
  }
  const briefMatch = hookStdout.match(/<synapse-brief>([\s\S]*?)<\/synapse-brief>/);
  if (!briefMatch) {
    fail("7.1 brief from hook", "no <synapse-brief> tag in hook output");
    return;
  }
  const brief = briefMatch[0]; // include the tags so the agent sees them verbatim

  // Step 2: build the recall prompt. We give the agent the brief and ask
  // for the two facts; we explicitly forbid tool use so the answer comes
  // from the brief content, not from a side channel.
  const recallPrompt = `Below is your <synapse-brief> for the current project (the same content a harness would inject into your context):

${brief}

Strict context-only mode. Use ONLY the brief above. Do NOT use Read, Bash, Grep, git, or ANY tool.

Question: A previous session in this cwd recorded two test facts. What were they? Specifically, what was the test_id and the secret_phrase?

If your brief doesn't have this, say 'NOT IN BRIEF'.`;

  info("Running the universal LLM driver with the recall question…");
  let driverResult;
  try {
    driverResult = await generateSession({
      prompt: recallPrompt,
      userAgent: "claude-cli/synapse-e2e-recall",
      cwd: testDir,
      timeoutMs: 120_000,
    });
  } catch (e) {
    fail("7.1 recall (THE TEST)", `driver error: ${e.message}`);
    return;
  }
  info(`Driver mode=${driverResult.mode} driver=${driverResult.driver}`);
  info(`Agent response (first 400 chars):\n  ${(driverResult.stdoutText ?? "").slice(0, 400).replace(/\n/g, "\n  ")}`);

  const reply = driverResult.stdoutText ?? "";
  const recalledId = reply.includes(TEST_ID);
  const recalledPhrase = reply.includes(TEST_PHRASE);
  if (recalledId && recalledPhrase) {
    ok("7.1 recall (THE TEST)", "agent recalled BOTH test_id and secret_phrase from the brief");
  } else {
    fail("7.1 recall (THE TEST)", `agent failed to recall — TEST_ID=${recalledId} TEST_PHRASE=${recalledPhrase}`);
  }
}

// ── Stage 7b: brief CONTENT contains the test phrase (universal) ──────────
//
// Runs on every OS regardless of claude availability. Verifies the brief
// content was generated correctly by the daemon's pipeline — the same
// content Stage 7 would have shown claude. Catches "brief generation
// broken" / "phrase missing from brief" without needing the integration
// to exercise it.
//
// We can't fetch the brief from the backend — `composeBrief` is daemon-
// local code that pulls handoff_markdown from backend + local cache and
// stitches them into the <synapse-brief> tag. To exercise it universally
// we fire the SessionStart hook directly and read the brief from stdout,
// the SAME path that Claude Code (or any other harness) takes.
async function stage7b_brief_content() {
  header("STAGE 7b · brief content contains the test phrase (universal)");

  // The handoff_markdown that Stage 6 just verified is the source of the
  // brief content. The next SessionStart hook in this cwd will pull that
  // handoff into the brief — that's what we want to assert here. Same
  // mechanism Claude Code uses; no claude binary required.
  const { stdout, code, stderr } = fireHook("session-start", {
    session_id: "e2e-stage-7b",
    cwd: testDir,
    source: "startup",
    hook_event_name: "SessionStart",
  });

  if (code !== 0) {
    fail("7b.1 hook exit", `hook exit ${code}: ${(stderr ?? "").slice(0, 200)}`);
    return;
  }

  const match = stdout.match(/<synapse-brief>([\s\S]*?)<\/synapse-brief>/);
  if (!match) {
    fail("7b.1 brief tag", "no <synapse-brief> tag in hook output");
    return;
  }
  const briefContent = match[1];

  const hasId = briefContent.includes(TEST_ID);
  const hasPhrase = briefContent.includes(TEST_PHRASE);

  if (hasId && hasPhrase) {
    ok("7b.1 brief content", "brief contains BOTH test_id and secret_phrase");
  } else {
    fail(
      "7b.1 brief content",
      `brief missing facts — TEST_ID=${hasId} TEST_PHRASE=${hasPhrase}; brief excerpt:\n  ${briefContent.slice(0, 400).replace(/\n/g, "\n  ")}`,
    );
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
      // Show stderr always (it usually has the actual error when the
      // process exits abnormally); `??` would skip it whenever stdout
      // had any spinner content. Slice each separately so neither
      // half is lost to truncation.
      const out = (r.stdout ?? "").slice(0, 200);
      const err = (r.stderr ?? "").slice(0, 300);
      fail(
        `9.${cmd}`,
        `exit ${r.status} (signal=${r.signal ?? "none"}): stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`,
      );
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
      await stage7b_brief_content();
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
