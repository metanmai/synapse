/**
 * Windows backend — installs the Synapse Proxy CA into the CurrentUser
 * Root certificate store.
 *
 * Why TWO binaries (powershell for write, certutil for read)?
 *
 *   Windows shows a GUI confirmation dialog ("Do you want to install
 *   this CA?") when ANY tool adds a cert to the ROOT store, even at
 *   CurrentUser scope. `certutil -addstore -f` suppresses the CONSOLE
 *   prompt but NOT the GUI dialog. On CI runners (no interactive
 *   desktop) the dialog hangs forever — verified empirically on GHA
 *   windows-latest, where `certutil -addstore -user -f Root <ca.pem>`
 *   sat for exactly 30 s before our spawnSync timeout killed it.
 *
 *   PowerShell's `Import-Certificate` (and the underlying
 *   `System.Security.Cryptography.X509Certificates.X509Store` API)
 *   bypasses the dialog — it calls the .NET layer directly rather
 *   than going through the UI-aware Win32 cert install codepath.
 *
 *   Query operations (`certutil -store ...`) are non-destructive and
 *   do NOT trigger any prompt — we measured 64 ms on CI. Keep them.
 *
 * Operation map (spec §5.2, post-Windows-CI-validation revision):
 *   • install:    powershell Import-Certificate ... Cert:\CurrentUser\Root
 *   • uninstall:  powershell X509Store('Root','CurrentUser').Remove(...)
 *   • status:     certutil -store -user Root "Synapse Proxy CA"  (exit 0 = present)
 *
 * CurrentUser store is intentional: no UAC prompt, no GPO complications
 * for the install path. Edge / Chrome / Node read CurrentUser by default.
 * Same philosophy as macOS login keychain.
 *
 * `powershell.exe` is built into Windows 7+ (Server 2008 R2+); `certutil`
 * is built in since Vista. Both always on PATH. No dependency to install.
 *
 * Testability: every PowerShell + certutil invocation goes through the
 * injectable `opts.runPowerShell` / `opts.runCertutil` runners. Tests
 * pass fakes so the user's real Root store is never touched.
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

/** Common Name on the generated CA — lookup key for store queries. */
const CA_COMMON_NAME = "Synapse Proxy CA";

const DEBUG = process.env.SYNAPSE_PROXY_DEBUG;
const dlog = DEBUG
  ? (msg: string) => process.stderr.write(`[windows-debug ${Date.now()}] ${msg}\n`)
  : (_msg: string) => {};

function defaultRunPowerShell(args: string[]): CommandResult {
  // Single arg: the PowerShell script body. We wrap it in
  // `powershell.exe -NoProfile -NonInteractive -Command <script>`
  // so user profile / interactive prompts can't slow us down.
  const script = args[0] ?? "";
  dlog(`powershell START: ${script.slice(0, 100).replace(/\n/g, " ")}`);
  const r: SpawnSyncReturns<Buffer> = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30000,
    },
  );
  const stdout = (r.stdout ?? Buffer.from("")).toString("utf-8");
  const stderr = (r.stderr ?? Buffer.from("")).toString("utf-8");
  dlog(`powershell DONE status=${r.status}`);
  // On non-success, surface BOTH stdout (where our Write-Host traces
  // live) and stderr (where cmdlet errors land). Without this a silent
  // exit-1 or timeout-null is indistinguishable from a thousand other
  // failures. Always print, even if empty — "empty stdout" is itself
  // diagnostic info (e.g., script hung before any Write-Host fired).
  if (r.status !== 0) {
    const so = stdout.trim().slice(0, 600).replace(/\n/g, " | ");
    const se = stderr.trim().slice(0, 600).replace(/\n/g, " | ");
    dlog(`powershell stdout: ${so || "<empty>"}`);
    dlog(`powershell stderr: ${se || "<empty>"}`);
  }
  return {
    status: r.status ?? -1,
    stdout,
    stderr,
  };
}

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

function resolveRunPowerShell(opts: BackendOptions): CommandRunner {
  return opts.runPowerShell ?? defaultRunPowerShell;
}

function resolveRunCertutil(opts: BackendOptions): CommandRunner {
  return opts.runCertutil ?? defaultRunCertutil;
}

/**
 * Quote a string for embedding inside a PowerShell single-quoted literal.
 * Inside single quotes PowerShell does not expand variables or escape
 * sequences; the only character to escape is the single quote itself,
 * which doubles. Backslashes are literal — perfect for Windows paths.
 */
function psSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export const WindowsBackend: PlatformBackend = {
  name: "windows",

  installCa(caPath, opts): InstallResult {
    const runPowerShell = resolveRunPowerShell(opts);
    const runCertutil = resolveRunCertutil(opts);
    const proxyPort = opts.proxyPort ?? 7727;
    const envSnippet = this.buildEnvSnippet(caPath, proxyPort);
    const manualInstallInstructions = this.buildManualInstructions(caPath, proxyPort);

    // Why a hand-rolled install script instead of Import-Certificate?
    //
    //   1. Windows ALWAYS prompts on Root-store adds at CurrentUser
    //      scope — both `certutil -addstore Root` and the .NET API
    //      `X509Store('Root','CurrentUser').Add()` ultimately call
    //      `CertAddCertificateContextToStore`, which shows a GUI dialog
    //      ("Do you want to install this certificate?"). On CI runners
    //      (no interactive desktop) the dialog hangs forever. There is
    //      no library-level workaround — it's a Win32-level behavior.
    //
    //      The documented escape hatch is the HKCU registry value
    //      `Software\Microsoft\SystemCertificates\Root\ProtectedRoots\Flags = 1`
    //      which tells Windows the user has pre-consented to programmatic
    //      Root additions for their account (CERT_PROT_ROOT_DISABLE_NOT_DEFINED_NAME_CONSTRAINT_FLAG).
    //      No admin needed — HKCU is the per-user hive. The user already
    //      explicitly ran `synapsesync capture proxy install`; suppressing
    //      the additional Windows dialog is consistent with their intent.
    //
    //   2. `Import-Certificate` calls X509Certificate2(string path) which
    //      on .NET Framework 4.x (Windows PowerShell 5.1 — what
    //      `powershell.exe` resolves to on stock Windows) tries DER /
    //      PKCS#7 / PKCS#12 and rejects PEM with a silent exit-1. PEM
    //      support arrived in .NET 5+ — works under pwsh (PS 7), not
    //      powershell.exe (PS 5.1). Both X509Certificate2(byte[]) and
    //      X509Store exist on .NET Framework 4.x AND .NET 5+ → portable.
    //
    // Write-Host traces let us see partial progress in [windows-debug]
    // stdout dumps when the daemon's defaultRunPowerShell prints stdout
    // on non-zero exit. If a future regression hangs at a specific step,
    // the last `step:` line tells us where.
    const installScript = [
      "Write-Host 'step1:reg'",
      "New-Item -Path 'HKCU:\\Software\\Microsoft\\SystemCertificates\\Root\\ProtectedRoots' -Force | Out-Null",
      "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\SystemCertificates\\Root\\ProtectedRoots' -Name 'Flags' -Value 1 -Type DWord",
      "Write-Host 'step2:get-content'",
      `$pem = Get-Content -LiteralPath ${psSingleQuote(caPath)} -Raw`,
      "Write-Host 'step3:armor-strip'",
      "$b64 = $pem -replace '-----[^-]+-----','' -replace '\\s+',''",
      "Write-Host 'step4:base64-decode'",
      "$der = [Convert]::FromBase64String($b64)",
      "Write-Host 'step5:new-cert'",
      "$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$der)",
      "Write-Host 'step6:open-store'",
      "$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')",
      "$store.Open('ReadWrite')",
      "Write-Host 'step7:add'",
      "$store.Add($cert)",
      "Write-Host 'step8:close'",
      "$store.Close()",
      "Write-Host 'step9:done'",
    ].join("; ");
    runPowerShell([installScript]);

    // Post-verify via certutil -store (query: non-destructive, no UI).
    // certutil exits 0 when the named cert is found, non-zero otherwise.
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
    const runPowerShell = resolveRunPowerShell(opts);
    // Use X509Store directly so we can detect both (a) cert-not-present
    // (exit 1 → removed=false, idempotent) and (b) successful removal
    // (exit 0 → removed=true). Remove-Item Cert:\... could also trigger
    // a confirmation dialog in some Windows builds, so we go through
    // the .NET API path here too.
    const removeScript = [
      "$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')",
      "$store.Open('ReadWrite')",
      `$found = $store.Certificates | Where-Object { $_.Subject -like '*CN=${CA_COMMON_NAME}*' }`,
      "if ($found) { $store.Remove($found); $store.Close(); exit 0 } else { $store.Close(); exit 1 }",
    ].join("; ");
    const r = runPowerShell([removeScript]);
    return { removed: r.status === 0 };
  },

  checkInstall(_caPath, opts): InstallCheckResult {
    const runCertutil = resolveRunCertutil(opts);
    // -store query is non-destructive, never prompts. Fast (~60ms on GHA).
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
    // GPO-managed corporate Windows may block PowerShell cert-store
    // writes even at CurrentUser scope. The certmgr.msc GUI path is the
    // documented fallback.
    return [
      "If auto-install failed (usual cause: Group Policy restriction on cert stores):",
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
