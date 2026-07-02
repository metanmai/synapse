/**
 * macOS backend — installs the Synapse Proxy CA into the user's login
 * keychain via the `security` binary. User-scoped (no admin required);
 * GUI tools that consult system trust (Cursor, Chrome) still pick it
 * up because CFNetwork checks both keychains by default.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  type BackendOptions,
  type CommandResult,
  type CommandRunner,
  type PlatformBackend,
  buildSharedEnvSnippet,
} from "./types.js";

/** Common Name on the generated CA — used as the lookup key for keychain ops. */
const CA_COMMON_NAME = "Synapse Proxy CA";

function loginKeychainPath(home: string): string {
  // macOS-only path — use path.posix.join so unit tests on a Windows
  // runner asserting this string get forward-slash separators (matching
  // the production-on-darwin output). path.join would produce backslashes
  // on Windows runtime, breaking cross-OS unit assertions.
  return path.posix.join(home, "Library/Keychains/login.keychain-db");
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

function resolveRunSecurity(opts: BackendOptions): CommandRunner {
  return opts.runSecurity ?? defaultRunSecurity;
}

function resolveHome(opts: BackendOptions): string {
  // `os.homedir()` works on every platform; MacBackend only runs on
  // darwin (where HOME is also always set), but the consistent pattern
  // avoids the literal `"~"` footgun seen on Windows in store.ts.
  return opts.home ?? os.homedir();
}

export const MacBackend: PlatformBackend = {
  name: "mac",

  installCa(caPath, opts) {
    const runSecurity = resolveRunSecurity(opts);
    const home = resolveHome(opts);
    const proxyPort = opts.proxyPort ?? 7727;
    const loginKeychain = loginKeychainPath(home);

    runSecurity(["add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-k", loginKeychain, caPath]);

    const verify = runSecurity(["find-certificate", "-c", CA_COMMON_NAME, loginKeychain]);
    const installed = verify.status === 0;

    return {
      installed,
      caPath,
      fingerprint: "",
      envSnippet: this.buildEnvSnippet(caPath, proxyPort),
      manualInstallInstructions: this.buildManualInstructions(caPath, proxyPort),
      proxyPort,
    };
  },

  uninstallCa(_caPath, opts) {
    const runSecurity = resolveRunSecurity(opts);
    const home = resolveHome(opts);
    const loginKeychain = loginKeychainPath(home);

    const r = runSecurity(["delete-certificate", "-c", CA_COMMON_NAME, loginKeychain]);
    return { removed: r.status === 0 };
  },

  checkInstall(_caPath, opts) {
    const runSecurity = resolveRunSecurity(opts);
    const home = resolveHome(opts);
    const loginKeychain = loginKeychainPath(home);

    const r = runSecurity(["find-certificate", "-c", CA_COMMON_NAME, loginKeychain]);
    return { caExists: true, inTrustStore: r.status === 0, fingerprint: null };
  },

  buildEnvSnippet(caPath, proxyPort) {
    return buildSharedEnvSnippet(caPath, proxyPort);
  },

  buildManualInstructions(caPath, proxyPort) {
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
  },
};

export { defaultRunSecurity, defaultRunOpenssl };
