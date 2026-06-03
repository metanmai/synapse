/**
 * Windows backend — installs the Synapse Proxy CA into the CurrentUser
 * Root certificate store via the builtin `certutil` CLI.
 *
 * Spec §5.2:
 *   • install:  certutil -addstore -user -f Root <caPath>
 *   • uninstall: certutil -delstore -user Root "Synapse Proxy CA"
 *   • status:    certutil -store -user Root "Synapse Proxy CA"  (exit 0 = present)
 *
 * CurrentUser store is intentional: no UAC prompt, no GPO complications
 * for the install path. Edge / Chrome / Node read CurrentUser by default.
 * Same philosophy as macOS login keychain.
 *
 * `certutil` is built into Windows since Vista — always on PATH in cmd,
 * PowerShell, and Git Bash. No dependency to install.
 *
 * Testability: every `certutil` invocation goes through the injectable
 * `opts.runCertutil` runner. Tests pass a fake so the user's real Root
 * store is never touched.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import type {
  BackendOptions,
  CommandResult,
  CommandRunner,
  InstallCheckResult,
  InstallResult,
  PlatformBackend,
  UninstallResult,
} from "./types.js";

/** Common Name on the generated CA — lookup key for certutil queries. */
const CA_COMMON_NAME = "Synapse Proxy CA";

const DEBUG = process.env.SYNAPSE_PROXY_DEBUG;
const dlog = DEBUG
  ? (msg: string) => process.stderr.write(`[windows-debug ${Date.now()}] ${msg}\n`)
  : (_msg: string) => {};

function defaultRunCertutil(args: string[]): CommandResult {
  dlog(`certutil ${args.join(" ")} START`);
  const r: SpawnSyncReturns<Buffer> = spawnSync("certutil", args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30000,
  });
  dlog(`certutil ${args[0]} DONE status=${r.status}`);
  return {
    status: r.status ?? -1,
    stdout: (r.stdout ?? Buffer.from("")).toString("utf-8"),
    stderr: (r.stderr ?? Buffer.from("")).toString("utf-8"),
  };
}

function resolveRunCertutil(opts: BackendOptions): CommandRunner {
  return opts.runCertutil ?? defaultRunCertutil;
}

export const WindowsBackend: PlatformBackend = {
  name: "windows",

  installCa(caPath, opts): InstallResult {
    const runCertutil = resolveRunCertutil(opts);
    const proxyPort = opts.proxyPort ?? 7727;
    const envSnippet = this.buildEnvSnippet(caPath, proxyPort);
    const manualInstallInstructions = this.buildManualInstructions(caPath, proxyPort);

    // -addstore: add cert to store.
    // -user:     CurrentUser scope (no UAC prompt).
    // -f:        force-overwrite an existing entry (idempotent re-install).
    // Root:      "Trusted Root Certification Authorities" store.
    runCertutil(["-addstore", "-user", "-f", "Root", caPath]);

    // Post-verify via -store query. certutil exits 0 = cert found, non-zero = absent.
    // Same idea as macOS find-certificate after add-trusted-cert.
    const verify = runCertutil(["-store", "-user", "Root", CA_COMMON_NAME]);
    const installed = verify.status === 0;

    return {
      installed,
      caPath,
      fingerprint: "",
      envSnippet,
      manualInstallInstructions,
      proxyPort,
    };
  },

  uninstallCa(_caPath, opts): UninstallResult {
    const runCertutil = resolveRunCertutil(opts);
    // -delstore by Common Name. Idempotent — exit non-zero if cert isn't present.
    const r = runCertutil(["-delstore", "-user", "Root", CA_COMMON_NAME]);
    return { removed: r.status === 0 };
  },

  checkInstall(_caPath, opts): InstallCheckResult {
    const runCertutil = resolveRunCertutil(opts);
    const r = runCertutil(["-store", "-user", "Root", CA_COMMON_NAME]);
    return { caExists: true, inTrustStore: r.status === 0, fingerprint: null };
  },

  buildEnvSnippet(caPath, proxyPort) {
    // Spec §5.3: include PowerShell + cmd syntaxes since we don't know
    // which shell the user is in. Persistent forms use setx (cmd) and
    // [Environment]::SetEnvironmentVariable (PowerShell) so the vars
    // survive shell restarts.
    return [
      "# PowerShell — current session:",
      `$env:NODE_EXTRA_CA_CERTS = "${caPath}"`,
      `$env:HTTPS_PROXY = "http://127.0.0.1:${proxyPort}"`,
      "",
      "# PowerShell — persistent (User scope):",
      `[Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", "${caPath}", "User")`,
      `[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://127.0.0.1:${proxyPort}", "User")`,
      "",
      "# cmd (legacy / non-PowerShell):",
      `setx NODE_EXTRA_CA_CERTS "${caPath}"`,
      `setx HTTPS_PROXY "http://127.0.0.1:${proxyPort}"`,
    ].join("\n");
  },

  buildManualInstructions(caPath, proxyPort) {
    // GPO-managed corporate Windows may block certutil -addstore even
    // with -f. The certmgr.msc GUI path is the documented fallback.
    return [
      "If certutil install failed (usual cause: Group Policy restriction on cert stores):",
      "  1. Open certmgr.msc (Start → Run → certmgr.msc)",
      "  2. Navigate to: Trusted Root Certification Authorities → Certificates",
      `  3. Right-click → All Tasks → Import. Select ${caPath}`,
      "  4. Confirm the 'Trust this CA' prompt.",
      "",
      "Then set env vars (PowerShell):",
      `  $env:NODE_EXTRA_CA_CERTS = "${caPath}"`,
      `  $env:HTTPS_PROXY = "http://127.0.0.1:${proxyPort}"`,
      "",
      "Finally restart the daemon: synapsesync capture stop && synapsesync capture start",
    ].join("\n");
  },
};
