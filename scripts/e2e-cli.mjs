#!/usr/bin/env node
// scripts/e2e-cli.mjs
//
// DETERMINISTIC CLI CONTRACT TEST.
//
// Audits every `synapsesync` CLI command: that it's a valid (registered)
// command, that it does what its --help line claims, that it actually does
// it, and that edge cases degrade gracefully. Unlike the other e2e suites
// (live daemon + claude -p), this one is fully DETERMINISTIC and REPEATABLE:
// every command runs in a throwaway sandbox HOME + SYNAPSE_HOME, so it never
// touches the user's real config, daemon, or ~/.synapse.
//
// ── ISOLATION MODEL (see the two CLI-audit insights in Synapse) ───────────
//   HOME=<sandbox>            → editor configs, init writes, daemon pidfile,
//                               sessions, detectExistingSetup, globalConfigDir
//   SYNAPSE_HOME=<sandbox>/.synapse → events/cache/config.json/project-map,
//                               status/doctor, identity
//   cwd=<sandbox>             → cwd .mcp.json discovery + .mcp.json/.gitignore writes
//   NO_COLOR=1                → strip theme colour for clean assertions
//   Key injection differs by command family:
//     • config.json (direct-fetch family: invite/move/purge/daemon + identity)
//     • <HOME>/.mcp.json mcpServers.synapse.env.SYNAPSE_API_KEY (detect/clack
//       family: whoami/stats/tree/refresh/reset/upgrade/uninstall)
//
// ── SAFETY (hazards that env CANNOT isolate) ──────────────────────────────
//   • checkSupervisor() shells to launchctl and sees the REAL daemon → we
//     never assert daemon up/down from status/doctor/capture status.
//   • capture stop / uninstall-confirm would process.kill the real daemon →
//     NEVER run them past the confirmation. We test guard/cancel paths only.
//   • reset/refresh/upgrade/move happy paths mutate the real backend → we
//     test only their no-key / guard edges. Their happy paths are SKIPPED
//     (logged) on purpose.
//   • init does a live read-only fetchMe(/me) with the real key, then writes
//     to the sandbox only (we always pass --skip-service).
//
// REQUIRES: built mcp/dist (cd mcp && npm run build), a real API key in
// ~/.synapse/config.json (used READ-ONLY for whoami/tree/stats/purge-dry/init).
// No claude CLI, no live daemon needed. Wall time: ~20-40s. Cost: ~$0.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { sweepArtifacts } from "./e2e-cleanup.mjs";

// ── Config ────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MCP_DIST = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const RUN = Date.now();

// ── State ───────────────────────────────────────────────────────────────
const results = [];
let ROOT = null;
let REAL_KEY = null;
const sb = {}; // named sandbox dirs

// ── Output ──────────────────────────────────────────────────────────────
const log = (m) => process.stdout.write(`${m}\n`);
function header(s) {
  log("\n════════════════════════════════════════════════════════════════════");
  log(s);
  log("════════════════════════════════════════════════════════════════════");
}
function ok(id, detail) {
  results.push({ id, status: "PASS", detail });
  log(`  ✅ ${id} — ${detail}`);
}
function fail(id, detail) {
  results.push({ id, status: "FAIL", detail });
  log(`  ❌ ${id} — ${detail}`);
}
function skip(id, why) {
  results.push({ id, status: "SKIP", detail: why });
  log(`  ⊘ ${id} — SKIPPED: ${why}`);
}
const info = (m) => log(`     · ${m}`);

// ── Assertion helpers ─────────────────────────────────────────────────────
const stripAnsi = (s) => (s ?? "").replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

// Assert a single expectation; returns boolean and records pass/fail.
function expect(id, cond, detail) {
  if (cond) ok(id, detail);
  else fail(id, detail);
  return cond;
}

function runCli(args, opts = {}) {
  const home = opts.home ?? sb.empty;
  const env = { ...process.env };
  env.SYNAPSE_API_KEY = undefined; // never leak the caller's key
  env.SYNAPSE_TEST_PROJECT_ID = undefined;
  env.HOME = home;
  env.SYNAPSE_HOME = opts.synapseHome ?? path.join(home, ".synapse");
  env.NO_COLOR = "1";
  if (opts.key) env.SYNAPSE_API_KEY = opts.key;
  if (opts.projectId) env.SYNAPSE_TEST_PROJECT_ID = opts.projectId;
  if (opts.env) Object.assign(env, opts.env);

  const r = spawnSync(process.execPath, [MCP_DIST, ...args], {
    cwd: opts.cwd ?? home,
    env,
    input: opts.stdin ?? "", // empty stdin EOFs → clack prompts cancel; non-TTY
    encoding: "utf-8",
    timeout: opts.timeout ?? 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = stripAnsi(r.stdout);
  const stderr = stripAnsi(r.stderr);
  return { code: r.status, signal: r.signal, stdout, stderr, all: `${stdout}\n${stderr}` };
}

function eventsFor(home, projectId) {
  const p = path.join(home, ".synapse", "projects", projectId, "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { __unparseable: l };
      }
    });
}

// ── Sandbox setup ─────────────────────────────────────────────────────────
function freshDir(name) {
  const d = path.join(ROOT, name);
  mkdirSync(path.join(d, ".synapse"), { recursive: true });
  sb[name] = d;
  return d;
}
function plantKey(home, key) {
  // direct-fetch family + identity
  writeFileSync(
    path.join(home, ".synapse", "config.json"),
    JSON.stringify({ api_key: key, user_id: "cli-e2e-user", email: "cli-e2e@test.local" }, null, 2),
  );
  // detect/clack family reads cwd .mcp.json → mcpServers.synapse.env.SYNAPSE_API_KEY
  writeFileSync(
    path.join(home, ".mcp.json"),
    JSON.stringify(
      { mcpServers: { synapse: { command: "node", args: [MCP_DIST], env: { SYNAPSE_API_KEY: key } } } },
      null,
      2,
    ),
  );
}

function preflight() {
  header("PREFLIGHT");
  if (!existsSync(MCP_DIST)) {
    fail("preflight.dist", "mcp/dist not built — run: cd mcp && npm run build");
    return false;
  }
  info(`MCP dist: ${MCP_DIST}`);
  try {
    const cfg = JSON.parse(readFileSync(path.join(homedir(), ".synapse", "config.json"), "utf-8"));
    REAL_KEY = cfg.api_key ?? null;
  } catch {
    /* no real config */
  }
  if (!REAL_KEY) {
    fail("preflight.key", "no API key in ~/.synapse/config.json (needed for read-only backend assertions)");
    return false;
  }
  info(`real key (read-only use): ${REAL_KEY.slice(0, 8)}…`);

  ROOT = mkdtempSync(path.join(tmpdir(), `synapse-cli-e2e-${RUN}-`));
  freshDir("empty"); // no key
  freshDir("keyed"); // real key planted
  freshDir("local"); // local handoff/issue writes (no key)
  freshDir("brief"); // brief cache cases
  freshDir("doctor"); // doctor cases incl. corrupt
  freshDir("init"); // init happy path target
  plantKey(sb.keyed, REAL_KEY);
  info(`sandbox root: ${ROOT}`);
  ok("preflight", "dist built, key resolved, sandboxes created");
  return true;
}

// ── 1. Help / version / dispatch ──────────────────────────────────────────
function section_dispatch() {
  header("1 · HELP / VERSION / DISPATCH");

  for (const flag of ["--help", "-h", "help"]) {
    const r = runCli([flag]);
    expect(
      `dispatch.help(${flag})`,
      r.code === 0 && r.all.includes("synapsesync") && r.all.includes("wizard") && r.all.includes("Capture sessions"),
      `\`${flag}\` → exit 0 + banner + command list (got exit ${r.code})`,
    );
  }

  for (const flag of ["--version", "-v"]) {
    const r = runCli([flag]);
    expect(
      `dispatch.version(${flag})`,
      r.code === 0 && /^\d+\.\d+\.\d+\s*$/.test(r.stdout.trim()),
      `\`${flag}\` → exit 0 + semver (got "${r.stdout.trim()}" exit ${r.code})`,
    );
  }

  const unknownCmd = runCli(["frobnicate-xyz"]);
  expect(
    "dispatch.unknownCommand",
    unknownCmd.code === 1 && unknownCmd.all.includes("Unknown command: frobnicate-xyz"),
    `unknown command → exit 1 + "Unknown command: …" (got exit ${unknownCmd.code})`,
  );

  const unknownOpt = runCli(["--frobnicate"]);
  expect(
    "dispatch.unknownOption",
    unknownOpt.code === 1 && unknownOpt.all.includes("Unknown option: --frobnicate"),
    `unknown option → exit 1 + "Unknown option: …" (got exit ${unknownOpt.code})`,
  );

  // No args + non-TTY + no key → MCP-server mode requires a key → exit 1.
  const noArgs = runCli([], { timeout: 10_000 });
  expect(
    "dispatch.noArgsNoKey",
    noArgs.code === 1 && noArgs.all.includes("SYNAPSE_API_KEY is required"),
    `no args, no key → MCP-mode rejects → exit 1 (got exit ${noArgs.code}, signal ${noArgs.signal})`,
  );
}

// ── 2. Local handoff write commands (no key; pinned project) ───────────────
function section_local_writes() {
  header("2 · HANDOFF-LAYER WRITE COMMANDS (local, no key)");
  const PID = "cli-e2e-local";
  const home = sb.local;
  const run = (args, extra = {}) => runCli(args, { home, projectId: PID, ...extra });
  let expected = 0;
  const count = () => eventsFor(home, PID).length;

  // handoff
  let r = run(["handoff", "ship the cli e2e suite"]);
  expected++;
  expect(
    "handoff.write",
    r.code === 0 &&
      count() === expected &&
      JSON.stringify(eventsFor(home, PID).at(-1)).includes("ship the cli e2e suite"),
    `handoff "<text>" → exit 0 + 1 event w/ text (events=${count()})`,
  );

  r = run(["handoff"]);
  expect(
    "handoff.missingText",
    r.code === 1 && r.all.includes("usage: synapse handoff") && count() === expected,
    `handoff (no text) → exit 1 + usage, no new event (got exit ${r.code})`,
  );

  // set-focus
  r = run(["set-focus", "auditing the cli"]);
  expected++;
  expect(
    "setFocus.write",
    r.code === 0 && count() === expected && JSON.stringify(eventsFor(home, PID).at(-1)).includes("auditing the cli"),
    `set-focus "<text>" → exit 0 + event (events=${count()})`,
  );
  r = run(["set-focus"]);
  expect(
    "setFocus.missing",
    r.code === 1 && r.all.includes("usage: synapse set-focus"),
    "set-focus (empty) → exit 1 usage",
  );

  // note
  r = run(["note", "--target", "session:abc123", "a contextual note"]);
  expected++;
  {
    const ev = JSON.stringify(eventsFor(home, PID).at(-1));
    expect(
      "note.write",
      r.code === 0 && count() === expected && ev.includes("a contextual note") && ev.includes("session:abc123"),
      `note --target <ref> "<text>" → exit 0 + event w/ target+text`,
    );
  }
  r = run(["note", "missing target flag"]);
  expect(
    "note.missingTarget",
    r.code === 1 && r.all.includes("usage: synapse note --target"),
    "note (no --target) → exit 1 usage",
  );

  // issue create (+ capture id)
  r = run(["issue", "create", "--kind", "decision", "--title", "Adopt Tier-0 resolver", "--body", "see ADR"]);
  expected++;
  let issueId = null;
  {
    const ev = eventsFor(home, PID).at(-1);
    const m = JSON.stringify(ev).match(/iss_[0-9a-f]{12}/);
    issueId = m ? m[0] : null;
    expect(
      "issueCreate.decision",
      r.code === 0 && count() === expected && JSON.stringify(ev).includes("Adopt Tier-0 resolver") && !!issueId,
      `issue create --kind decision → exit 0 + event w/ id ${issueId ?? "(none found!)"}`,
    );
  }
  r = run(["issue", "create", "--kind", "question", "--title", "Rate limit policy?"]);
  expected++;
  expect(
    "issueCreate.question",
    r.code === 0 && count() === expected,
    "issue create --kind question (no body) → exit 0",
  );

  r = run(["issue", "create", "--kind", "blocker", "--title", "X"]);
  expect(
    "issueCreate.badKind",
    r.code === 1 && r.all.includes("decision") && r.all.includes("question") && count() === expected,
    `issue create --kind blocker → exit 1 + lists valid kinds (got exit ${r.code})`,
  );
  r = run(["issue", "create", "--title", "no kind"]);
  expect(
    "issueCreate.missingKind",
    r.code === 1 && r.all.includes("usage: synapse issue create"),
    "issue create (no --kind) → exit 1 usage",
  );

  // issue resolve
  if (issueId) {
    r = run(["issue", "resolve", issueId, "resolved via tier-0 fix"]);
    expected++;
    expect(
      "issueResolve.ok",
      r.code === 0 &&
        count() === expected &&
        JSON.stringify(eventsFor(home, PID).at(-1)).includes("resolved via tier-0 fix"),
      `issue resolve <id> "<res>" → exit 0 + event`,
    );
  } else {
    fail("issueResolve.ok", "no issue id captured from create — cannot test resolve");
  }
  r = run(["issue", "resolve", "iss_onlyone"]);
  expect(
    "issueResolve.missingRes",
    r.code === 1 && r.all.includes("usage: synapse issue resolve"),
    "issue resolve <id> (no resolution) → exit 1 usage",
  );

  // issue supersede
  r = run(["issue", "supersede", "iss_old00000000", "--by", "iss_new00000000"]);
  expected++;
  expect(
    "issueSupersede.ok",
    r.code === 0 && count() === expected && JSON.stringify(eventsFor(home, PID).at(-1)).includes("iss_new00000000"),
    "issue supersede <id> --by <new> → exit 0 + event",
  );
  r = run(["issue", "supersede", "iss_x"]);
  expect(
    "issueSupersede.missingBy",
    r.code === 1 && r.all.includes("usage: synapse issue supersede"),
    "issue supersede <id> (no --by) → exit 1 usage",
  );

  // issue unknown sub
  r = run(["issue", "frobnicate"]);
  expect(
    "issue.unknownSub",
    r.code === 1 && r.all.includes("unknown issue subcommand: frobnicate"),
    "issue <bad-sub> → exit 1",
  );
  r = run(["issue"]);
  expect("issue.missingSub", r.code === 1 && r.all.includes("unknown issue subcommand"), "issue (no sub) → exit 1");

  info(`local events.jsonl accumulated ${count()} events (expected ${expected})`);
}

// ── 3. brief (local read; corrupt-cache robustness) ────────────────────────
function section_brief() {
  header("3 · BRIEF (local cache render)");
  const home = sb.brief;

  // no cache
  let r = runCli(["brief"], { home, projectId: "brief-empty" });
  expect(
    "brief.noCache",
    r.code === 0 && r.all.includes("Project: brief-empty") && r.all.includes("no cached context yet"),
    `brief (no cache) → exit 0 + "(no cached context yet…)"`,
  );

  // valid cache
  const validDir = path.join(home, ".synapse", "projects", "brief-valid", "cache");
  mkdirSync(validDir, { recursive: true });
  writeFileSync(
    path.join(validDir, "project_status.json"),
    JSON.stringify({
      project_id: "brief-valid",
      current_next_step: { text: "wire cli e2e into the gate", inferred: false, set_by: { user_id: "cli-e2e-user" } },
      active_actors: [],
      open_subtasks: [],
      open_issues: { questions: [] },
    }),
  );
  r = runCli(["brief"], { home, projectId: "brief-valid" });
  expect(
    "brief.validCache",
    r.code === 0 && r.all.includes("Next step") && r.all.includes("wire cli e2e into the gate"),
    "brief (valid cache) → exit 0 + renders Next step",
  );

  // corrupt cache — MUST degrade gracefully, not crash (BUG: unguarded JSON.parse)
  const corruptDir = path.join(home, ".synapse", "projects", "brief-corrupt", "cache");
  mkdirSync(corruptDir, { recursive: true });
  writeFileSync(path.join(corruptDir, "project_status.json"), "{ this is not valid json ]]]");
  r = runCli(["brief"], { home, projectId: "brief-corrupt" });
  expect(
    "brief.corruptCache",
    r.code === 0,
    `brief (corrupt cache) → must NOT crash (exit ${r.code}; want 0) — graceful degradation`,
  );
}

// ── 4. status / doctor (local; daemon line not asserted) ───────────────────
function section_status_doctor() {
  header("4 · STATUS / DOCTOR (local)");

  // status: structural only (daemon line reflects the REAL launchd daemon — not isolatable)
  let r = runCli(["status"], { home: sb.empty });
  expect(
    "status.shape",
    r.code === 0 && /Projects tracked: \d+\./.test(r.all),
    `status → exit 0 + "Projects tracked: N." (got exit ${r.code})`,
  );

  // doctor on a clean sandbox
  r = runCli(["doctor"], { home: sb.doctor });
  const trackedMatches = (r.all.match(/Projects tracked/g) || []).length;
  expect("doctor.exit", r.code === 0, `doctor → exit 0 (got ${r.code})`);
  expect(
    "doctor.noDuplicateCount",
    trackedMatches === 1,
    `doctor prints "Projects tracked" exactly once (got ${trackedMatches}) — BUG if 2`,
  );

  // doctor with a CORRUPT events.jsonl line — MUST NOT crash (BUG: unguarded JSON.parse in countQueued)
  const pdir = path.join(sb.doctor, ".synapse", "projects", "corrupt-proj");
  mkdirSync(pdir, { recursive: true });
  writeFileSync(path.join(pdir, "events.jsonl"), `{"event_id":"01valid"}\nthis-is-not-json\n{"event_id":"02valid"}\n`);
  // A .watermark is required to make countQueued JSON.parse each line (without
  // it the path short-circuits to all.length). This is what actually exercises
  // the unguarded-parse crash.
  writeFileSync(path.join(pdir, ".watermark"), "00basewatermark");
  r = runCli(["doctor"], { home: sb.doctor });
  expect(
    "doctor.corruptEvents",
    r.code === 0 && r.all.includes("corrupt-proj"),
    `doctor (corrupt events.jsonl) → must NOT crash (exit ${r.code}; want 0)`,
  );
}

// ── 5. Backend READ commands (real key, read-only) + no-key edges ──────────
function section_backend_reads() {
  header("5 · BACKEND READ COMMANDS (real key = read-only) + no-key edges");

  // whoami
  let r = runCli(["whoami"], { home: sb.keyed, key: REAL_KEY });
  expect(
    "whoami.ok",
    r.code === 0 && r.all.includes("Email") && r.all.includes("Tier") && r.all.includes("Files"),
    `whoami (keyed) → exit 0 + Email/Tier/Files (got exit ${r.code})`,
  );
  r = runCli(["whoami"], { home: sb.empty });
  expect(
    "whoami.noKey",
    r.code === 1 && r.all.includes("No API key found"),
    `whoami (no key) → exit 1 + "No API key found"`,
  );

  // tree
  r = runCli(["tree"], { home: sb.keyed, key: REAL_KEY });
  expect(
    "tree.ok",
    r.code === 0 && (r.all.includes("files") || r.all.includes("No workspace") || r.all.includes("empty workspace")),
    `tree (keyed) → exit 0 (got exit ${r.code})`,
  );
  r = runCli(["tree"], { home: sb.empty });
  expect("tree.noKey", r.code === 1 && r.all.includes("No API key found"), "tree (no key) → exit 1");

  // stats — REGRESSION GUARD: a WORKING key must NOT be reported "expired"
  r = runCli(["stats"], { home: sb.keyed, key: REAL_KEY });
  expect(
    "stats.workingKeyNotExpired",
    r.code === 0 && !r.all.includes("API key expired or invalid"),
    `stats (working key) → exit 0 + NOT "API key expired or invalid" (got exit ${r.code})`,
  );
  r = runCli(["stats"], { home: sb.empty });
  expect(
    "stats.noKey",
    r.code === 1 && r.all.includes("No API key found"),
    `stats (no key) → exit 1 + "No API key found"`,
  );
}

// ── 6. Destructive backend commands — GUARD / EDGE paths only ──────────────
function section_destructive_guards() {
  header("6 · DESTRUCTIVE COMMAND GUARDS (no happy-path mutation)");

  // reset: no key → must refuse BEFORE any wipe. (Happy path SKIPPED — would wipe the account.)
  let r = runCli(["reset"], { home: sb.empty });
  expect(
    "reset.noKey",
    r.code === 1 && r.all.includes("No API key found"),
    `reset (no key) → exit 1 before any /account/reset (got exit ${r.code})`,
  );
  skip("reset.happy", "would POST /api/account/reset and wipe the real account");

  // refresh: no key → refuse. (Happy path SKIPPED — rotates the real key.)
  r = runCli(["refresh"], { home: sb.empty });
  expect(
    "refresh.noKey",
    r.code === 1 && r.all.includes("No existing API key found"),
    `refresh (no key) → exit 1 (got exit ${r.code})`,
  );
  skip("refresh.happy", "would mint a new key + rewrite configs (rotates the real key)");

  // upgrade: no key → refuse. (Happy path SKIPPED — opens a browser checkout.)
  r = runCli(["upgrade"], { home: sb.empty });
  expect("upgrade.noKey", r.code === 1 && r.all.includes("No API key found"), "upgrade (no key) → exit 1");
  skip("upgrade.happy", "would create a Creem checkout + open a browser");

  // uninstall guard: stdin EOF must NOT remove anything. (Note: checkSupervisor
  // always surfaces the REAL daemon as a "Stop capture daemon" target even under
  // an isolated HOME — so "nothing to do" is unreachable here; the safe, testable
  // promise is that the confirmation guard prevents any removal.)
  r = runCli(["uninstall"], { home: sb.empty, stdin: "" });
  expect(
    "uninstall.guardCancel",
    r.code === 0 && r.all.includes("Found Synapse in these locations") && !r.all.includes("Removed "),
    `uninstall (stdin EOF) → exit 0 + lists targets + removes NOTHING (got exit ${r.code})`,
  );
  skip("uninstall.confirm", "confirming would process.kill the REAL launchd daemon (checkSupervisor leaks it)");
}

// ── 7. Direct-fetch family (move / purge-empty) ────────────────────────────
function section_direct_fetch() {
  header("7 · DIRECT-FETCH FAMILY (move / purge-empty)");

  // move: no key → refuse
  let r = runCli(["move", "11111111-1111-4111-8111-111111111111", "someproject"], { home: sb.empty });
  expect(
    "move.noKey",
    r.code === 1 && r.all.includes("no API key configured"),
    `move <uuid> <proj> (no key) → exit 1 + "no API key configured" (got exit ${r.code})`,
  );
  r = runCli(["move"], { home: sb.empty });
  expect("move.usage", r.code === 1 && r.all.includes("usage: synapsesync move"), "move (no args) → exit 1 usage");
  skip("move.happy", "would POST /conversations/<id>/reassign — mutates the real account");

  // purge-empty: dry-run (no --yes) with real key → lists/▏nothing, deletes NOTHING
  r = runCli(["purge-empty"], { home: sb.keyed, key: REAL_KEY });
  expect(
    "purgeEmpty.dryRun",
    r.code === 0 && (r.all.includes("dry-run") || r.all.includes("nothing to purge")),
    `purge-empty (no --yes) → exit 0 + dry-run/nothing, deletes nothing (got exit ${r.code})`,
  );
  r = runCli(["purge-empty"], { home: sb.empty });
  expect("purgeEmpty.noKey", r.code === 1 && r.all.includes("no API key configured"), "purge-empty (no key) → exit 1");
  skip("purgeEmpty.yes", "--yes would DELETE empty projects on the real account");
}

// ── 8. init / pull-handoff / daemon / capture ──────────────────────────────
function section_setup_and_capture() {
  header("8 · INIT / PULL-HANDOFF / DAEMON / CAPTURE");

  // init: missing key → usage
  let r = runCli(["init"], { home: sb.init });
  expect(
    "init.missingKey",
    r.code === 1 && r.all.includes("usage: synapsesync init --api-key"),
    "init (no --api-key) → exit 1 usage",
  );

  // init: happy path with --skip-service → writes hooks/slash-cmds/config/.mcp.json into the sandbox.
  // fetchMe(/me) is a read-only live call with the real key; all writes are sandboxed.
  r = runCli(["init", "--api-key", REAL_KEY, "--skip-service"], { home: sb.init, timeout: 30_000 });
  const settingsPath = path.join(sb.init, ".claude", "settings.json");
  const cfgPath = path.join(sb.init, ".synapse", "config.json");
  let installedHook = false;
  try {
    installedHook = existsSync(settingsPath) && readFileSync(settingsPath, "utf-8").includes("hook session-start");
  } catch {
    /* ignore */
  }
  expect(
    "init.happy",
    r.code === 0 && installedHook && existsSync(cfgPath) && existsSync(path.join(sb.init, ".mcp.json")),
    `init --api-key <key> --skip-service → exit 0 + hooks + config + .mcp.json written (got exit ${r.code}, hook=${installedHook})`,
  );

  // After init, uninstall should DETECT the installed config and (on cancel) leave it intact.
  r = runCli(["uninstall"], { home: sb.init, stdin: "" });
  expect(
    "uninstall.detectAndCancel",
    r.code === 0 &&
      r.all.includes("Found Synapse in these locations") &&
      r.all.includes("Remove Synapse hooks from") &&
      !r.all.includes("Removed ") &&
      existsSync(settingsPath),
    `uninstall (post-init, stdin EOF) → detects installed hooks, removes NOTHING, settings.json intact (got exit ${r.code})`,
  );

  // pull-handoff: missing --cwd → unique exit 2
  r = runCli(["pull-handoff"], { home: sb.empty });
  expect(
    "pullHandoff.usage",
    r.code === 2 && r.all.includes("usage: synapsesync pull-handoff --cwd"),
    `pull-handoff (no --cwd) → exit 2 + usage (got exit ${r.code})`,
  );

  // daemon: no key → prints guidance then blocks; short timeout kills it.
  r = runCli(["daemon"], { home: sb.empty, timeout: 4000 });
  expect(
    "daemon.noKey",
    r.all.includes("no API key configured"),
    `daemon (no key) → "no API key configured. Run \`synapse init\`" (then blocks; killed). signal=${r.signal}`,
  );

  // capture list: empty sandbox → "No captured sessions yet."
  r = runCli(["capture", "list"], { home: sb.empty });
  expect(
    "capture.list",
    r.code === 0 && r.all.includes("No captured sessions yet."),
    `capture list (empty) → exit 0 + "No captured sessions yet." (got exit ${r.code})`,
  );

  // capture status: structural (daemon line reflects real launchd — assert shape only)
  r = runCli(["capture", "status"], { home: sb.empty });
  expect(
    "capture.status",
    r.code === 0 && r.all.includes("Sessions"),
    `capture status → exit 0 + "Sessions …" (got exit ${r.code})`,
  );

  // capture <bad sub> → help, exit 0
  r = runCli(["capture", "frobnicate"], { home: sb.empty });
  expect(
    "capture.unknownSub",
    r.code === 0 &&
      r.all.includes("start") &&
      r.all.includes("stop") &&
      r.all.includes("status") &&
      r.all.includes("list"),
    "capture <bad-sub> → help listing subcommands, exit 0",
  );

  skip("capture.start", "would spawn a daemon / detect+skip the real one (non-deterministic)");
  skip("capture.stop", "would process.kill the PID from checkSupervisor (the REAL daemon)");
  skip("daemon.run", "blocks forever + pushes to the real backend per cycle");
  skip("pullHandoff.run", "may spawn `claude -p` (30-60s, tokens) + hits the real backend");
  skip("wizard", "fully interactive; calls init WITHOUT --skip-service (registers OS service)");
}

// ── Main ────────────────────────────────────────────────────────────────
function summary() {
  header("SUMMARY");
  const pass = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  for (const r of results.filter((x) => x.status === "FAIL")) log(`  ❌ ${r.id} — ${r.detail}`);
  log("");
  log(`  Total: ${results.length}  ·  PASS: ${pass}  ·  FAIL: ${failed}  ·  SKIP: ${skipped}`);
  log("");
  if (failed > 0) {
    log("❌ CLI E2E FAILED.");
    return 1;
  }
  log("✅ CLI E2E PASSED.");
  return 0;
}

async function main() {
  log("Synapse CLI contract test (deterministic, isolated)");
  log(`MCP: ${MCP_DIST}`);
  log(`RUN: ${RUN}`);
  if (!preflight()) {
    summary();
    process.exit(2);
  }
  try {
    section_dispatch();
    section_local_writes();
    section_brief();
    section_status_doctor();
    section_backend_reads();
    section_destructive_guards();
    section_direct_fetch();
    section_setup_and_capture();
  } catch (err) {
    fail("uncaught", `${err?.message}\n${err?.stack}`);
  } finally {
    if (ROOT && existsSync(ROOT)) {
      try {
        rmSync(ROOT, { recursive: true, force: true });
        info(`cleaned sandbox root ${ROOT}`);
      } catch (e) {
        info(`WARN: failed to clean ${ROOT}: ${e.message}`);
      }
    }
    // Defensive sweep: cli.mjs is documented local-only, but the
    // direct-fetch family (purge-empty, invite, move) and setup_and_capture
    // section can in some failure modes leave backend artifacts. Sweep by
    // RUN tag for symmetry with other suites.
    if (REAL_KEY) {
      await sweepArtifacts({
        apiKey: REAL_KEY,
        patterns: [`-${RUN}`, `synapse-cli-e2e-${RUN}`],
        log: (m) => log(m),
      });
    }
  }
  process.exit(summary());
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(2);
});
