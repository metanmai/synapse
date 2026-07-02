#!/usr/bin/env node
/**
 * scripts/cleanup-test-account.mjs — CI pre-flight hygiene for the
 * dedicated E2E test account.
 *
 * Why this exists: the happy-flow-e2e job on metanmai/synapse uses a
 * dedicated test account (authenticated via the SYNAPSE_E2E_API_KEY
 * GitHub secret). Every E2E run plants ~5-10 short-lived projects via
 * the daemon's auto-create path (one per stage's synthetic git remote);
 * tests own their `cleanup()` happy path, but failed / cancelled /
 * killed runs leak those projects. After ~15 leaked runs the account
 * crosses the 50-project tier cap (free plan limit, enforced in
 * `backend/src/lib/tier.ts::enforceProjectQuotaForTier`) and the very
 * next `POST /api/projects` returns HTTP 402 PROJECT_QUOTA_EXCEEDED,
 * which fails every subsequent happy-flow CI job — including the
 * ubuntu + windows matrix legs of the same workflow run, even though
 * the offending leak came from a previous PR's cancelled run.
 *
 * What this does: enumerates the account's projects, picks the ones
 * older than --older-than-minutes (default 45 min), and force-deletes
 * them. The 45-minute floor is the concurrency guard: the happy-flow
 * matrix legs (ubuntu + windows) run in parallel against the same
 * account, and the workflow's cancel-in-progress concurrency group
 * means a leg might be 10-20 min in when a new push lands. 45 min is
 * comfortably above any in-flight leg's age while still recovering
 * the cap within a single workflow run's residue window.
 *
 * Differences vs. neighboring scripts (read the headers of all three
 * to keep them coherent):
 *   - scripts/cleanup-dev-projects.mjs — the maintainer's local tool.
 *     Allow-list semantics (keep KEEP_NAMES, drop everything else,
 *     regardless of age). Auth reads ~/.synapse/config.json by default.
 *     Used after E2E runs to wipe a dev's PERSONAL account; safe-ish
 *     because the maintainer knows what's in KEEP_NAMES.
 *   - scripts/cleanup-spam-projects.mjs — interactive pattern-match
 *     cleanup for any user account that has accumulated pollution from
 *     a now-fixed bug class. Prompts before deleting.
 *   - scripts/e2e-cleanup.mjs — the shared sweep helper imported by
 *     individual E2E scripts to clean up their OWN run's artifacts at
 *     test exit. Pattern-match on a RUN_ID embedded in test project
 *     names. Non-throwing; never gates the test signal.
 *
 *   - cleanup-test-account.mjs (THIS FILE) — CI-only. Age-based: drop
 *     EVERYTHING older than N minutes regardless of name. The default
 *     keep-list is EMPTY because the account is a dedicated CI mule
 *     — nothing on it is precious. Auth ONLY via the
 *     SYNAPSE_E2E_API_KEY / SYNAPSE_API_KEY env vars; we DO NOT read
 *     ~/.synapse/config.json (see SAFETY below).
 *
 * SAFETY — why this script does NOT fall back to ~/.synapse/config.json:
 *   - cleanup-dev-projects.mjs DOES fall back to that file because it's
 *     a maintainer-driven tool: the maintainer chose to run it on their
 *     own dev account and configured KEEP_NAMES to protect their work.
 *   - This script is age-based AND aggressive (force-delete). Reading
 *     ~/.synapse/config.json by accident would let it run against a
 *     developer's REAL account in any context where the env var
 *     happened to not be set (broken CI config, mis-typed secret name,
 *     someone running the script locally to "see what it does"). The
 *     blast radius of that mistake — every project >45 min old on a
 *     real account, force-deleted — is catastrophic.
 *   - Therefore: env var present → run; env var absent → hard exit 2.
 *     No filesystem fallback. No interactive prompt either; this is a
 *     non-interactive CI script and any prompt would deadlock the job.
 *
 * Exit-code contract:
 *   0 — success (including when some individual deletes failed; see
 *       below). CI hygiene must not mask the real E2E signal that
 *       follows in the job. The summary line lists `failed: N` so a
 *       human can spot persistent breakage when reviewing the log.
 *   2 — preflight error: no key, list request errored, list response
 *       was not OK. The script never wrote to anything in this case.
 *
 *   We deliberately do NOT use exit code 1; reserving it would imply
 *   "delete failures are fatal," which would flip a flaky network blip
 *   on one DELETE into a CI-red — exactly what this script exists to
 *   PREVENT. Per-delete failures are logged and counted, never thrown.
 *
 * Usage:
 *   node scripts/cleanup-test-account.mjs                          # dry-run, default 45-min threshold
 *   node scripts/cleanup-test-account.mjs --older-than-minutes 120 # custom threshold
 *   node scripts/cleanup-test-account.mjs --keep landmark-proj     # repeatable exact-name exclusion
 *   node scripts/cleanup-test-account.mjs --yes                    # actually delete
 *
 * Auth (preference order):
 *   1. SYNAPSE_E2E_API_KEY (preferred — the CI secret name)
 *   2. SYNAPSE_API_KEY     (fallback — matches the daemon's env var)
 *   Neither set → exit 2 with a clear message. NEVER ~/.synapse/config.json.
 *
 * Backend URL: SYNAPSE_API_URL env (default https://api.synapsesync.app).
 *
 * Force-delete rationale: the backend's DELETE /api/projects/:id refuses
 * non-empty projects (returns 409 PROJECT_NOT_EMPTY) without ?force=true.
 * That guard is a UX feature for end users to avoid losing real data; for
 * the test account every "non-empty" project IS test-conversation residue
 * and force-deleting it is the explicit intent.
 *
 * No dependencies (Node 24, ESM, stdlib only). Stays in lockstep with the
 * other scripts/* files — none of them pull in npm packages either.
 */

import { formatAge, selectStaleProjects } from "./lib/stale-projects.mjs";

const DEFAULT_API_URL = "https://api.synapsesync.app";
const DEFAULT_OLDER_THAN_MINUTES = 45;

// ---------- CLI parsing (tiny inline parser, no dep) ----------

/**
 * @typedef {object} ParsedArgs
 * @property {boolean} doIt              - --yes (actually delete)
 * @property {number}  olderThanMinutes  - --older-than-minutes <N>
 * @property {string[]} keepNames        - --keep <name> (repeatable)
 * @property {string | null} parseError  - non-null when args were malformed
 */

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {ParsedArgs}
 */
function parseArgs(argv) {
  let doIt = false;
  let olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES;
  const keepNames = [];
  let parseError = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes") {
      doIt = true;
    } else if (arg === "--older-than-minutes") {
      const next = argv[i + 1];
      if (next === undefined) {
        parseError = "--older-than-minutes requires a numeric argument";
        break;
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 0) {
        parseError = `--older-than-minutes must be a non-negative number, got: ${next}`;
        break;
      }
      olderThanMinutes = parsed;
      i++;
    } else if (arg === "--keep") {
      const next = argv[i + 1];
      if (next === undefined) {
        parseError = "--keep requires a project-name argument";
        break;
      }
      keepNames.push(next);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      parseError = "help";
      break;
    } else {
      parseError = `unknown argument: ${arg}`;
      break;
    }
  }

  return { doIt, olderThanMinutes, keepNames, parseError };
}

function printUsage(stream = process.stderr) {
  stream.write(
    [
      "Usage: node scripts/cleanup-test-account.mjs [options]",
      "",
      "Options:",
      "  --older-than-minutes <N>   Stale threshold in minutes (default 45)",
      "  --keep <name>              Exact-name project to preserve (repeatable, default none)",
      "  --yes                      Actually delete (default: dry-run)",
      "  -h, --help                 Show this help",
      "",
      "Auth: set SYNAPSE_E2E_API_KEY or SYNAPSE_API_KEY in the environment.",
      "      This script DOES NOT read ~/.synapse/config.json — see header.",
      "",
    ].join("\n"),
  );
}

// ---------- entrypoint ----------

const { doIt, olderThanMinutes, keepNames, parseError } = parseArgs(process.argv.slice(2));

if (parseError === "help") {
  printUsage(process.stdout);
  process.exit(0);
}
if (parseError) {
  process.stderr.write(`error: ${parseError}\n\n`);
  printUsage();
  process.exit(2);
}

// Env-only auth — see SAFETY header. No filesystem fallback.
const apiKey = process.env.SYNAPSE_E2E_API_KEY ?? process.env.SYNAPSE_API_KEY;
if (!apiKey) {
  process.stderr.write(
    [
      "error: no API key found in environment",
      "  expected SYNAPSE_E2E_API_KEY (preferred) or SYNAPSE_API_KEY",
      "",
      "  This script intentionally does NOT fall back to ~/.synapse/config.json",
      "  (that file holds a developer's real account key, and this script",
      "  force-deletes aggressively). Set the env var in CI, or pass it via",
      "  SYNAPSE_E2E_API_KEY=… node scripts/cleanup-test-account.mjs",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const apiUrl = process.env.SYNAPSE_API_URL ?? DEFAULT_API_URL;
const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

process.stdout.write(`cleanup-test-account → ${apiUrl}\n`);
process.stdout.write(
  `  threshold: ${olderThanMinutes}m   keep: ${keepNames.length === 0 ? "(none)" : keepNames.join(", ")}\n`,
);
process.stdout.write(`  mode: ${doIt ? "DELETE" : "dry-run (pass --yes to execute)"}\n\n`);

// ---------- list ----------

let projects;
try {
  const res = await fetch(`${apiUrl}/api/projects`, { headers: auth });
  if (!res.ok) {
    // Read body text best-effort for the operator log; don't let a body
    // read throw out of the preflight branch.
    const body = await res.text().catch(() => "");
    process.stderr.write(`error: LIST /api/projects returned HTTP ${res.status}\n`);
    if (body) process.stderr.write(`  body: ${body.slice(0, 400)}\n`);
    process.exit(2);
  }
  projects = await res.json();
} catch (e) {
  // Network / DNS / TLS failure — preflight error, no work done yet.
  process.stderr.write(`error: LIST /api/projects failed: ${e?.message ?? e}\n`);
  process.exit(2);
}

if (!Array.isArray(projects)) {
  process.stderr.write(`error: LIST /api/projects returned non-array body (got ${typeof projects})\n`);
  process.exit(2);
}

// ---------- select ----------

const nowMs = Date.now();
const { stale, kept, fresh } = selectStaleProjects(projects, nowMs, {
  olderThanMinutes,
  keepNames,
});

process.stdout.write(`Account has ${projects.length} project(s)\n`);
process.stdout.write(`  stale (deletable): ${stale.length}\n`);
process.stdout.write(`  kept (in keep-list): ${kept.length}\n`);
process.stdout.write(`  fresh (under threshold): ${fresh.length}\n\n`);

if (stale.length > 0) {
  process.stdout.write(`=== STALE ${doIt ? "(deleting)" : "(dry-run — pass --yes to execute)"} ===\n`);
  for (const p of stale) {
    process.stdout.write(`  ${String(p.id).slice(0, 8)}  age=${formatAge(p, nowMs)}  ${p.name}\n`);
  }
  process.stdout.write("\n");
}

if (!doIt) {
  process.stdout.write(
    `Summary: total=${projects.length} stale=${stale.length} deleted=0 failed=0 kept=${kept.length}\n`,
  );
  process.stdout.write("(dry-run complete — re-run with --yes to actually delete)\n");
  process.exit(0);
}

// ---------- delete ----------

let deleted = 0;
const failures = [];

// Sequential to avoid the backend's 120 req/min rate-limit. The cleanup
// volume per CI run is small (we expect <30 even on a badly-leaked account
// since the cap is 50), so the wall-clock cost is bounded.
for (const p of stale) {
  const url = `${apiUrl}/api/projects/${p.id}?force=true`;
  try {
    const r = await fetch(url, { method: "DELETE", headers: auth });
    if (r.ok) {
      deleted += 1;
    } else {
      const body = await r.text().catch(() => "");
      failures.push({
        id: String(p.id).slice(0, 8),
        name: p.name,
        reason: `HTTP ${r.status}${body ? ` ${body.slice(0, 200)}` : ""}`,
      });
    }
  } catch (e) {
    failures.push({ id: String(p.id).slice(0, 8), name: p.name, reason: e?.message ?? String(e) });
  }
}

process.stdout.write(
  `\nSummary: total=${projects.length} stale=${stale.length} deleted=${deleted} failed=${failures.length} kept=${kept.length}\n`,
);

if (failures.length > 0) {
  process.stdout.write("\nIndividual delete failures (non-fatal — CI continues):\n");
  for (const f of failures) {
    process.stdout.write(`  ${f.id} (${f.name}): ${f.reason}\n`);
  }
}

// Exit 0 even on per-delete failures — see header (exit-code contract).
process.exit(0);
