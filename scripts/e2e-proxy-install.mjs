#!/usr/bin/env node
// scripts/e2e-proxy-install.mjs
//
// LAYER 8 E2E — proxy CA install onboarding (macOS login keychain).
//
// Sibling tests cover Layer 8's PIECES:
//   - Unit tests (mcp/test/capture/proxy/backends/mac.test.ts) inject a
//     fake `security` runner — they validate ROUTING + INVOCATION ARGS
//     but never touch the real keychain.
//   - Docker-based proxy-linux-e2e validates the Linux trust-store
//     install pipeline against /etc/ssl/certs in 5 distros.
//   - proxy-windows-e2e CI validates the PowerShell Import-Certificate
//     pipeline reached the X509Store call (stops short of the GUI
//     prompt).
//
// THIS test fills the macOS gap: the real `security add-trusted-cert
// -k login.keychain-db` flow into the actual user keychain. It can
// only run on a non-MDM Mac because corporate MDM policies block the
// admin password prompt that `security` triggers (see
// feedback_corp_keychain_blocked memory).
//
// Bug class under test: "CA install onboarding produces a state where
// caStatus() reports inKeychain=true but the cert isn't actually
// queryable from `security find-certificate`, OR uninstall reports
// removed=true but the cert is still present." Specifically:
//   * `installCa` writes the CA pem to disk but skips the `security
//     add-trusted-cert` invocation
//   * `caStatus` reads from the wrong keychain (System vs login)
//   * `uninstallCa` removes the disk pem but leaves the keychain entry
//
// Isolation strategy:
//   * SYNAPSE_HOME=mktemp_dir — CA pem lands in tmpdir, not the user's
//     real ~/.synapse/proxy/ (so this script never collides with a
//     real install).
//   * The keychain operation is NOT isolatable — we genuinely add to
//     and remove from the user's login keychain. Test cleanup is
//     belt-and-suspenders (always runs even on early exit).
//
// Soft-skips (exit 0):
//   * Not darwin — Linux/Windows have their own E2E coverage.
//   * MDM-managed Mac detected (mdmclient or profiles output reports
//     a corporate MDM profile) — the keychain prompt will block.
//   * `security` not on PATH (highly unusual on macOS).
//
// Exit codes:
//   0 — all stages passed, OR soft-skipped
//   1 — bug found (install/status/uninstall didn't match expectations)
//   2 — preflight error (dist/ not built, can't find synapsesync entry)
//
// Usage:
//   cd mcp && npm run build
//   cd .. && node scripts/e2e-proxy-install.mjs

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_CLI = path.join(REPO_ROOT, "mcp", "dist", "index.js");
const CA_COMMON_NAME = "Synapse Proxy CA";

// ── Preflight ────────────────────────────────────────────────────────────

if (process.platform !== "darwin") {
  console.log(`ℹ️  Platform is ${process.platform}, not darwin — soft-skip.`);
  console.log("   Linux: covered by .github/workflows/ci.yml#proxy-linux-e2e (5 distros).");
  console.log("   Windows: covered by .github/workflows/ci.yml#proxy-windows-e2e.");
  process.exit(0);
}

if (!existsSync(DIST_CLI)) {
  console.error(`❌ Missing ${DIST_CLI}.`);
  console.error("   Run: cd mcp && npm run build");
  process.exit(2);
}

const haveSecurity = spawnSync("which", ["security"]).status === 0;
if (!haveSecurity) {
  console.log("ℹ️  `security` binary not on PATH (unusual on macOS) — soft-skip.");
  process.exit(0);
}

// MDM probe: corporate Macs that block keychain modifications usually
// have configuration profiles installed. `profiles status -type enrollment`
// reports "Enrolled via DEP" or similar on MDM machines. We skip on any
// non-error output that mentions enrollment to avoid the password prompt.
const profilesCheck = spawnSync("profiles", ["status", "-type", "enrollment"], {
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "ignore"],
});
if (profilesCheck.status === 0 && /enrolled\s*:\s*yes/i.test(profilesCheck.stdout ?? "")) {
  console.log("ℹ️  MDM-enrolled Mac detected — soft-skip to avoid blocked keychain prompt.");
  console.log("   Run this script on a personal (non-managed) Mac to exercise the real flow.");
  process.exit(0);
}

// ── Test fixture ──────────────────────────────────────────────────────────

const SYN_HOME = mkdtempSync(path.join(tmpdir(), "synapse-e2e-proxy-install-"));
console.log(`[setup] SYNAPSE_HOME=${SYN_HOME}`);

let exitCode = 0;
const env = { ...process.env, SYNAPSE_HOME: SYN_HOME };

/** Run synapsesync subcommand and return {status, stdout, stderr}. */
function syn(args) {
  const r = spawnSync(process.execPath, [DIST_CLI, ...args], {
    env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Best-effort cleanup: remove keychain entry + tmpdir + reset state. */
function cleanup() {
  // Try uninstall via the CLI (correctness path).
  syn(["capture", "proxy", "uninstall"]);
  // Belt-and-suspenders: even if uninstall above succeeded, search-and-delete
  // any stragglers by Common Name. Safe to no-op when nothing matches.
  spawnSync(
    "security",
    ["delete-certificate", "-c", CA_COMMON_NAME, `${process.env.HOME}/Library/Keychains/login.keychain-db`],
    { stdio: "ignore" },
  );
  try {
    rmSync(SYN_HOME, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

// ── Stage 1: install ──────────────────────────────────────────────────────

console.log("\n[stage 1] capture proxy install");
const install = syn(["capture", "proxy", "install"]);
if (install.status !== 0) {
  console.error(`❌ install exited ${install.status}`);
  console.error(`   stdout: ${install.stdout.slice(0, 800)}`);
  console.error(`   stderr: ${install.stderr.slice(0, 800)}`);
  exitCode = 1;
}

const caPemPath = path.join(SYN_HOME, "proxy", "ca.pem");
if (!existsSync(caPemPath)) {
  console.error(`❌ CA pem missing at ${caPemPath}`);
  exitCode = 1;
} else {
  const pem = readFileSync(caPemPath, "utf-8");
  if (!pem.includes("BEGIN CERTIFICATE")) {
    console.error(`❌ CA pem at ${caPemPath} is not PEM-shaped`);
    exitCode = 1;
  } else {
    console.log(`  ✓ CA pem present at ${caPemPath}`);
  }
}

// Verify via the OS itself — the strongest signal that the install
// actually landed.
const find = spawnSync(
  "security",
  ["find-certificate", "-c", CA_COMMON_NAME, `${process.env.HOME}/Library/Keychains/login.keychain-db`],
  { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
);
if (find.status !== 0) {
  console.error(`❌ \`security find-certificate -c "${CA_COMMON_NAME}"\` exited ${find.status} after install`);
  console.error(`   stderr: ${find.stderr.slice(0, 400)}`);
  exitCode = 1;
} else if (!find.stdout.includes(CA_COMMON_NAME)) {
  console.error(`❌ keychain output missing expected CN "${CA_COMMON_NAME}"`);
  exitCode = 1;
} else {
  console.log(`  ✓ keychain reports CN "${CA_COMMON_NAME}" present`);
}

// ── Stage 2: status reports inKeychain=true ───────────────────────────────

console.log("\n[stage 2] capture proxy status");
const status = syn(["capture", "proxy", "status"]);
if (status.status !== 0) {
  console.error(`❌ status exited ${status.status}`);
  exitCode = 1;
} else {
  const reportsPresent = /CA\s+present/i.test(status.stdout);
  const reportsInKeychain = /trust(ed)?|keychain/i.test(status.stdout);
  if (!reportsPresent || !reportsInKeychain) {
    console.error("❌ status output didn't reflect install state");
    console.error(`   stdout: ${status.stdout.slice(0, 800)}`);
    exitCode = 1;
  } else {
    console.log("  ✓ status reports CA present + in trust store");
  }
}

// ── Stage 3: uninstall ────────────────────────────────────────────────────

console.log("\n[stage 3] capture proxy uninstall");
const uninstall = syn(["capture", "proxy", "uninstall"]);
if (uninstall.status !== 0) {
  console.error(`❌ uninstall exited ${uninstall.status}`);
  console.error(`   stderr: ${uninstall.stderr.slice(0, 800)}`);
  exitCode = 1;
}

// Post-uninstall: keychain must NOT report the CA. find-certificate
// exits non-zero when no match.
const findAfter = spawnSync(
  "security",
  ["find-certificate", "-c", CA_COMMON_NAME, `${process.env.HOME}/Library/Keychains/login.keychain-db`],
  { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
);
if (findAfter.status === 0 && findAfter.stdout.includes(CA_COMMON_NAME)) {
  console.error("❌ keychain STILL reports CA after uninstall — uninstall is a no-op");
  console.error(`   stdout: ${findAfter.stdout.slice(0, 400)}`);
  exitCode = 1;
} else {
  console.log("  ✓ keychain no longer reports CA after uninstall");
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${exitCode === 0 ? "✅" : "❌"} Layer 8 macOS install E2E ${exitCode === 0 ? "passed" : "FAILED"}`);
process.exit(exitCode);
