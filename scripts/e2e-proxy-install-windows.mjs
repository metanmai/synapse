#!/usr/bin/env node
/**
 * Synapse proxy Layer 8 E2E — Windows trust-store install (host orchestrator).
 *
 * On a Windows host: invokes `scripts/e2e-windows/e2e-proxy-install.ps1`
 * which exercises `synapsesync capture proxy install/status/uninstall`
 * against the real CurrentUser Root certificate store via certutil.
 *
 * On non-Windows hosts: soft-skips with exit 0 so the merge gate stays
 * green on macOS/Linux. The CI matrix gates this on every push via the
 * `proxy-windows-e2e` job on `windows-latest` runners — the same shape
 * as the Linux Docker matrix (run on every push, soft-skip locally
 * when the platform doesn't match).
 *
 * Wired to `npm run test:e2e:proxy-windows`. NOT part of the default
 * `npm run test:e2e` chain (consistent with how the Linux Docker matrix
 * isn't in the default chain either).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function softSkip(msg) {
  console.log(`[skip] ${msg}`);
  process.exit(0);
}

function header(msg) {
  console.log(`\n── ${msg} ──`);
}

if (process.platform !== "win32") {
  softSkip(
    `Windows E2E only runs on Windows hosts (current: ${process.platform}). CI gates this via the \`proxy-windows-e2e\` job on windows-latest — see .github/workflows/ci.yml.`,
  );
}

header(`e2e-proxy-install-windows • runner=windows-${process.arch}`);

const psScript = path.join(REPO_ROOT, "scripts", "e2e-windows", "e2e-proxy-install.ps1");

// -NoProfile: ignore user PowerShell profile (faster, deterministic).
// -ExecutionPolicy Bypass: allow running unsigned scripts (CI runners
// have restricted ExecutionPolicy by default).
// -File: run the script file directly.
const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});

process.exit(r.status ?? 1);
