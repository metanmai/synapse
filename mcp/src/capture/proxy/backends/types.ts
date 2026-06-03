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
  runSecurity?: CommandRunner;
  runOpenssl?: CommandRunner;
  runSudo?: SudoRunner;
  runCp?: CommandRunner;
  readOsRelease?: () => string | null;
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
