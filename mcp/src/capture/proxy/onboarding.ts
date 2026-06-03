/**
 * Proxy CA onboarding — Layer 8.
 *
 * Thin platform dispatcher. The OS-specific trust-store work lives in
 * `./backends/{mac,linux,index}.ts`; this file's job is to:
 *
 *   • generate the CA via TlsManager (cross-platform),
 *   • compute the openssl fingerprint (cross-platform),
 *   • route to the right `PlatformBackend` via `detectBackend()`,
 *   • translate the backend's neutral `InstallResult` / `InstallCheckResult`
 *     field names back to the legacy `installedInKeychain` /
 *     `inKeychain` names that `mcp/src/capture/cli.ts` reads.
 *
 * Public API + result-object field names are PRESERVED for callers
 * (`cli.ts` reads `installedInKeychain` and `inKeychain` — those must
 * keep working unchanged through the refactor).
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { detectBackend } from "./backends/index.js";
import type { BackendOptions, CommandRunner } from "./backends/types.js";
import { TlsManager } from "./tls.js";

/** The daemon's default proxy port — also used to compose the HTTPS_PROXY env snippet. */
export const DEFAULT_PROXY_PORT = 7727;

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Injectable runner for the `security` command — tests pass a fake. */
export type SecurityRunner = (args: string[]) => CommandResult;

/** Injectable runner for `openssl` (fingerprint computation only). */
export type OpensslRunner = (args: string[]) => CommandResult;

/** Injectable sudo runner — Linux trust-store install. */
export type SudoRunner = (args: string[]) => CommandResult;

export interface OnboardingOptions {
  tlsManager?: TlsManager;
  runSecurity?: SecurityRunner;
  runOpenssl?: OpensslRunner;
  runSudo?: SudoRunner;
  runCp?: (args: string[]) => CommandResult;
  readOsRelease?: () => string | null;
  /** Override `process.platform` for tests. */
  platform?: NodeJS.Platform;
  /** Override `process.env.HOME` for tests. */
  home?: string;
  /** Proxy port to advertise in the env snippet. Defaults to DEFAULT_PROXY_PORT. */
  proxyPort?: number;
}

export interface InstallCaResult {
  caPath: string;
  /** SHA-256 fingerprint as printed by openssl (`SHA256 Fingerprint=...`). */
  fingerprint: string;
  /** True iff the cert is present in the OS trust store after the install. */
  installedInKeychain: boolean;
  /**
   * Step-by-step manual install instructions. Always included — useful
   * even on a successful auto-install for users who want to verify or
   * reapply.
   */
  manualInstallInstructions: string;
  /** Shell snippet for the user to paste into ~/.zshrc or ~/.bashrc. */
  envSnippet: string;
  /** Proxy port advertised in envSnippet. */
  proxyPort: number;
  /** Soft-skip reason on unsupported platforms / unknown distros. */
  skippedReason?: string;
  /** Linux soft-fail signal: sudo refused / non-interactive shell. */
  requiresSudo?: boolean;
  /** Linux soft-fail: the failed sudo command for the user to re-run manually. */
  manualCommand?: string;
}

export interface UninstallCaResult {
  removed: boolean;
  /** Soft-skip reason on non-macOS platforms or when CA doesn't exist. */
  skippedReason?: string;
}

export interface CaStatusResult {
  caExists: boolean;
  caPath: string;
  fingerprint: string | null;
  /**
   * True iff the cert is present in the OS trust store. Name preserved
   * for `cli.ts` compatibility — semantics generalise across platforms.
   */
  inKeychain: boolean;
  envSnippet: string;
  proxyPort: number;
}

/**
 * Generate the CA (if not present), then dispatch to the platform
 * backend to install it into the OS trust store. Returns the env
 * snippet + manual fallback instructions either way.
 */
export function installCa(opts: OnboardingOptions = {}): InstallCaResult {
  const tlsManager = opts.tlsManager ?? new TlsManager();
  const runOpenssl = opts.runOpenssl ?? defaultRunOpenssl;
  const platform = opts.platform ?? process.platform;
  const proxyPort = opts.proxyPort ?? DEFAULT_PROXY_PORT;

  tlsManager.ensureCa();
  const caPath = tlsManager.caCertPath();
  const fingerprint = computeFingerprint(caPath, runOpenssl);

  const backend = detectBackend(platform);
  const result = backend.installCa(caPath, buildBackendOptions(opts, proxyPort));

  return {
    caPath: result.caPath,
    fingerprint: result.fingerprint || fingerprint,
    installedInKeychain: result.installed,
    manualInstallInstructions: result.manualInstallInstructions,
    envSnippet: result.envSnippet,
    proxyPort: result.proxyPort,
    skippedReason: composeLegacySkipReason(platform, "install", result.skippedReason),
    requiresSudo: result.requiresSudo,
    manualCommand: result.manualCommand,
  };
}

/**
 * Remove the Synapse CA from the OS trust store. Best-effort — if no
 * CA pem exists on disk OR the platform backend reports nothing to
 * remove, returns `removed: false` rather than erroring. Leaves the
 * on-disk CA pem in `~/.synapse/proxy/ca.pem` untouched so the user
 * can reinstall without regenerating.
 */
export function uninstallCa(opts: OnboardingOptions = {}): UninstallCaResult {
  const tlsManager = opts.tlsManager ?? new TlsManager();
  const platform = opts.platform ?? process.platform;
  const proxyPort = opts.proxyPort ?? DEFAULT_PROXY_PORT;

  const caPath = tlsManager.caCertPath();
  if (!existsSync(caPath)) {
    return { removed: false, skippedReason: "no CA cert present on disk" };
  }

  const backend = detectBackend(platform);
  const result = backend.uninstallCa(caPath, buildBackendOptions(opts, proxyPort));
  return {
    removed: result.removed,
    skippedReason: composeLegacySkipReason(platform, "uninstall", result.skippedReason),
  };
}

/** Diagnose the current onboarding state without modifying anything. */
export function caStatus(opts: OnboardingOptions = {}): CaStatusResult {
  const tlsManager = opts.tlsManager ?? new TlsManager();
  const runOpenssl = opts.runOpenssl ?? defaultRunOpenssl;
  const platform = opts.platform ?? process.platform;
  const proxyPort = opts.proxyPort ?? DEFAULT_PROXY_PORT;

  const caPath = tlsManager.caCertPath();
  const backend = detectBackend(platform);
  const envSnippet = backend.buildEnvSnippet(caPath, proxyPort);

  if (!existsSync(caPath)) {
    return { caExists: false, caPath, fingerprint: null, inKeychain: false, envSnippet, proxyPort };
  }

  const fingerprint = computeFingerprint(caPath, runOpenssl);
  const check = backend.checkInstall(caPath, buildBackendOptions(opts, proxyPort));
  return { caExists: true, caPath, fingerprint, inKeychain: check.inTrustStore, envSnippet, proxyPort };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildBackendOptions(opts: OnboardingOptions, proxyPort: number): BackendOptions {
  return {
    home: opts.home ?? process.env.HOME ?? "~",
    runSecurity: opts.runSecurity,
    runOpenssl: opts.runOpenssl,
    runSudo: opts.runSudo,
    runCp: opts.runCp,
    readOsRelease: opts.readOsRelease,
    proxyPort,
  };
}

function computeFingerprint(caPath: string, runOpenssl: CommandRunner): string {
  const r = runOpenssl(["x509", "-in", caPath, "-noout", "-fingerprint", "-sha256"]);
  if (r.status !== 0) return "<unknown>";
  return r.stdout.trim();
}

function defaultRunOpenssl(args: string[]): CommandResult {
  const r: SpawnSyncReturns<Buffer> = spawnSync("openssl", args, { stdio: "pipe" });
  return {
    status: r.status ?? -1,
    stdout: (r.stdout ?? Buffer.from("")).toString("utf-8"),
    stderr: (r.stderr ?? Buffer.from("")).toString("utf-8"),
  };
}

/**
 * Bridge backend's neutral skip messages to the legacy "platform=X" shape
 * that pre-refactor `cli.ts` and unit tests expect on non-darwin platforms.
 *
 * Real LinuxBackend may report something like "unsupported distro" with no
 * platform name; the legacy contract is "keychain install skipped on
 * platform=linux; <details>". This helper prepends the platform tag only
 * when it's not already present, so backends that bake the tag in (e.g.
 * the UnknownBackend) pass through unchanged.
 */
function composeLegacySkipReason(
  platform: NodeJS.Platform,
  op: "install" | "uninstall",
  backendReason: string | undefined,
): string | undefined {
  if (!backendReason) return undefined;
  if (platform === "darwin") return backendReason;
  if (backendReason.includes(`platform=${platform}`)) return backendReason;
  return `keychain ${op} skipped on platform=${platform}; ${backendReason}`;
}
