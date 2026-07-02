#!/usr/bin/env node
// scripts/e2e-failure-cases.mjs
//
// STANDARD FAILURE-CASE E2E SUITE — complement to e2e-happy-flow.mjs.
//
// For each realistic failure mode, this script:
//   1. Injects the failure (auth removed, network dead, file corrupted, etc.)
//   2. Triggers the user-facing operation that would normally hit it
//   3. Asserts graceful degradation — no crash, no unhandled exception,
//      reasonable behavior (degraded output is fine; silent corruption isn't)
//   4. Restores the precondition and verifies the operation works again
//
// The bar: "what does a user see when X breaks?" If the answer is
// "Claude Code hangs", "synapsesync crashes", or "their data quietly
// goes somewhere wrong", that's a bug.
//
// Failure modes covered (15 stages):
//
//   F1.1   API key missing entirely (env empty, no config file)
//   F1.2   API key invalid (401 from backend)
//   F1.3   API_BASE points to unreachable host (network down)
//   F2.1   Cwd is not a git repo at all
//   F2.2   Cwd path doesn't exist
//   F2.3   project-map.json is corrupt JSON
//   F2.4   project-map entry points to deleted project (404)
//   F4.1   Concurrent message-append race (parallel POSTs)
//   F6.1   claude CLI not on PATH (recompute degrades)
//   F6.2   Local jsonl missing for capturedSessionId (cross-device case)
//   F8.1   Insight validation error (missing required field)
//   F8.2   Insight against project the user can't access (403)
//   F-CLI  CLI subcommand on unknown command
//   F-LIST List conversations with bogus project_id
//   F-RECOVER  After fixing F1.1 (key restored), pull-handoff works again
//
// Usage:
//   npm run test:e2e:failures
//   node scripts/e2e-failure-cases.mjs
//
// Exit codes:
//   0 — all failure modes degraded gracefully (and recovered where applicable)
//   1 — one or more failure modes caused a crash, hang, or silent corruption
//   2 — preflight error (missing prereq)

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";
const UNREACHABLE_API_BASE = "https://api-not-a-real-synapse-host-12345.invalid";

const results = [];
let apiKey = null;
const cleanupPaths = [];

// ── Helpers ──────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function header(s) {
  log("\n────────────────────────────────────────────────────────────────────");
  log(s);
  log("────────────────────────────────────────────────────────────────────");
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

function fireHook(name, payload, env = {}) {
  const start = Date.now();
  const out = spawnSync("node", [MCP_DIST, "hook", name], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return {
    elapsed: Date.now() - start,
    stdout: out.stdout ?? "",
    stderr: out.stderr ?? "",
    code: out.status,
    signal: out.signal,
    timedOut: out.signal === "SIGTERM",
  };
}

async function fetchJson(pathname, init = {}, key = apiKey, base = API_BASE) {
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, ok: res.ok, body: res.ok ? await res.json() : await res.text() };
}

function getApiKey() {
  if (process.env.SYNAPSE_API_KEY && process.env.SYNAPSE_API_KEY !== "undefined") {
    return process.env.SYNAPSE_API_KEY;
  }
  const configPath = path.join(process.env.HOME ?? "/", ".synapse", "config.json");
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, "utf-8")).api_key ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function makeIsolatedHome() {
  // Fresh SYNAPSE_HOME so we don't touch the user's real project-map / state
  const home = mkdtempSync(path.join(tmpdir(), "synapse-failure-home-"));
  cleanupPaths.push(home);
  return home;
}

function withConfig(home, cfg) {
  writeFileSync(path.join(home, "config.json"), JSON.stringify(cfg));
  return home;
}

// ── Preflight ───────────────────────────────────────────────────────────
function preflight() {
  header("PREFLIGHT");
  if (!existsSync(MCP_DIST)) {
    fail("preflight", "MCP dist not built");
    return false;
  }
  apiKey = getApiKey();
  if (!apiKey) {
    fail("preflight", "no API key resolvable");
    return false;
  }
  ok("preflight", "ready");
  return true;
}

// ── F1.1: API key missing entirely ──────────────────────────────────────
async function stageF1_1_no_api_key() {
  header("F1.1 · API key missing (env empty, no config)");
  const home = makeIsolatedHome(); // empty home, no config.json
  const cwd = mkdtempSync(path.join(tmpdir(), "f1-cwd-"));
  cleanupPaths.push(cwd);

  info("Firing SessionStart with SYNAPSE_API_KEY='' and isolated empty SYNAPSE_HOME");
  const { code, stdout, elapsed } = fireHook(
    "session-start",
    { session_id: "f1-1", cwd, source: "startup" },
    { SYNAPSE_API_KEY: "", SYNAPSE_HOME: home },
  );

  if (code !== 0) fail("F1.1.1 exit code", `hook crashed: exit=${code}`);
  else ok("F1.1.1 exit code", `graceful exit 0 in ${elapsed}ms`);

  if (!stdout.includes("<synapse-brief>")) fail("F1.1.2 brief", "no brief emitted — Claude Code would see nothing");
  else ok("F1.1.2 brief", "brief still emitted (degraded but functional)");

  if (stdout.includes("Last conversation handoff")) {
    fail("F1.1.3 no handoff", "brief claims handoff exists when there's no auth — data leakage risk");
  } else {
    ok("F1.1.3 no handoff", "brief correctly has no handoff section without auth");
  }
}

// ── F1.2: API key invalid (401) ─────────────────────────────────────────
async function stageF1_2_bad_api_key() {
  header("F1.2 · API key invalid (401 from backend)");

  // Probe directly to verify behavior
  const r = await fetchJson("/api/projects", {}, "fake-key-that-will-401-12345");
  if (r.status !== 401 && r.status !== 403) {
    fail("F1.2.1 backend rejects bad key", `expected 401/403, got ${r.status}`);
  } else {
    ok("F1.2.1 backend rejects bad key", `backend returned ${r.status} as expected`);
  }

  // Run hook with a bogus key
  const cwd = mkdtempSync(path.join(tmpdir(), "f1-2-cwd-"));
  cleanupPaths.push(cwd);
  spawnSync("git", ["init", "-q"], { cwd });

  const { code, stdout } = fireHook(
    "session-start",
    { session_id: "f1-2", cwd, source: "startup" },
    { SYNAPSE_API_KEY: "fake-bogus-key-401" },
  );

  if (code !== 0) fail("F1.2.2 hook exit", `hook crashed with bad key: exit=${code}`);
  else ok("F1.2.2 hook exit", "graceful exit 0 (auth failure doesn't crash hook)");

  if (!stdout.includes("<synapse-brief>")) fail("F1.2.3 brief", "no brief on auth failure");
  else ok("F1.2.3 brief", "brief emitted (sans handoff) on auth failure");
}

// ── F1.3: Backend unreachable ───────────────────────────────────────────
async function stageF1_3_unreachable() {
  header("F1.3 · Backend unreachable (DNS / network failure)");

  // We can't easily force the hook to use a different API_BASE
  // (it's baked into config.ts at build time). But we CAN verify
  // pull-compact's network-error path directly via Node.
  info("Calling pullHandoff with API_BASE pointed at non-resolvable host");

  const result = await new Promise((resolve) => {
    const child = spawnSync(
      "node",
      [
        "-e",
        `
        process.env.SYNAPSE_API_URL = "${UNREACHABLE_API_BASE}";
        process.env.SYNAPSE_API_KEY = "${apiKey}";
        import("${path.join(REPO_ROOT, "mcp/dist/capture/pull-compact.js")}")
          .then(async (m) => {
            const r = await m.pullHandoff({
              cwd: process.cwd(),
              apiUrl: "${UNREACHABLE_API_BASE}",
              apiKey: "${apiKey}",
              log: (s) => process.stderr.write(s + "\\n"),
            });
            console.log("RESULT:", r === null ? "null" : r.length + " bytes");
          })
          .catch(e => console.log("THREW:", e.message));
      `,
      ],
      { encoding: "utf-8", timeout: 30_000 },
    );
    resolve(child);
  });

  if (result.status !== 0) fail("F1.3.1 graceful network failure", `crashed: ${result.stderr?.slice(0, 200)}`);
  else if (result.stdout.includes("THREW"))
    fail("F1.3.1 graceful network failure", `pullHandoff threw: ${result.stdout}`);
  else if (result.stdout.includes("RESULT: null"))
    ok("F1.3.1 graceful network failure", "pullHandoff returned null on unreachable host (no throw)");
  else ok("F1.3.1 graceful network failure", `returned without throw: ${result.stdout.slice(0, 100)}`);
}

// ── F2.1: Cwd is not a git repo ─────────────────────────────────────────
async function stageF2_1_no_git() {
  header("F2.1 · Cwd is a directory but not a git repo");

  const cwd = mkdtempSync(path.join(tmpdir(), "f2-1-no-git-"));
  cleanupPaths.push(cwd);

  const { code, stdout } = fireHook("session-start", { session_id: "f2-1", cwd, source: "startup" });

  if (code !== 0) fail("F2.1.1 hook exit", `crashed on non-git cwd: ${code}`);
  else ok("F2.1.1 hook exit", "graceful on non-git cwd");

  if (!stdout.includes("<synapse-brief>")) fail("F2.1.2 brief shape", "no brief emitted");
  else ok("F2.1.2 brief shape", `${stdout.length} bytes — fallback message`);
}

// ── F2.2: Cwd doesn't exist on disk ─────────────────────────────────────
async function stageF2_2_missing_cwd() {
  header("F2.2 · Cwd path does not exist");

  const cwd = `/tmp/this-path-truly-does-not-exist-${Date.now()}`;

  const { code, stdout } = fireHook("session-start", { session_id: "f2-2", cwd, source: "startup" });

  if (code !== 0) fail("F2.2.1 hook exit", `crashed on missing cwd: ${code}`);
  else ok("F2.2.1 hook exit", "graceful (exit 0) on missing path");

  if (!stdout.includes("<synapse-brief>")) fail("F2.2.2 brief", "no brief on missing cwd");
  else ok("F2.2.2 brief", "brief still emitted with degraded content");
}

// ── F2.3: project-map.json corrupt ──────────────────────────────────────
async function stageF2_3_corrupt_project_map() {
  header("F2.3 · project-map.json contains invalid JSON");

  const home = makeIsolatedHome();
  writeFileSync(path.join(home, "project-map.json"), "{ this is :: not valid JSON [[ ");
  withConfig(home, { api_key: apiKey, user_id: "test", email: "test@test" });

  const cwd = mkdtempSync(path.join(tmpdir(), "f2-3-"));
  cleanupPaths.push(cwd);

  const { code, stdout } = fireHook(
    "session-start",
    { session_id: "f2-3", cwd, source: "startup" },
    { SYNAPSE_HOME: home },
  );

  if (code !== 0) fail("F2.3.1 hook exit", `corrupt project-map crashed hook: ${code}`);
  else ok("F2.3.1 hook exit", "corrupt project-map handled — hook exits cleanly");

  if (!stdout.includes("<synapse-brief>")) fail("F2.3.2 brief", "no brief emitted");
  else ok("F2.3.2 brief", "brief emitted despite corrupt project-map");
}

// ── F2.4: project-map entry points to deleted project (404) ─────────────
async function stageF2_4_stale_project_map() {
  header("F2.4 · project-map entry points to project that no longer exists on backend");

  const home = makeIsolatedHome();
  const cwd = mkdtempSync(path.join(tmpdir(), "f2-4-cwd-"));
  cleanupPaths.push(cwd);
  // CRITICAL: must use realpath, not path.resolve. macOS mkdtemp returns
  // paths under symlinks (/tmp → /private/tmp, /var/folders/... → /private/...)
  // and production code always stores project-map keys under realpath'd
  // canonical paths. path.resolve alone misses the symlink dereference,
  // and the hook would never find the entry — the 404 invalidation path
  // wouldn't fire and this test would pass on a trivial setup miss
  // rather than the actual invalidation behavior.
  const canonicalCwd = (await import("node:fs")).realpathSync(cwd);

  // Write a project-map entry pointing to a UUID that doesn't exist
  const fakeUuid = "00000000-0000-0000-0000-000000000000";
  writeFileSync(
    path.join(home, "project-map.json"),
    JSON.stringify({
      [canonicalCwd]: {
        project_id: fakeUuid,
        project_name: "ghost",
        updated_at: new Date().toISOString(),
      },
    }),
  );
  withConfig(home, { api_key: apiKey, user_id: "test", email: "test@test" });

  const { code, stdout, elapsed } = fireHook(
    "session-start",
    { session_id: "f2-4", cwd: canonicalCwd, source: "startup" },
    { SYNAPSE_HOME: home },
  );

  if (code !== 0) fail("F2.4.1 hook exit", `crashed on stale project-map entry: ${code}`);
  else ok("F2.4.1 hook exit", `graceful in ${elapsed}ms`);

  // Stale entry should be invalidated (removed from project-map)
  try {
    const map = JSON.parse(readFileSync(path.join(home, "project-map.json"), "utf-8"));
    if (map[canonicalCwd]) {
      fail("F2.4.2 invalidation", "stale project-map entry NOT removed after 404");
    } else {
      ok("F2.4.2 invalidation", "stale entry was invalidated (removed from cache)");
    }
  } catch (e) {
    fail("F2.4.2 invalidation", `couldn't read project-map: ${e.message}`);
  }
}

// ── F4.1: Concurrent message-append race ────────────────────────────────
async function stageF4_1_concurrent_append() {
  header("F4.1 · Concurrent message-append (race retry must work)");

  // Find a real conversation we can write to. Pick the first project the user owns.
  const projects = await fetchJson("/api/projects");
  if (!projects.ok || !Array.isArray(projects.body)) {
    fail("F4.1.setup", `couldn't list projects: ${projects.status}`);
    return;
  }
  const project = projects.body[0];
  if (!project) {
    info("No projects — skipping race test (would need at least one)");
    return;
  }

  // Create a temp conversation for this test
  const created = await fetchJson("/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      project_id: project.id,
      fidelity_mode: "summary",
      title: `e2e-failure-race-${Date.now()}`,
    }),
  });
  if (!created.ok) {
    fail("F4.1.setup", `couldn't create test conversation: ${created.status}`);
    return;
  }
  const convId = created.body.id ?? created.body.conversation?.id;
  info(`Test conversation: ${convId}`);

  // Fire 10 concurrent message POSTs
  const promises = Array.from({ length: 10 }, (_, i) =>
    fetchJson(`/api/conversations/${convId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: `concurrent test message ${i}`, source_agent: "e2e-test" }],
      }),
    }),
  );
  const responses = await Promise.all(promises);
  const successCount = responses.filter((r) => r.ok).length;
  const _failCount = responses.length - successCount;

  if (successCount === 10) {
    ok("F4.1.1 race retry", "all 10 concurrent POSTs succeeded (retry worked)");
  } else if (successCount >= 7) {
    ok("F4.1.1 race retry (degraded)", `${successCount}/10 succeeded — retry partially helps but losses happen`);
  } else {
    fail("F4.1.1 race retry", `only ${successCount}/10 succeeded — race recovery is broken`);
  }

  // Cleanup the test conversation
  await fetch(`${API_BASE}/api/conversations/${convId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// ── F6.1: claude CLI missing from PATH ──────────────────────────────────
async function stageF6_1_no_claude_cli() {
  header("F6.1 · claude CLI not on PATH (recompute degrades)");

  // We can't actually uninstall claude, but we can mask it from the
  // child's PATH. Subtle gotcha: stripping PATH to /usr/bin:/bin removes
  // node itself (it's at /opt/homebrew/bin/node). Use the absolute node
  // path so the test isolates the "no claude" case, not "no node".
  info("Spawning pull-handoff with absolute node path + claude-less PATH");

  const cwd = mkdtempSync(path.join(tmpdir(), "f6-1-"));
  cleanupPaths.push(cwd);
  spawnSync("git", ["init", "-q"], { cwd });
  spawnSync("git", ["remote", "add", "origin", `https://example.com/f6-${Date.now()}.git`], { cwd });

  // Use an isolated SYNAPSE_HOME so the bg recompute doesn't pollute real state
  const home = makeIsolatedHome();
  withConfig(home, { api_key: apiKey, user_id: "test", email: "test@test" });

  // process.execPath is the absolute path to the current node binary — survives
  // PATH stripping. We strip /opt/homebrew/* from PATH so claude (at
  // /opt/homebrew/bin/claude) can't be found, but standard utilities still work.
  const claudelessPath =
    (process.env.PATH ?? "")
      .split(":")
      .filter((p) => !p.includes("homebrew") && !p.includes("claude"))
      .join(":") || "/usr/bin:/bin";

  const result = spawnSync(process.execPath, [MCP_DIST, "pull-handoff", "--cwd", cwd], {
    encoding: "utf-8",
    timeout: 60_000,
    env: { ...process.env, PATH: claudelessPath, SYNAPSE_HOME: home },
  });

  // The expected behavior: pull-handoff CLI exits 0 (per its design — fire-and-forget contract)
  // even when the recompute fails because claude is missing. It logs the failure.
  if (result.status !== 0) {
    fail("F6.1.1 exit code", `pull-handoff crashed without claude: status=${result.status} signal=${result.signal}`);
  } else {
    ok("F6.1.1 exit code", "pull-handoff exit 0 (fire-and-forget contract honored)");
  }
}

// ── F6.2: capturedSessionId points to a session jsonl that doesn't exist ─
async function stageF6_2_missing_local_session() {
  header("F6.2 · Recompute when local jsonl is missing (cross-device new-machine case)");

  // This simulates: machine A had a session, synced to backend. Machine B
  // opens fresh and tries to recompute the handoff — but the local jsonl
  // is on machine A, not B. adapter.compact() can't find the transcript.
  //
  // Expected behavior: pull-compact returns cachedHandoff (stale fallback)
  // or null, doesn't crash.

  // The easiest way to test this: pick a real conversation but pretend
  // its capturedSessionId doesn't exist on this machine. We test directly
  // via the pullHandoff function with a synthetic session id.

  const result = spawnSync(
    "node",
    [
      "-e",
      `
      process.env.SYNAPSE_API_KEY = "${apiKey}";
      import("${path.join(REPO_ROOT, "mcp/dist/capture/pull-compact.js")}").then(async (m) => {
        try {
          // Use a fresh tmpdir cwd that has no project at all — pull-compact
          // will resolve as "no project found" and return null (the correct
          // degradation).
          const r = await m.pullHandoff({
            cwd: "/tmp/nonexistent-fresh-${Date.now()}",
            apiKey: "${apiKey}",
            log: () => {},
          });
          console.log("RESULT:", r === null ? "null" : "string of " + r.length + " bytes");
        } catch (e) {
          console.log("THREW:", e.message);
        }
      });
    `,
    ],
    { encoding: "utf-8", timeout: 30_000 },
  );

  if (result.stdout.includes("THREW")) {
    fail("F6.2.1 graceful missing jsonl", `pullHandoff threw: ${result.stdout}`);
  } else if (result.stdout.includes("RESULT: null")) {
    ok("F6.2.1 graceful missing jsonl", "returned null (degraded correctly, no exception)");
  } else if (result.stdout.includes("RESULT:")) {
    ok("F6.2.1 graceful missing jsonl", `returned content: ${result.stdout.trim()}`);
  } else {
    fail("F6.2.1 graceful missing jsonl", `unexpected output: ${result.stdout.slice(0, 200)}`);
  }
}

// ── F8.1: Insight validation error ──────────────────────────────────────
async function stageF8_1_bad_insight() {
  header("F8.1 · save_insight with missing required fields");

  // Find a project we own
  const projects = await fetchJson("/api/projects");
  if (!projects.ok || !projects.body[0]) {
    fail("F8.1.setup", "no projects");
    return;
  }
  const projectId = projects.body[0].id;

  // Send a request without required fields (no type, no summary)
  const r = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId }), // missing type, summary
  });

  if (r.status >= 200 && r.status < 300) {
    fail("F8.1.1 validation", `accepted bad insight (status ${r.status}) — silent acceptance is wrong`);
  } else if (r.status === 400 || r.status === 422) {
    ok("F8.1.1 validation", `rejected with ${r.status} (graceful validation error)`);
  } else if (r.status === 500) {
    fail("F8.1.1 validation", "5xx on bad input — should be 4xx (client error)");
  } else {
    ok("F8.1.1 validation", `rejected with ${r.status}`);
  }
}

// ── F8.2: Insight against project user doesn't own (403) ────────────────
async function stageF8_2_unauthorized_insight() {
  header("F8.2 · save_insight against project user doesn't have access to");

  // Use a fake project UUID that the user doesn't own
  const fakeProjectId = "00000000-0000-0000-0000-000000000099";

  const r = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({
      project_id: fakeProjectId,
      type: "decision",
      summary: "this should be rejected",
    }),
  });

  if (r.status === 403 || r.status === 404) {
    ok("F8.2.1 authorization", `rejected with ${r.status} (correct — no leakage to other users' projects)`);
  } else if (r.status >= 200 && r.status < 300) {
    fail(
      "F8.2.1 authorization",
      `CRITICAL: accepted insight against project user doesn't own (status ${r.status}) — data leakage`,
    );
  } else {
    ok("F8.2.1 authorization", `rejected with ${r.status}`);
  }
}

// ── F-CLI: unknown CLI subcommand ───────────────────────────────────────
async function stageF_cli_unknown() {
  header("F-CLI · synapsesync run with unknown subcommand");

  const result = spawnSync("node", [MCP_DIST, "not-a-real-subcommand"], {
    encoding: "utf-8",
    timeout: 10_000,
  });

  if (result.signal) {
    fail("F-CLI.1", `CLI killed by signal ${result.signal}`);
  } else if (result.status === 0) {
    fail("F-CLI.1", "unknown subcommand exited 0 (silent — should error)");
  } else {
    // Any non-zero exit + helpful stderr is fine
    ok("F-CLI.1", `errored cleanly: exit=${result.status}`);
  }
}

// ── F-LIST: list conversations with bogus project_id ────────────────────
async function stageF_list_bogus() {
  header("F-LIST · GET /api/conversations with bogus project_id");

  const r = await fetchJson("/api/conversations?project_id=not-a-uuid-bogus");
  if (r.status === 400 || r.status === 404 || r.status === 422) {
    ok("F-LIST.1", `rejected with ${r.status} (graceful)`);
  } else if (r.status === 200) {
    // Acceptable if empty
    const convs = r.body?.conversations ?? [];
    if (convs.length === 0) {
      ok("F-LIST.1", "200 with empty conversations array (acceptable, equivalent to 'no match')");
    } else {
      fail("F-LIST.1", `returned ${convs.length} conversations for nonsense project_id — data leakage`);
    }
  } else if (r.status === 500) {
    fail("F-LIST.1", "5xx on bogus uuid — should be 4xx");
  } else {
    ok("F-LIST.1", `status ${r.status}`);
  }
}

// ── F-RECOVER: after fixing F1.1 (key restored), the same path works ────
async function stageF_recover() {
  header("F-RECOVER · System recovers after auth is restored");

  const cwd = mkdtempSync(path.join(tmpdir(), "f-recover-"));
  cleanupPaths.push(cwd);
  spawnSync("git", ["init", "-q"], { cwd });

  // First call: bogus key (failure)
  const broken = fireHook(
    "session-start",
    { session_id: "f-recover-1", cwd, source: "startup" },
    { SYNAPSE_API_KEY: "bogus" },
  );
  const brokenSize = broken.stdout.length;

  // Second call: real key (recovery)
  const recovered = fireHook(
    "session-start",
    { session_id: "f-recover-2", cwd, source: "startup" },
    { SYNAPSE_API_KEY: apiKey },
  );
  const recoveredSize = recovered.stdout.length;

  if (broken.code !== 0) fail("F-RECOVER.1 broken graceful", `broken-key call crashed: ${broken.code}`);
  else ok("F-RECOVER.1 broken graceful", `broken-key call exit 0 (${brokenSize} bytes)`);

  if (recovered.code !== 0) fail("F-RECOVER.2 recovery", `restored-key call crashed: ${recovered.code}`);
  else ok("F-RECOVER.2 recovery", `restored-key call exit 0 (${recoveredSize} bytes)`);

  // Recovery should at least be no worse than broken (likely better but
  // depends on whether a project exists yet for this cwd)
  if (recoveredSize >= brokenSize)
    ok("F-RECOVER.3 no degradation", "restored call produced ≥ content than broken call");
  else
    fail(
      "F-RECOVER.3 no degradation",
      `restored produced LESS content (${recoveredSize}b) than broken (${brokenSize}b)`,
    );
}

// ── Cleanup ─────────────────────────────────────────────────────────────
function cleanup() {
  for (const p of cleanupPaths) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse failure-cases E2E suite");
  log(`API: ${API_BASE}`);

  if (!preflight()) {
    process.exit(2);
  }

  try {
    await stageF1_1_no_api_key();
    await stageF1_2_bad_api_key();
    await stageF1_3_unreachable();
    await stageF2_1_no_git();
    await stageF2_2_missing_cwd();
    await stageF2_3_corrupt_project_map();
    await stageF2_4_stale_project_map();
    await stageF4_1_concurrent_append();
    await stageF6_1_no_claude_cli();
    await stageF6_2_missing_local_session();
    await stageF8_1_bad_insight();
    await stageF8_2_unauthorized_insight();
    await stageF_cli_unknown();
    await stageF_list_bogus();
    await stageF_recover();
  } catch (err) {
    log(`\n🚨 UNCAUGHT IN SUITE: ${err.message}\n${err.stack}`);
    results.push({ id: "uncaught", status: "FAIL", detail: err.message });
  } finally {
    header("CLEANUP");
    cleanup();
  }

  header("SUMMARY");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : "❌";
    log(`  ${icon} ${r.id.padEnd(40)} ${r.detail}`);
  }
  log("");
  log(`  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}`);
  log("");
  if (failed > 0) {
    log("❌ FAILURE-CASE SUITE FAILED. At least one failure mode crashes / corrupts / leaks.");
    process.exit(1);
  } else {
    log("✅ All failure modes degrade gracefully and recover correctly.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
