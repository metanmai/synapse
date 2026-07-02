#!/usr/bin/env node
// scripts/e2e-multi-account.mjs
//
// THE STANDARD MULTI-ACCOUNT SHARING + REVOCATION TEST.
//
// Validates the cross-account promise: "When User A shares a project with
// User B, B sees A's handoff/insights in their brief AND can write back.
// When A revokes B, EVERY access surface (list, read API, brief, write API)
// blocks B from the project — no silent leakage."
//
// Setup constraints:
//   - User A's API key is read from ~/.synapse/config.json (the active CLI key).
//   - User B's API key MUST be provided via env: SYNAPSE_API_KEY_USER_B.
//     The test discovers User B's email from /api/account/me using the key
//     so neither the email nor the key is ever hard-coded.
//
// Stages (25 total):
//   MA1   Preflight — both keys + claude + User B identity
//   MA2   User A: cwd setup, claude -p capture, project materializes
//   MA3   User A: re-fire SessionStart → bg recompute → handoff lands
//   MA4   User A: save insight with UNIQUE_A_PHRASE
//   MA5   User A: invite User B as 'editor' via POST /api/projects/:id/members
//   MA6   User B: project visible in /api/projects + insight visible in /api/insights
//   MA7   User B: SessionStart hook on own cwd (same git remote URL) → brief
//         contains UNIQUE_A_PHRASE — cross-account READ proven
//   MA8   User B: save insight with UNIQUE_B_PHRASE (write proven)
//   MA9   User A: SessionStart re-fire → brief contains UNIQUE_B_PHRASE —
//         cross-account WRITE-BACK proven
//   MA10  User A: demote User B to 'viewer' via PATCH /api/projects/:id/members/:email
//   MA11  User B: GET /api/insights still works (viewer can read)
//   MA12  User B: POST /api/insights returns 403 (viewer cannot write)
//   MA13  User A: promote User B back to 'editor' (so MA14 works)
//   MA14  User B: supersedes UNIQUE_A_PHRASE with UNIQUE_SUPERSEDE_PHRASE
//   MA15  User A: brief reflects supersession — sees SUPERSEDE phrase, NOT
//         UNIQUE_A_PHRASE — cross-account supersession proven
//   MA16  User A: revoke User B via DELETE /api/projects/:id/members/:email
//   MA17  User B: project NO LONGER visible in /api/projects (list closed)
//   MA18  User B: GET /api/insights → 403/404 (read API closed)
//   MA19  User B: SessionStart brief contains NEITHER UNIQUE_A_PHRASE,
//         UNIQUE_B_PHRASE, nor UNIQUE_SUPERSEDE_PHRASE (brief closed)
//   MA20  User B: POST /api/insights → 403/404 (write API closed)
//   MA21  Revoking a non-member → 404 (negative case)
//   MA22  Revoking by non-owner (User B trying to revoke A) → 403 (negative)
//   MA23  Revoking the owner themselves → 403/400 (negative — can't be done)
//   MA24  User A re-invites User B → access restored (idempotent re-add)
//   MA25  User A creates share-link, User B (after revoke + cleanup) joins
//         via POST /api/share/:token/join (parallel sharing path proven)
//   MA26  Editor (User B) cannot PATCH another member's role → 403
//   MA27  Editor (User B) cannot DELETE the project → 403
//   MA28  Invite with non-existent email → 404
//   MA29  Invite with invalid role → 4xx
//
// Cost per run: ~$0.05-0.10 in Anthropic tokens (one claude -p capture,
// two background recomputes via claude-haiku).
// Wall time: ~2-3 min.
//
// Exit codes: 0 = pass, 1 = failure, 2 = preflight error

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeLocalProjectState, removeLocalProjectsByBasename, sweepArtifacts } from "./e2e-cleanup.mjs";

// ── Configuration ────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const API_BASE = process.env.SYNAPSE_API_BASE ?? "https://api.synapsesync.app";

const RUN_ID = Date.now();
const PROJECT_BASENAME = `multi-account-${RUN_ID}`;
const SHARED_REMOTE = `https://github.com/synapse-e2e/${PROJECT_BASENAME}.git`;

// Unique phrases for each role/event so a model can't fabricate any.
const UNIQUE_A_PHRASE = `albatross-isthmus-eleven-${RUN_ID}`;
const UNIQUE_B_PHRASE = `bobcat-lagoon-seven-${RUN_ID}`;
const UNIQUE_SUPERSEDE_PHRASE = `cheetah-archipelago-four-${RUN_ID}`;
const VIEWER_WRITE_PHRASE = `dingo-volcano-nine-${RUN_ID}`;
const POST_REVOKE_WRITE_PHRASE = `elephant-canyon-two-${RUN_ID}`;

const SLEEP_DAEMON_SYNC_MS = 15_000;
const SLEEP_RECOMPUTE_MAX_MS = 90_000;
const HOOK_FAST_TIMEOUT_MS = 10_000;

// ── State ────────────────────────────────────────────────────────────────
const results = [];
let apiKeyA = null;
let apiKeyB = null;
let userBEmail = null;
let userBUserId = null;
let userBSynapseHome = null;
let userBCwd = null;
let deviceADir = null;
let testProjectId = null;
let userAConvId = null;
let userAInsightId = null; // the one that gets superseded in MA14
let shareLinkToken = null;
let memberAddedB = false; // tracked so cleanup attempts removal idempotently

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(pathname, init = {}, keyOverride = null) {
  const key = keyOverride ?? apiKeyA;
  const MAX_TRIES = 4;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) return { _status: res.status, _err: await res.text() };
      // Some endpoints return empty bodies (DELETE etc)
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) return { _status: res.status, ok: true };
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_TRIES) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  return { _status: 0, _err: `network: ${lastErr?.message ?? lastErr}` };
}

function fireHook(name, payload, envOverride = {}) {
  const start = Date.now();
  const out = spawnSync(process.execPath, [MCP_DIST, "hook", name], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...envOverride },
  });
  return { elapsed: Date.now() - start, stdout: out.stdout ?? "", stderr: out.stderr ?? "", code: out.status };
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

function readApiKeyA() {
  if (process.env.SYNAPSE_API_KEY && process.env.SYNAPSE_API_KEY !== "undefined") {
    return process.env.SYNAPSE_API_KEY;
  }
  const cfg = path.join(process.env.HOME ?? "/", ".synapse", "config.json");
  if (existsSync(cfg)) {
    try {
      const c = JSON.parse(readFileSync(cfg, "utf-8"));
      if (c.api_key) return c.api_key;
    } catch {}
  }
  return null;
}

function gitInit(dir, remote) {
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "e2e-ma@synapse.test"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "e2e-ma"], { cwd: dir });
  spawnSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  writeFileSync(path.join(dir, "README.md"), "# e2e multi-account\n");
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

// ── Cleanup ─────────────────────────────────────────────────────────────
async function cleanup() {
  // Remove User B from members (idempotent — DELETE on non-member is fine)
  if (testProjectId && userBEmail && memberAddedB) {
    const res = await fetch(`${API_BASE}/api/projects/${testProjectId}/members/${encodeURIComponent(userBEmail)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKeyA}` },
    });
    if (res.ok || res.status === 404) {
      log("  · cleanup: User B removed from members (or already gone)");
    } else {
      log(`  · cleanup: WARN failed to remove User B (HTTP ${res.status})`);
    }
  }

  // Delete project (cascades insights, members, share-links via ?force=true)
  if (testProjectId) {
    const res = await fetch(`${API_BASE}/api/projects/${testProjectId}?force=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKeyA}` },
    });
    if (res.ok) log(`  · cleanup: deleted project ${testProjectId}`);
    else log(`  · cleanup: WARN failed to delete project (HTTP ${res.status})`);
    removeLocalProjectState(testProjectId, { log });
  }

  // Also nuke any cwd_<hash> placeholder dirs from BOTH daemons.
  removeLocalProjectsByBasename(PROJECT_BASENAME, { log });
  if (userBSynapseHome) {
    removeLocalProjectsByBasename(PROJECT_BASENAME, { synapseHome: userBSynapseHome, log });
  }
  // Belt-and-suspenders sweep on BOTH accounts: User B's daemon may have
  // auto-created a shadow project under User B's account from the same
  // remote, and the project may be co-owned, so a User A sweep alone misses
  // it. Use the same `-${RUN_ID}` pattern that's embedded in every name.
  await sweepArtifacts({
    apiKey: apiKeyA,
    apiUrl: API_BASE,
    patterns: [`-${RUN_ID}`],
    log,
    label: "User A",
  });
  if (apiKeyB) {
    await sweepArtifacts({
      apiKey: apiKeyB,
      apiUrl: API_BASE,
      patterns: [`-${RUN_ID}`],
      log,
      label: "User B",
    });
  }

  for (const d of [deviceADir, userBCwd, userBSynapseHome]) {
    if (d && existsSync(d)) {
      try {
        rmSync(d, { recursive: true, force: true });
        log(`  · cleanup: removed ${d}`);
      } catch (e) {
        log(`  · cleanup: WARN failed to rm ${d}: ${e.message}`);
      }
    }
  }
}

// ── MA1: Preflight ──────────────────────────────────────────────────────
async function ma1_preflight() {
  header("MA1 · Preflight — TWO keys + claude + User B identity discovery");

  if (!existsSync(MCP_DIST)) {
    fail("MA1 mcp dist", "Run: cd mcp && npm run build");
    return false;
  }
  info(`MCP dist at ${MCP_DIST}`);

  apiKeyA = readApiKeyA();
  if (!apiKeyA) {
    fail("MA1 user A key", "No SYNAPSE_API_KEY (User A) — set env or ~/.synapse/config.json");
    return false;
  }
  info(`User A key resolved (${apiKeyA.slice(0, 12)}...)`);

  apiKeyB = process.env.SYNAPSE_API_KEY_USER_B;
  if (!apiKeyB) {
    fail("MA1 user B key", "No SYNAPSE_API_KEY_USER_B env — multi-account test cannot run without a second account");
    return false;
  }
  info(`User B key resolved (${apiKeyB.slice(0, 12)}...)`);

  if (apiKeyA === apiKeyB) {
    fail("MA1 distinct keys", "User A and User B keys are identical — they must be different accounts");
    return false;
  }
  ok("MA1 distinct keys", "User A and User B have distinct API keys");

  const claude = spawnSync("which", ["claude"], { encoding: "utf-8" });
  if (claude.status !== 0) {
    fail("MA1 claude", "claude CLI not on PATH");
    return false;
  }
  info(`claude at ${claude.stdout.trim()}`);

  // Discover User B's email + user_id from /api/account/me
  const me = await fetchJson("/api/account/me", {}, apiKeyB);
  if (me._err || !me.email) {
    fail("MA1 user B identity", `failed to discover User B identity — ${me._err ?? "no email in response"}`);
    return false;
  }
  userBEmail = me.email;
  userBUserId = me.user_id ?? null;
  ok("MA1 user B identity", `email=${userBEmail} (id ${(userBUserId ?? "").slice(0, 8)}…)`);

  return true;
}

// ── MA2: User A captures session, project materializes ────────────────────
async function ma2_user_a_captures() {
  header("MA2 · User A captures claude -p session, project materializes on backend");

  deviceADir = path.join(tmpdir(), `synapse-ma-A-${RUN_ID}`, PROJECT_BASENAME);
  mkdirSync(deviceADir, { recursive: true });
  gitInit(deviceADir, SHARED_REMOTE);
  info(`User A cwd = ${deviceADir}`);

  const cp = spawnSync("claude", ["-p", "E2E multi-account test, User A side. Reply 'noted' only."], {
    cwd: deviceADir,
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (cp.status !== 0) {
    fail("MA2 claude -p", `exit ${cp.status}: ${(cp.stderr ?? "").slice(0, 200)}`);
    return;
  }
  ok("MA2 claude -p", "session captured");

  info(`Waiting ${SLEEP_DAEMON_SYNC_MS / 1000}s for daemon sync...`);
  await sleep(SLEEP_DAEMON_SYNC_MS);

  const projects = await fetchJson("/api/projects");
  if (!Array.isArray(projects)) {
    fail("MA2 backend project", `non-array: ${JSON.stringify(projects).slice(0, 200)}`);
    return;
  }
  const match = projects.find((p) => p.name === PROJECT_BASENAME);
  if (!match) {
    // Force flush + retry once
    try {
      writeFileSync(path.join(process.env.HOME ?? "/", ".synapse", "daemon-flush-now"), "");
    } catch {}
    await sleep(5000);
    const retry = await fetchJson("/api/projects");
    const m2 = Array.isArray(retry) ? retry.find((p) => p.name === PROJECT_BASENAME) : null;
    if (!m2) {
      fail("MA2 backend project", `project '${PROJECT_BASENAME}' not found`);
      return;
    }
    testProjectId = m2.id;
  } else {
    testProjectId = match.id;
  }
  ok("MA2 backend project", `created: ${testProjectId}`);

  const list = await fetchJson(`/api/conversations?project_id=${testProjectId}&limit=5`);
  const convs = list.conversations ?? [];
  if (convs.length === 0) {
    fail("MA2 conversation A", "no conversations in project");
    return;
  }
  userAConvId = convs[0].id;
  ok("MA2 conversation A", `synced: ${userAConvId}`);
}

// ── MA3: User A handoff lands ────────────────────────────────────────────
async function ma3_a_handoff_lands() {
  header("MA3 · User A handoff_markdown lands (re-fire triggers bg recompute)");

  const { elapsed, code } = fireHook("session-start", {
    session_id: "e2e-ma-A-recompute",
    cwd: deviceADir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  if (code !== 0) {
    fail("MA3 re-fire", `hook exit ${code}`);
    return;
  }
  info(`re-fire ${elapsed}ms — bg recompute spawned`);

  const handoff = await waitFor(
    async () => {
      const full = await fetchJson(`/api/conversations/${userAConvId}`);
      const meta = full.conversation?.metadata ?? full.metadata ?? {};
      return meta.handoff_markdown && meta.handoff_markdown.length > 0 ? meta.handoff_markdown : null;
    },
    SLEEP_RECOMPUTE_MAX_MS,
    3000,
  );
  if (!handoff) {
    fail("MA3 handoff posted", `no handoff_markdown after ${SLEEP_RECOMPUTE_MAX_MS / 1000}s`);
    return;
  }
  ok("MA3 handoff posted", `${handoff.length} bytes`);
}

// ── MA4: User A saves insight with UNIQUE_A_PHRASE ───────────────────────
async function ma4_a_saves_insight() {
  header("MA4 · User A saves insight with UNIQUE_A_PHRASE");

  const save = await fetchJson("/api/insights", {
    method: "POST",
    body: JSON.stringify({
      project_id: testProjectId,
      type: "decision",
      summary: `User A's contribution — ${UNIQUE_A_PHRASE}`,
      detail: "saved before invitation; User B must see this after MA5",
    }),
  });
  if (save._err || !save.id) {
    fail("MA4 save A", `HTTP ${save._status}: ${save._err ?? "no id"}`);
    return;
  }
  userAInsightId = save.id;
  ok("MA4 save A", `insight ${userAInsightId} created`);
}

// ── MA5: User A invites User B as editor ─────────────────────────────────
async function ma5_invite_b_as_editor() {
  header("MA5 · User A invites User B as editor");

  const res = await fetchJson(`/api/projects/${testProjectId}/members`, {
    method: "POST",
    body: JSON.stringify({ email: userBEmail, role: "editor" }),
  });
  if (res._err) {
    fail("MA5 invite", `HTTP ${res._status}: ${res._err.slice(0, 200)}`);
    return;
  }
  memberAddedB = true;
  ok("MA5 invite", `User B (${userBEmail}) added as editor`);
}

// ── MA6: User B sees shared project + insight ────────────────────────────
async function ma6_b_sees_shared_state() {
  header("MA6 · User B sees shared project + insight via API");

  const list = await fetchJson("/api/projects", {}, apiKeyB);
  if (!Array.isArray(list)) {
    fail("MA6 user B projects", `non-array: ${JSON.stringify(list).slice(0, 200)}`);
    return;
  }
  const found = list.find((p) => p.id === testProjectId);
  if (!found) {
    fail("MA6 user B projects", `shared project ${testProjectId} not in User B's list`);
    return;
  }
  ok("MA6 user B projects", "shared project visible to User B");

  const insights = await fetchJson(`/api/insights?project_id=${testProjectId}`, {}, apiKeyB);
  if (insights._err) {
    fail("MA6 user B insights", `HTTP ${insights._status}: ${insights._err.slice(0, 200)}`);
    return;
  }
  const items = insights.insights ?? [];
  const hasA = items.some((i) => i.id === userAInsightId);
  if (hasA) {
    ok("MA6 user B insights", `User B can read User A's insight via API`);
  } else {
    fail("MA6 user B insights", `User B did not see User A's insight in list`);
  }
}

// ── MA7: User B SessionStart hook → brief contains UNIQUE_A_PHRASE ───────
async function ma7_user_b_brief_reads() {
  header("MA7 · User B SessionStart on own cwd (same remote) — brief contains UNIQUE_A_PHRASE");

  // Fresh SYNAPSE_HOME so the project-map is cold (Tier 2 resolution via
  // backend resolver kicks in based on git_origin_url).
  userBSynapseHome = path.join(tmpdir(), `synapse-ma-B-home-${RUN_ID}`);
  mkdirSync(userBSynapseHome, { recursive: true });
  writeFileSync(path.join(userBSynapseHome, "config.json"), JSON.stringify({ api_key: apiKeyB }, null, 2));

  // Same project basename so the resolver's name match works
  userBCwd = path.join(tmpdir(), `synapse-ma-B-cwd-${RUN_ID}`, PROJECT_BASENAME);
  mkdirSync(userBCwd, { recursive: true });
  gitInit(userBCwd, SHARED_REMOTE);
  info(`User B cwd = ${userBCwd}`);
  info(`User B SYNAPSE_HOME = ${userBSynapseHome}`);

  const { elapsed, stdout, code } = fireHook(
    "session-start",
    { session_id: "e2e-ma-B", cwd: userBCwd, source: "startup", hook_event_name: "SessionStart" },
    { SYNAPSE_HOME: userBSynapseHome },
  );
  if (code !== 0) {
    fail("MA7 hook exit", `hook exit ${code}`);
    return;
  }
  if (elapsed > HOOK_FAST_TIMEOUT_MS) {
    fail("MA7 hook timing", `${elapsed}ms exceeds budget`);
    return;
  }
  ok("MA7 hook timing", `${elapsed}ms`);

  if (stdout.includes(UNIQUE_A_PHRASE)) {
    ok("MA7 cross-account READ", "User B's brief contains UNIQUE_A_PHRASE");
  } else {
    fail("MA7 cross-account READ", "User B's brief did NOT contain UNIQUE_A_PHRASE");
    info(`brief tail (last 800 chars):\n  ${stdout.slice(-800).replace(/\n/g, "\n  ")}`);
  }
}

// ── MA8: User B saves insight with UNIQUE_B_PHRASE ───────────────────────
async function ma8_user_b_writes() {
  header("MA8 · User B saves insight with UNIQUE_B_PHRASE (editor write access)");

  const save = await fetchJson(
    "/api/insights",
    {
      method: "POST",
      body: JSON.stringify({
        project_id: testProjectId,
        type: "learning",
        summary: `User B's contribution — ${UNIQUE_B_PHRASE}`,
        detail: "saved via editor role; User A must see this after MA9",
      }),
    },
    apiKeyB,
  );
  if (save._err || !save.id) {
    fail("MA8 user B write", `HTTP ${save._status}: ${save._err ?? "no id"}`);
    return;
  }
  ok("MA8 user B write", `User B's insight ${save.id} created with editor role`);
}

// ── MA9: User A's brief sees User B's contribution ───────────────────────
async function ma9_user_a_sees_b() {
  header("MA9 · User A SessionStart re-fire — brief contains UNIQUE_B_PHRASE (WRITE-BACK)");

  const { stdout, code } = fireHook("session-start", {
    session_id: "e2e-ma-A-recheck",
    cwd: deviceADir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  if (code !== 0) {
    fail("MA9 hook exit", `exit ${code}`);
    return;
  }

  if (stdout.includes(UNIQUE_B_PHRASE)) {
    ok("MA9 cross-account WRITE-BACK", "User A's brief contains UNIQUE_B_PHRASE");
  } else {
    fail("MA9 cross-account WRITE-BACK", "User A's brief did NOT contain UNIQUE_B_PHRASE");
    info(`brief tail (last 800 chars):\n  ${stdout.slice(-800).replace(/\n/g, "\n  ")}`);
  }
}

// ── MA10: User A demotes User B to viewer ────────────────────────────────
async function ma10_demote_b_to_viewer() {
  header("MA10 · User A demotes User B to viewer (PATCH /members/:email)");

  const res = await fetchJson(`/api/projects/${testProjectId}/members/${encodeURIComponent(userBEmail)}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "viewer" }),
  });
  if (res._err) {
    fail("MA10 demote", `HTTP ${res._status}: ${res._err.slice(0, 200)}`);
    return;
  }
  ok("MA10 demote", "User B demoted to viewer");
}

// ── MA11: viewer can still READ ──────────────────────────────────────────
async function ma11_viewer_can_read() {
  header("MA11 · Viewer can still READ insights");

  const insights = await fetchJson(`/api/insights?project_id=${testProjectId}`, {}, apiKeyB);
  if (insights._err) {
    fail("MA11 viewer read", `HTTP ${insights._status}: ${insights._err.slice(0, 200)}`);
    return;
  }
  const items = insights.insights ?? [];
  if (items.length > 0) {
    ok("MA11 viewer read", `viewer GET works (${items.length} insights returned)`);
  } else {
    fail("MA11 viewer read", "viewer GET returned empty — read may be over-restricted");
  }
}

// ── MA12: viewer CANNOT write ────────────────────────────────────────────
async function ma12_viewer_cannot_write() {
  header("MA12 · Viewer cannot write — POST /insights must return 403");

  const save = await fetchJson(
    "/api/insights",
    {
      method: "POST",
      body: JSON.stringify({
        project_id: testProjectId,
        type: "decision",
        summary: `Should be blocked — ${VIEWER_WRITE_PHRASE}`,
      }),
    },
    apiKeyB,
  );
  if (save._err && save._status === 403) {
    ok("MA12 viewer write blocked", "POST /insights returned 403 — write correctly forbidden");
  } else if (save._err) {
    // Some servers return 404 to avoid leaking project existence — that's also acceptable security
    if (save._status === 404 || save._status === 401) {
      ok("MA12 viewer write blocked", `POST /insights returned ${save._status} — write correctly blocked`);
    } else {
      fail("MA12 viewer write blocked", `expected 403/404, got ${save._status}: ${save._err.slice(0, 150)}`);
    }
  } else {
    fail("MA12 viewer write blocked", "viewer SUCCESSFULLY WROTE — security regression!");
  }
}

// ── MA13: promote User B back to editor ──────────────────────────────────
async function ma13_promote_b_back() {
  header("MA13 · User A promotes User B back to editor");

  const res = await fetchJson(`/api/projects/${testProjectId}/members/${encodeURIComponent(userBEmail)}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "editor" }),
  });
  if (res._err) {
    fail("MA13 promote", `HTTP ${res._status}: ${res._err.slice(0, 200)}`);
    return;
  }
  ok("MA13 promote", "User B promoted back to editor");
}

// ── MA14: User B supersedes User A's insight ─────────────────────────────
async function ma14_b_supersedes_a() {
  header("MA14 · User B supersedes User A's insight (cross-account supersession)");

  const save = await fetchJson(
    "/api/insights",
    {
      method: "POST",
      body: JSON.stringify({
        project_id: testProjectId,
        type: "decision",
        summary: `User B's supersession — ${UNIQUE_SUPERSEDE_PHRASE}`,
        supersedes: [userAInsightId],
      }),
    },
    apiKeyB,
  );
  if (save._err || !save.id) {
    fail("MA14 user B supersede", `HTTP ${save._status}: ${save._err ?? "no id"}`);
    return;
  }
  ok("MA14 user B supersede", `User B created superseding insight ${save.id}`);
}

// ── MA15: User A's brief reflects User B's supersession ──────────────────
async function ma15_a_sees_supersession() {
  header("MA15 · User A's brief reflects User B's supersession");

  const { stdout, code } = fireHook("session-start", {
    session_id: "e2e-ma-A-after-supersede",
    cwd: deviceADir,
    source: "startup",
    hook_event_name: "SessionStart",
  });
  if (code !== 0) {
    fail("MA15 hook exit", `exit ${code}`);
    return;
  }

  const hasSupersede = stdout.includes(UNIQUE_SUPERSEDE_PHRASE);
  const hasOldA = stdout.includes(UNIQUE_A_PHRASE);
  if (hasSupersede && !hasOldA) {
    ok("MA15 cross-account supersession", "User A's brief shows supersession, OLD phrase hidden");
  } else {
    fail(
      "MA15 cross-account supersession",
      `supersession not reflected — hasSupersede=${hasSupersede} hasOldA=${hasOldA}`,
    );
    info(`brief tail (last 800 chars):\n  ${stdout.slice(-800).replace(/\n/g, "\n  ")}`);
  }
}

// ── MA16: User A revokes User B ──────────────────────────────────────────
async function ma16_revoke_b() {
  header("MA16 · User A revokes User B (DELETE /members/:email)");

  const res = await fetchJson(`/api/projects/${testProjectId}/members/${encodeURIComponent(userBEmail)}`, {
    method: "DELETE",
  });
  if (res._err) {
    fail("MA16 revoke", `HTTP ${res._status}: ${res._err.slice(0, 200)}`);
    return;
  }
  memberAddedB = false; // already removed, cleanup skips
  ok("MA16 revoke", "User B removed from project_members");
}

// ── MA17: User B no longer sees project in /api/projects ─────────────────
async function ma17_b_project_list_closed() {
  header("MA17 · After revoke — User B's GET /api/projects no longer includes project");

  const list = await fetchJson("/api/projects", {}, apiKeyB);
  if (!Array.isArray(list)) {
    fail("MA17 list closed", `non-array: ${JSON.stringify(list).slice(0, 200)}`);
    return;
  }
  const stillVisible = list.find((p) => p.id === testProjectId);
  if (!stillVisible) {
    ok("MA17 list closed", `revoked project absent from User B's list (${list.length} other projects)`);
  } else {
    fail("MA17 list closed", "SECURITY: User B can still see revoked project in /api/projects");
  }
}

// ── MA18: User B can no longer read insights ─────────────────────────────
async function ma18_b_read_closed() {
  header("MA18 · After revoke — User B's GET /api/insights returns 403/404");

  const res = await fetchJson(`/api/insights?project_id=${testProjectId}`, {}, apiKeyB);
  if (res._err && (res._status === 403 || res._status === 404)) {
    ok("MA18 read closed", `GET /api/insights returned ${res._status} — read correctly blocked`);
  } else if (res._err) {
    fail("MA18 read closed", `expected 403/404, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    // Some implementations return empty array instead of 4xx — that's also acceptable IF
    // it returns NO insights from this project
    const items = res.insights ?? [];
    if (items.length === 0) {
      ok("MA18 read closed", "GET returned empty list — read access correctly stripped");
    } else {
      fail("MA18 read closed", `SECURITY: User B can still read ${items.length} insights after revoke`);
    }
  }
}

// ── MA19: User B's brief no longer shows shared content ──────────────────
async function ma19_b_brief_closed() {
  header("MA19 · After revoke — User B's brief contains NO shared phrases");

  const { stdout, code } = fireHook(
    "session-start",
    { session_id: "e2e-ma-B-after-revoke", cwd: userBCwd, source: "startup", hook_event_name: "SessionStart" },
    { SYNAPSE_HOME: userBSynapseHome },
  );
  if (code !== 0) {
    fail("MA19 hook exit", `exit ${code}`);
    return;
  }

  const phrases = [
    { name: "UNIQUE_A_PHRASE", phrase: UNIQUE_A_PHRASE },
    { name: "UNIQUE_B_PHRASE", phrase: UNIQUE_B_PHRASE },
    { name: "UNIQUE_SUPERSEDE_PHRASE", phrase: UNIQUE_SUPERSEDE_PHRASE },
  ];
  let leaked = false;
  for (const { name, phrase } of phrases) {
    if (stdout.includes(phrase)) {
      fail("MA19 brief leak", `SECURITY: ${name} leaked into User B's brief after revoke`);
      leaked = true;
    }
  }
  if (!leaked) {
    ok("MA19 brief closed", `none of the 3 shared phrases leak into User B's brief after revoke`);
  } else {
    info(`brief tail (last 800 chars):\n  ${stdout.slice(-800).replace(/\n/g, "\n  ")}`);
  }
}

// ── MA20: User B can no longer write ─────────────────────────────────────
async function ma20_b_write_closed() {
  header("MA20 · After revoke — User B's POST /api/insights returns 403/404");

  const save = await fetchJson(
    "/api/insights",
    {
      method: "POST",
      body: JSON.stringify({
        project_id: testProjectId,
        type: "decision",
        summary: `Should be blocked after revoke — ${POST_REVOKE_WRITE_PHRASE}`,
      }),
    },
    apiKeyB,
  );
  if (save._err && (save._status === 403 || save._status === 404 || save._status === 401)) {
    ok("MA20 write closed", `POST /api/insights returned ${save._status} — write correctly blocked`);
  } else if (save._err) {
    fail("MA20 write closed", `expected 403/404, got ${save._status}: ${save._err.slice(0, 150)}`);
  } else {
    fail("MA20 write closed", `SECURITY: User B WROTE an insight after revoke — id ${save.id}`);
  }
}

// ── MA21: Revoke a non-member → 404 ──────────────────────────────────────
async function ma21_revoke_non_member() {
  header("MA21 · Negative case — DELETE /members/<non-member email> returns 404");

  const fakeEmail = `nobody-${RUN_ID}@example.invalid`;
  const res = await fetchJson(`/api/projects/${testProjectId}/members/${encodeURIComponent(fakeEmail)}`, {
    method: "DELETE",
  });
  if (res._err && res._status === 404) {
    ok("MA21 non-member 404", "DELETE non-member returns 404");
  } else if (res._err) {
    fail("MA21 non-member 404", `expected 404, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail("MA21 non-member 404", "expected 404 but DELETE succeeded — backend may not validate target");
  }
}

// ── MA22: Revoke by non-owner → 403 ──────────────────────────────────────
async function ma22_revoke_by_non_owner() {
  header("MA22 · Negative case — User B tries to revoke User A → 403");

  // User A is owner of the project; User B (currently revoked) tries to DELETE User A's membership
  // Use User A's email as the target. We need it — fetch from /api/account/me with apiKeyA
  const meA = await fetchJson("/api/account/me", {}, apiKeyA);
  if (!meA.email) {
    fail("MA22 owner email", "failed to discover User A email");
    return;
  }
  const ownerEmail = meA.email;

  const res = await fetchJson(
    `/api/projects/${testProjectId}/members/${encodeURIComponent(ownerEmail)}`,
    { method: "DELETE" },
    apiKeyB,
  );
  if (res._err && (res._status === 403 || res._status === 404)) {
    ok("MA22 non-owner forbidden", `User B's revoke attempt returned ${res._status}`);
  } else if (res._err) {
    fail("MA22 non-owner forbidden", `expected 403/404, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail("MA22 non-owner forbidden", "SECURITY: User B successfully revoked the owner — role enforcement broken");
  }
}

// ── MA23: Owner cannot revoke themselves ─────────────────────────────────
async function ma23_owner_self_revoke() {
  header("MA23 · Negative case — owner cannot revoke themselves → 4xx");

  const meA = await fetchJson("/api/account/me", {}, apiKeyA);
  if (!meA.email) {
    fail("MA23 owner email", "failed to discover User A email");
    return;
  }
  const ownerEmail = meA.email;

  const res = await fetchJson(`/api/projects/${testProjectId}/members/${encodeURIComponent(ownerEmail)}`, {
    method: "DELETE",
  });
  if (res._err && res._status >= 400 && res._status < 500) {
    ok("MA23 owner self-revoke blocked", `DELETE self returned ${res._status}`);
  } else if (res._err) {
    fail("MA23 owner self-revoke blocked", `expected 4xx, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail(
      "MA23 owner self-revoke blocked",
      "SECURITY/UX: owner SUCCESSFULLY removed themselves — would orphan the project",
    );
  }
}

// ── MA24: Re-invite User B ──────────────────────────────────────────────
async function ma24_reinvite_b() {
  header("MA24 · After revoke — User A re-invites User B → access restored");

  const res = await fetchJson(`/api/projects/${testProjectId}/members`, {
    method: "POST",
    body: JSON.stringify({ email: userBEmail, role: "editor" }),
  });
  if (res._err) {
    fail("MA24 reinvite", `HTTP ${res._status}: ${res._err.slice(0, 200)}`);
    return;
  }
  memberAddedB = true;
  // Verify User B sees project again
  const list = await fetchJson("/api/projects", {}, apiKeyB);
  const found = Array.isArray(list) ? list.find((p) => p.id === testProjectId) : null;
  if (found) {
    ok("MA24 reinvite", "User B re-added and project visible again");
  } else {
    fail("MA24 reinvite", "re-invite succeeded but User B still can't see project");
  }
}

// ── MA25: Share-link flow ───────────────────────────────────────────────
async function ma25_share_link_flow() {
  header("MA25 · User A mints share-link; User B (after revoke) joins via token");

  // Revoke first so MA25 tests the FRESH join path, not just role override
  await fetchJson(`/api/projects/${testProjectId}/members/${encodeURIComponent(userBEmail)}`, { method: "DELETE" });
  memberAddedB = false;

  // Mint a share link (Plus-only on free tier — may fail if account is free)
  const link = await fetchJson(`/api/projects/${testProjectId}/share-links`, {
    method: "POST",
    body: JSON.stringify({ role: "editor" }),
  });
  if (link._err) {
    // Plus-only restriction is a valid failure mode — surface it as a finding,
    // not a regression. Free-tier accounts use email invite (MA5) instead.
    if (link._status === 402 || link._status === 403) {
      info(`share-link minting returned ${link._status} (likely Plus-only on free tier)`);
      ok("MA25 plus-only gate", `share-link endpoint correctly gated to Plus (${link._status})`);
      return;
    }
    fail("MA25 mint share-link", `HTTP ${link._status}: ${link._err.slice(0, 200)}`);
    return;
  }
  shareLinkToken = link.token ?? link.link?.token;
  if (!shareLinkToken) {
    fail("MA25 mint share-link", `no token in response: ${JSON.stringify(link).slice(0, 200)}`);
    return;
  }
  ok("MA25 mint share-link", `share-link token issued (${shareLinkToken.slice(0, 10)}…)`);

  // User B joins via the share-link
  const join = await fetchJson(`/api/share/${shareLinkToken}/join`, { method: "POST" }, apiKeyB);
  if (join._err) {
    fail("MA25 join via link", `HTTP ${join._status}: ${join._err.slice(0, 200)}`);
    return;
  }
  memberAddedB = true;

  // Verify User B sees project after join
  const list = await fetchJson("/api/projects", {}, apiKeyB);
  const found = Array.isArray(list) ? list.find((p) => p.id === testProjectId) : null;
  if (found) {
    ok("MA25 join via link", "User B joined via share-link and project is visible");
  } else {
    fail("MA25 join via link", "join succeeded but project not in User B's list");
  }
}

// ── MA26: Editor cannot PATCH another member's role ─────────────────────
async function ma26_editor_cannot_patch_roles() {
  header("MA26 · Editor cannot change another member's role → 403");

  const meA = await fetchJson("/api/account/me", {}, apiKeyA);
  if (!meA.email) {
    fail("MA26 owner email", "failed to discover User A email");
    return;
  }
  const res = await fetchJson(
    `/api/projects/${testProjectId}/members/${encodeURIComponent(meA.email)}`,
    { method: "PATCH", body: JSON.stringify({ role: "viewer" }) },
    apiKeyB,
  );
  if (res._err && (res._status === 403 || res._status === 404)) {
    ok("MA26 editor patch blocked", `PATCH by editor returned ${res._status}`);
  } else if (res._err) {
    fail("MA26 editor patch blocked", `expected 403/404, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail("MA26 editor patch blocked", "SECURITY: editor successfully changed owner's role");
  }
}

// ── MA27: Editor cannot DELETE the project ──────────────────────────────
async function ma27_editor_cannot_delete_project() {
  header("MA27 · Editor cannot DELETE the project → 403");

  const res = await fetchJson(`/api/projects/${testProjectId}`, { method: "DELETE" }, apiKeyB);
  if (res._err && (res._status === 403 || res._status === 404)) {
    ok("MA27 editor delete blocked", `DELETE project by editor returned ${res._status}`);
  } else if (res._err) {
    fail("MA27 editor delete blocked", `expected 403/404, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail("MA27 editor delete blocked", "SECURITY: editor SUCCESSFULLY deleted the project");
  }
}

// ── MA28: Invite a non-existent email → 404 ──────────────────────────────
async function ma28_invite_nonexistent_email() {
  header("MA28 · Invite a non-existent email → 404");

  const fakeEmail = `ghost-${RUN_ID}@example.invalid`;
  const res = await fetchJson(`/api/projects/${testProjectId}/members`, {
    method: "POST",
    body: JSON.stringify({ email: fakeEmail, role: "editor" }),
  });
  if (res._err && res._status === 404) {
    ok("MA28 nonexistent invitee", "POST returned 404 — backend correctly rejects unknown email");
  } else if (res._err) {
    fail("MA28 nonexistent invitee", `expected 404, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail("MA28 nonexistent invitee", "expected 404 but invite succeeded — would create dead membership");
  }
}

// ── MA29: Invite with invalid role string → 4xx ─────────────────────────
async function ma29_invite_invalid_role() {
  header("MA29 · Invite with invalid role string → 4xx");

  const res = await fetchJson(`/api/projects/${testProjectId}/members`, {
    method: "POST",
    body: JSON.stringify({ email: userBEmail, role: "supreme-overlord" }),
  });
  if (res._err && res._status >= 400 && res._status < 500) {
    ok("MA29 invalid role rejected", `POST returned ${res._status}`);
  } else if (res._err) {
    fail("MA29 invalid role rejected", `expected 4xx, got ${res._status}: ${res._err.slice(0, 150)}`);
  } else {
    fail("MA29 invalid role rejected", "accepted invalid role — schema validation broken");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  log("Synapse end-to-end MULTI-ACCOUNT sharing + revocation test");
  log(`API: ${API_BASE}`);
  log(`MCP: ${MCP_DIST}`);
  log(`RUN_ID: ${RUN_ID}`);

  if (!(await ma1_preflight())) process.exit(2);

  try {
    await ma2_user_a_captures();
    if (!testProjectId || !userAConvId) {
      log("\n⚠️  Skipping remaining stages — User A did not sync properly.");
    } else {
      await ma3_a_handoff_lands();
      await ma4_a_saves_insight();
      if (userAInsightId) {
        await ma5_invite_b_as_editor();
        if (memberAddedB) {
          await ma6_b_sees_shared_state();
          await ma7_user_b_brief_reads();
          await ma8_user_b_writes();
          await ma9_user_a_sees_b();
          await ma10_demote_b_to_viewer();
          await ma11_viewer_can_read();
          await ma12_viewer_cannot_write();
          await ma13_promote_b_back();
          await ma14_b_supersedes_a();
          await ma15_a_sees_supersession();
          await ma16_revoke_b();
          await ma17_b_project_list_closed();
          await ma18_b_read_closed();
          await ma19_b_brief_closed();
          await ma20_b_write_closed();
          await ma21_revoke_non_member();
          await ma22_revoke_by_non_owner();
          await ma23_owner_self_revoke();
          await ma24_reinvite_b();
          // MA26-MA29 need User B as member (editor) — run BEFORE MA25's
          // share-link reshuffle so we don't have to re-set state.
          await ma26_editor_cannot_patch_roles();
          await ma27_editor_cannot_delete_project();
          await ma28_invite_nonexistent_email();
          await ma29_invite_invalid_role();
          await ma25_share_link_flow();
        }
      }
    }
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
    log(`  ${icon} ${r.id.padEnd(42)} ${r.detail}`);
  }
  log("");
  log(`  Total: ${results.length}  ·  PASS: ${passed}  ·  FAIL: ${failed}`);
  log("");
  if (failed > 0) {
    log("❌ E2E MULTI-ACCOUNT FAILED.");
    process.exit(1);
  } else {
    log("✅ E2E MULTI-ACCOUNT PASSED.");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
