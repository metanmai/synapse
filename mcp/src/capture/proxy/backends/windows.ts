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
  const stderr = (r.stderr ?? Buffer.from("")).toString("utf-8");
  dlog(`powershell DONE status=${r.status}`);
  // Surface stderr in the debug log on non-zero exit — the silent
  // exit-1 from a PowerShell cmdlet is otherwise indistinguishable from
  // a thousand different errors. With this you get the actual error
  // text in CI logs the moment a regression lands.
  if (r.status !== 0 && stderr.trim()) {
    dlog(`powershell stderr: ${stderr.trim().slice(0, 400).replace(/\n/g, " | ")}`);
  }
  return {
    status: r.status ?? -1,
    stdout: (r.stdout ?? Buffer.from("")).toString("utf-8"),
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

    // Why a hand-rolled PEM-to-DER decode instead of Import-Certificate?
    //   • `Import-Certificate` calls X509Certificate2(string path) which
    //     on .NET Framework 4.x (Windows PowerShell 5.1, what `powershell.exe`
    //     resolves to on stock Windows) tries DER / PKCS#7 / PKCS#12 and
    //     rejects PEM with a silent exit-1. PEM support arrived in .NET 5+
    //     as X509Certificate2.CreateFromPemFile() — so it works under pwsh
    //     (PS 7) but not powershell.exe (PS 5.1).
    //   • Both X509Certificate2(byte[]) and X509Store('Root','CurrentUser')
    //     are present on .NET Framework 4.x and .NET 5+ → portable across
    //     every Windows that ships PowerShell.
    //   • The `-----BEGIN/END-----` armor strip is a 2-character regex
    //     pair; Base64 decode of what's left gives the raw DER bytes.
    //
    // X509Store.Add on CurrentUser/Root is the same .NET path Import-Certificate
    // uses under the hood — so the GUI confirmation dialog (the bug that
    // killed `certutil -addstore -user -f Root <ca.pem>` on CI) is still
    // bypassed. We just call the underlying API ourselves.
    const installScript = [
      `$pem = Get-Content -LiteralPath ${psSingleQuote(caPath)} -Raw`,
      "$b64 = $pem -replace '-----[^-]+-----','' -replace '\\s+',''",
      "$der = [Convert]::FromBase64String($b64)",
      "$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$der)",
      "$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','CurrentUser')",
      "$store.Open('ReadWrite')",
      "$store.Add($cert)",
      "$store.Close()",
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
