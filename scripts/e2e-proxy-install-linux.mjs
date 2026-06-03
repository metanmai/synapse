#!/usr/bin/env node
/**
 * Synapse proxy Layer 8 E2E — Linux trust-store install (Docker matrix).
 *
 * Host-side orchestrator. For each Linux distro in [debian, ubuntu,
 * fedora, rockylinux, arch], builds a per-distro Dockerfile and runs
 * `scripts/e2e-linux/e2e-proxy-install.sh` inside the container. The
 * container exercises `synapsesync capture proxy install/status/uninstall`
 * against the distro's REAL trust store and asserts filesystem state per
 * spec §4.2.
 *
 * Soft-skips with exit 0 when Docker is unavailable (devs without
 * Docker / Rancher Desktop can still run the rest of the merge gate
 * without seeing a spurious failure).
 *
 * Wired to `npm run test:e2e:proxy-linux`. NOT part of the default
 * `npm run test:e2e` chain — keeping the default chain at ~5-8 min on
 * developer machines. CI runs this unconditionally via the
 * `proxy-linux-e2e` matrix job in `.github/workflows/ci.yml`.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DISTROS = ["debian", "ubuntu", "fedora", "rockylinux", "arch"];
const RUN_TAG = `e2e-${Date.now()}`;

function header(msg) {
  console.log(`\n── ${msg} ──`);
}

function softSkip(msg) {
  console.log(`[skip] ${msg}`);
  process.exit(0);
}

// ── Sanity: docker available? ─────────────────────────────────────────
const dockerCheck = spawnSync("docker", ["--version"], { encoding: "utf-8" });
if (dockerCheck.status !== 0) {
  softSkip("docker not available; install Docker Desktop or Rancher Desktop and retry");
}
console.log(`[docker] ${dockerCheck.stdout.trim()}`);

header(`e2e-proxy-install-linux • ${DISTROS.length} distros • run=${RUN_TAG}`);

const results = [];
for (const distro of DISTROS) {
  header(`distro=${distro}`);
  const tag = `synapse-e2e-${distro}:${RUN_TAG}`;
  const dockerfile = `scripts/e2e-linux/Dockerfile.${distro}`;

  // ── BUILD ───────────────────────────────────────────────────────────
  console.log(`[build] docker build -f ${dockerfile} -t ${tag} .`);
  const build = spawnSync("docker", ["build", "-f", dockerfile, "-t", tag, "."], { cwd: REPO_ROOT, stdio: "inherit" });
  if (build.status !== 0) {
    results.push({ distro, stage: "build", ok: false });
    continue;
  }

  // ── RUN ─────────────────────────────────────────────────────────────
  console.log(`[run] docker run --rm ${tag}`);
  const run = spawnSync("docker", ["run", "--rm", tag], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  results.push({ distro, stage: "run", ok: run.status === 0 });
}

// ── CLEANUP ─────────────────────────────────────────────────────────────
header("cleanup");
for (const distro of DISTROS) {
  spawnSync("docker", ["rmi", "-f", `synapse-e2e-${distro}:${RUN_TAG}`], { stdio: "ignore" });
}

// ── SUMMARY ─────────────────────────────────────────────────────────────
header("Summary");
const pad = (s) => s.padEnd(12);
for (const r of results) {
  const verdict = r.ok ? "PASS" : "FAIL";
  const detail = r.ok ? "" : ` (stage=${r.stage})`;
  console.log(`  ${verdict}  ${pad(r.distro)}${detail}`);
}

const allPassed = results.every((r) => r.ok);
const passCount = results.filter((r) => r.ok).length;
console.log(`\n${passCount}/${results.length} distros passed`);
process.exit(allPassed ? 0 : 1);
