/**
 * Proxy CA onboarding — Layer 8.
 *
 * Closes the gap between "the proxy daemon works" (Layers 1–7) and "a
 * user can actually USE it without manually fiddling with
 * `security add-trusted-cert` and Keychain Access." Provides:
 *
 *   • installCa()    — generate CA if needed + install in macOS login
 *                      keychain + return env snippet for shell rc
 *   • uninstallCa()  — remove cert from login keychain
 *   • caStatus()     — diagnose current state (CA exists? in keychain?
 *                      what's the fingerprint?)
 *
 * Login keychain (not System) is intentional: it's user-scoped and
 * requires no admin password. GUI tools that read system trust
 * (Cursor, Chrome) still find the cert because macOS's CFNetwork
 * checks both keychains by default.
 *
 * Testability: the `security` and `openssl` invocations are exposed
 * via injectable runner options. Default runners call the real
 * binaries; tests pass fakes to avoid polluting the user's keychain.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { TlsManager } from "./tls.js";

/** The daemon's default proxy port — also used to compose the HTTPS_PROXY env snippet. */
export const DEFAULT_PROXY_PORT = 7727;

/** Common Name on the generated CA — used as the lookup key for keychain ops. */
const CA_COMMON_NAME = "Synapse Proxy CA";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Injectable runner for the `security` command — tests pass a fake. */
export type SecurityRunner = (args: string[]) => CommandResult;

/** Injectable runner for `openssl` (fingerprint computation only). */
export type OpensslRunner = (args: string[]) => CommandResult;

export interface OnboardingOptions {
  tlsManager?: TlsManager;
  runSecurity?: SecurityRunner;
  runOpenssl?: OpensslRunner;
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
  /** True iff the cert is present in the login keychain after the install. */
  installedInKeychain: boolean;
  /**
   * Step-by-step manual install instructions. Always included — useful even
   * on a successful auto-install for users who want to verify or reapply.
   */
  manualInstallInstructions: string;
  /** Shell snippet for the user to paste into ~/.zshrc or ~/.bashrc. */
  envSnippet: string;
  /** Proxy port advertised in envSnippet. */
  proxyPort: number;
  /** Soft-skip reason on non-macOS platforms. */
  skippedReason?: string;
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
  inKeychain: boolean;
  envSnippet: string;
  proxyPort: number;
}

/**
 * Generate the CA (if not present) and install it into the user's
 * login keychain with SSL trust. Returns the env snippet + manual
 * fallback instructions either way.
 */
export function installCa(opts: OnboardingOptions = {}): InstallCaResult {
  const tlsManager = opts.tlsManager ?? new TlsManager();
  const runSecurity = opts.runSecurity ?? defaultRunSecurity;
  const runOpenssl = opts.runOpenssl ?? defaultRunOpenssl;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? process.env.HOME ?? "~";
  const proxyPort = opts.proxyPort ?? DEFAULT_PROXY_PORT;

  tlsManager.ensureCa();
  const caPath = tlsManager.caCertPath();
  const fingerprint = computeFingerprint(caPath, runOpenssl);
  const envSnippet = buildEnvSnippet(caPath, proxyPort);
  const manualInstallInstructions = buildManualInstructions(caPath, proxyPort);

  if (platform !== "darwin") {
    return {
      caPath,
      fingerprint,
      installedInKeychain: false,
      manualInstallInstructions,
      envSnippet,
      proxyPort,
      skippedReason: `keychain install skipped on platform=${platform}; follow manual instructions to install in your OS trust store`,
    };
  }

  const loginKeychain = path.join(home, "Library/Keychains/login.keychain-db");
  // `add-trusted-cert` without `-d` adds the cert + sets trust at the
  // USER domain (no admin password needed). `-r trustRoot` marks it as
  // a root CA for SSL; `-k <login.keychain>` scopes storage.
  runSecurity(["add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-k", loginKeychain, caPath]);

  // Post-verify: did the cert actually land in the keychain? The
  // `security` command might exit 0 even if a GUI prompt was dismissed,
  // so we use find-certificate as the source of truth.
  const verify = runSecurity(["find-certificate", "-c", CA_COMMON_NAME, loginKeychain]);
  const installedInKeychain = verify.status === 0;

  return {
    caPath,
    fingerprint,
    installedInKeychain,
    manualInstallInstructions,
    envSnippet,
    proxyPort,
  };
}

/**
 * Remove the Synapse CA from the user's login keychain. Best-effort —
 * if no cert is present, reports `removed: false` rather than erroring.
 * Leaves the on-disk CA pem in `~/.synapse/proxy/ca.pem` untouched so
 * the user can reinstall without regenerating.
 */
export function uninstallCa(opts: OnboardingOptions = {}): UninstallCaResult {
  const tlsManager = opts.tlsManager ?? new TlsManager();
  const runSecurity = opts.runSecurity ?? defaultRunSecurity;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? process.env.HOME ?? "~";

  const caPath = tlsManager.caCertPath();
  if (!existsSync(caPath)) {
    return { removed: false, skippedReason: "no CA cert present on disk" };
  }
  if (platform !== "darwin") {
    return { removed: false, skippedReason: `keychain uninstall skipped on platform=${platform}` };
  }

  const loginKeychain = path.join(home, "Library/Keychains/login.keychain-db");
  // `delete-certificate -c <CN>` finds and removes the cert AND its
  // trust settings. If not present, exits 44 (errSecItemNotFound).
  const r = runSecurity(["delete-certificate", "-c", CA_COMMON_NAME, loginKeychain]);
  return { removed: r.status === 0 };
}

/** Diagnose the current onboarding state without modifying anything. */
export function caStatus(opts: OnboardingOptions = {}): CaStatusResult {
  const tlsManager = opts.tlsManager ?? new TlsManager();
  const runSecurity = opts.runSecurity ?? defaultRunSecurity;
  const runOpenssl = opts.runOpenssl ?? defaultRunOpenssl;
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? process.env.HOME ?? "~";
  const proxyPort = opts.proxyPort ?? DEFAULT_PROXY_PORT;

  const caPath = tlsManager.caCertPath();
  const envSnippet = buildEnvSnippet(caPath, proxyPort);

  if (!existsSync(caPath)) {
    return { caExists: false, caPath, fingerprint: null, inKeychain: false, envSnippet, proxyPort };
  }

  const fingerprint = computeFingerprint(caPath, runOpenssl);
  let inKeychain = false;
  if (platform === "darwin") {
    const loginKeychain = path.join(home, "Library/Keychains/login.keychain-db");
    const r = runSecurity(["find-certificate", "-c", CA_COMMON_NAME, loginKeychain]);
    inKeychain = r.status === 0;
  }
  return { caExists: true, caPath, fingerprint, inKeychain, envSnippet, proxyPort };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildEnvSnippet(caPath: string, proxyPort: number): string {
  return [
    "# Synapse proxy — add to ~/.zshrc, ~/.bashrc, or equivalent",
    `export NODE_EXTRA_CA_CERTS="${caPath}"`,
    `export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"`,
  ].join("\n");
}

function buildManualInstructions(caPath: string, proxyPort: number): string {
  return [
    "If the keychain install failed or you prefer manual steps:",
    "  1. Open Keychain Access (Applications → Utilities → Keychain Access)",
    `  2. Drag ${caPath} into the "login" keychain`,
    '  3. Double-click the cert; expand Trust; set SSL to "Always Trust"',
    "",
    "Then add to your shell rc:",
    `  export NODE_EXTRA_CA_CERTS="${caPath}"`,
    `  export HTTPS_PROXY="http://127.0.0.1:${proxyPort}"`,
    "",
    "Finally restart the daemon: synapsesync capture stop && synapsesync capture start",
  ].join("\n");
}

function computeFingerprint(caPath: string, runOpenssl: OpensslRunner): string {
  const r = runOpenssl(["x509", "-in", caPath, "-noout", "-fingerprint", "-sha256"]);
  if (r.status !== 0) return "<unknown>";
  return r.stdout.trim();
}

function defaultRunSecurity(args: string[]): CommandResult {
  return runBinary("security", args);
}

function defaultRunOpenssl(args: string[]): CommandResult {
  return runBinary("openssl", args);
}

function runBinary(bin: string, args: string[]): CommandResult {
  const r: SpawnSyncReturns<Buffer> = spawnSync(bin, args, { stdio: "pipe" });
  return {
    status: r.status ?? -1,
    stdout: (r.stdout ?? Buffer.from("")).toString("utf-8"),
    stderr: (r.stderr ?? Buffer.from("")).toString("utf-8"),
  };
}
