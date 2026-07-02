/**
 * Platform backend contract for proxy CA onboarding.
 *
 * Each OS family (mac, linux, windows, unknown) implements this interface
 * with native trust-store mechanisms. The dispatcher in `./index.ts`
 * selects the backend by `process.platform`; the thin shim in
 * `../onboarding.ts` translates these neutral result shapes back to the
 * legacy `InstallCaResult` / `CaStatusResult` field names that
 * `mcp/src/capture/cli.ts` consumes.
 */

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Generic subprocess runner used for `security`, `openssl`, `cp`, `test`, etc. */
export type CommandRunner = (args: string[]) => CommandResult;

/**
 * Sudo runner — default impl uses `stdio: "inherit"` so a password
 * prompt reaches the user's TTY. Linux soft-fails the install when
 * this returns non-zero (no throw).
 */
export type SudoRunner = (args: string[]) => CommandResult;

export interface BackendOptions {
  home?: string;
  /** macOS — `security` CLI (login keychain ops). */
  runSecurity?: CommandRunner;
  /** All platforms — `openssl` (fingerprint computation; will retire when tls.ts ports to node-forge). */
  runOpenssl?: CommandRunner;
  /** Linux — `sudo` with stdio:"inherit" by default so password prompts reach the user's TTY. */
  runSudo?: SudoRunner;
  /** Linux — `cp`, `test`, etc. piped subprocesses so tests can intercept. */
  runCp?: CommandRunner;
  /** Linux — reads /etc/os-release. Null when file is absent (Linux runtime on macOS or unsupported distros). */
  readOsRelease?: () => string | null;
  /**
   * Windows — `certutil` CLI. Used for the post-install verify query
   * (`certutil -store ...`) which is non-destructive and has no UI prompt.
   * NOT used for addstore/delstore on Windows: those hit the Windows
   * "Do you want to install this CA?" GUI dialog that hangs CI runners
   * (verified by daemon-side debug logs: `certutil -addstore` hung for
   * exactly 30s on GHA windows-latest before our spawnSync timeout fired).
   */
  runCertutil?: CommandRunner;
  /**
   * Windows — `powershell` CLI used to run `Import-Certificate` (install)
   * and `X509Store.Remove()` (uninstall). Both use .NET's X509Store API
   * which bypasses the Root-store GUI confirmation dialog that certutil
   * triggers. Single arg: the PowerShell script body (we invoke
   * `powershell.exe -NoProfile -NonInteractive -Command <script>`).
   */
  runPowerShell?: CommandRunner;
  proxyPort?: number;
}

export interface InstallResult {
  installed: boolean;
  caPath: string;
  fingerprint: string;
  envSnippet: string;
  manualInstallInstructions: string;
  proxyPort: number;
  skippedReason?: string;
  requiresSudo?: boolean;
  manualCommand?: string;
}

export interface UninstallResult {
  removed: boolean;
  skippedReason?: string;
}

export interface InstallCheckResult {
  caExists: boolean;
  inTrustStore: boolean;
  fingerprint: string | null;
}

export interface PlatformBackend {
  readonly name: "mac" | "linux" | "windows" | "unknown";
  installCa(caPath: string, opts: BackendOptions): InstallResult;
  uninstallCa(caPath: string, opts: BackendOptions): UninstallResult;
  checkInstall(caPath: string, opts: BackendOptions): InstallCheckResult;
  buildEnvSnippet(caPath: string, proxyPort: number): string;
  buildManualInstructions(caPath: string, proxyPort: number): string;
}

export const DEFAULT_PROXY_PORT = 7727;

/** Shared shell snippet — same shape on every platform (per spec §5.3). */
export function buildSharedEnvSnippet(caPath: string, proxyPort: number): string {
  return [
    "# Synapse proxy — add to ~/.zshrc, ~/.bashrc, or equivalent",
    `export NODE_EXTRA_CA_CERTS="${caPath}"`,
    `export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"`,
  ].join("\n");
}
