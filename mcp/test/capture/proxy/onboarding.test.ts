// mcp/test/capture/proxy/onboarding.test.ts
//
// Bug class: "the onboarding (a) silently reports success on a failed
// install, (b) calls `security` with wrong arguments and sets the
// wrong trust scope, (c) returns a caPath that drifts from what the
// daemon actually uses, (d) crashes on non-macOS instead of degrading
// to manual-instructions mode, OR (e) leaves stale trust settings
// after uninstall."
//
// The keychain (`security` binary) and fingerprint (`openssl`)
// operations are injected as runners — tests pass fakes to avoid
// touching the user's real login keychain.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommandResult, caStatus, installCa, uninstallCa } from "../../../src/capture/proxy/onboarding.js";
import { TlsManager } from "../../../src/capture/proxy/tls.js";

let tmpRoot: string;
let tlsManager: TlsManager;
let fakeHome: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-onboarding-"));
  tlsManager = new TlsManager({ caDir: tmpRoot });
  fakeHome = tmpRoot; // doesn't matter — runners are mocked
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* */
  }
});

/** Build a recorder/runner pair: records every invocation; returns
 *  canned results by call sequence. */
function makeRunner(results: CommandResult[]): {
  runner: (args: string[]) => CommandResult;
  calls: string[][];
} {
  const calls: string[][] = [];
  const queue = [...results];
  return {
    calls,
    runner: (args) => {
      calls.push(args);
      // Last result repeats if calls exceed queue length.
      return queue.shift() ?? results[results.length - 1] ?? { status: 0, stdout: "", stderr: "" };
    },
  };
}

const okFingerprint: CommandResult = {
  status: 0,
  stdout: "SHA256 Fingerprint=AA:BB:CC:DD:EE:FF...\n",
  stderr: "",
};
const okExit: CommandResult = { status: 0, stdout: "", stderr: "" };
const errExit: CommandResult = { status: 44, stdout: "", stderr: "error" };

describe("installCa", () => {
  it("on darwin: invokes `security add-trusted-cert` with -r trustRoot -p ssl and the login keychain path", () => {
    const sec = makeRunner([okExit, okExit]); // add-trusted-cert, find-certificate (verify)
    const osl = makeRunner([okFingerprint]);
    const r = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });

    expect(sec.calls).toHaveLength(2);
    const [installArgs, verifyArgs] = sec.calls;
    // The install call: `add-trusted-cert -r trustRoot -p ssl -k <login.keychain-db> <caPath>`
    expect(installArgs[0]).toBe("add-trusted-cert");
    expect(installArgs).toContain("-r");
    expect(installArgs).toContain("trustRoot");
    expect(installArgs).toContain("-p");
    expect(installArgs).toContain("ssl");
    expect(installArgs).toContain(path.join(fakeHome, "Library/Keychains/login.keychain-db"));
    expect(installArgs).toContain(r.caPath);
    // The verify call: `find-certificate -c "Synapse Proxy CA" <login.keychain-db>`
    expect(verifyArgs[0]).toBe("find-certificate");
    expect(verifyArgs).toContain("-c");
    expect(verifyArgs).toContain("Synapse Proxy CA");

    expect(r.installedInKeychain).toBe(true);
    expect(r.proxyPort).toBe(7727);
    expect(r.skippedReason).toBeUndefined();
  });

  it("reports installedInKeychain=false when post-install verify fails (graceful degrade)", () => {
    // Bug class: security exits 0 even when GUI prompt is dismissed —
    // we must NOT trust its exit code; verify-via-find is the source
    // of truth.
    const sec = makeRunner([okExit, errExit]); // add succeeded, verify failed
    const osl = makeRunner([okFingerprint]);
    const r = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(r.installedInKeychain).toBe(false);
    // Manual instructions still included — user has a fallback path.
    expect(r.manualInstallInstructions).toContain("Keychain Access");
  });

  it("on non-darwin (linux/win32): skips the security call entirely + returns skippedReason + manual instructions", () => {
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = installCa({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(sec.calls).toHaveLength(0); // never invoked
    expect(r.installedInKeychain).toBe(false);
    expect(r.skippedReason).toContain("platform=linux");
    // Env snippet + manual instructions still useful on non-mac.
    expect(r.envSnippet).toContain("NODE_EXTRA_CA_CERTS");
    expect(r.envSnippet).toContain("HTTPS_PROXY");
    expect(r.manualInstallInstructions.length).toBeGreaterThan(0);
  });

  it("env snippet contains both env vars + the configured proxy port (drift-free with daemon)", () => {
    // Bug class: env snippet advertises a port the daemon doesn't
    // actually bind to. Port is parameterized; default = 7727.
    const sec = makeRunner([okExit, okExit]);
    const osl = makeRunner([okFingerprint]);

    const rDefault = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(rDefault.envSnippet).toContain('HTTPS_PROXY="http://127.0.0.1:7727"');
    expect(rDefault.envSnippet).toContain(`NODE_EXTRA_CA_CERTS="${rDefault.caPath}"`);

    // Custom port flows through.
    const rCustom = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      proxyPort: 9999,
    });
    expect(rCustom.envSnippet).toContain('HTTPS_PROXY="http://127.0.0.1:9999"');
    expect(rCustom.proxyPort).toBe(9999);
  });

  it("caPath returned by installCa matches TlsManager.caCertPath() (no drift)", () => {
    // Bug class: if installCa returns a path different from what the
    // daemon's TlsManager actually produces, the env snippet points
    // at a non-existent file.
    const sec = makeRunner([okExit, okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(r.caPath).toBe(tlsManager.caCertPath());
    expect(existsSync(r.caPath)).toBe(true); // ensureCa actually created it
  });
});

describe("uninstallCa", () => {
  it('on darwin with CA present: invokes `security delete-certificate -c "Synapse Proxy CA"`', () => {
    // Ensure a CA exists first.
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]);
    const r = uninstallCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
    });
    expect(sec.calls).toHaveLength(1);
    expect(sec.calls[0][0]).toBe("delete-certificate");
    expect(sec.calls[0]).toContain("-c");
    expect(sec.calls[0]).toContain("Synapse Proxy CA");
    expect(r.removed).toBe(true);
  });

  it("reports removed=false when the security command errors (cert not in keychain)", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([errExit]);
    const r = uninstallCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
    });
    expect(r.removed).toBe(false);
  });

  it("when CA pem is absent on disk: skips with reason, never calls security", () => {
    const sec = makeRunner([okExit]);
    const r = uninstallCa({
      tlsManager, // CA not ensured — no cert file on disk
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
    });
    expect(sec.calls).toHaveLength(0);
    expect(r.removed).toBe(false);
    expect(r.skippedReason).toContain("no CA cert present");
  });

  it("on non-darwin: soft-skips with skippedReason even when CA exists", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]);
    const r = uninstallCa({
      tlsManager,
      platform: "win32",
      home: fakeHome,
      runSecurity: sec.runner,
    });
    expect(sec.calls).toHaveLength(0);
    expect(r.removed).toBe(false);
    expect(r.skippedReason).toContain("platform=win32");
  });
});

describe("caStatus", () => {
  it("when CA doesn't exist: caExists=false, no fingerprint, no keychain call", () => {
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = caStatus({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(r.caExists).toBe(false);
    expect(r.fingerprint).toBeNull();
    expect(r.inKeychain).toBe(false);
    expect(sec.calls).toHaveLength(0);
    expect(osl.calls).toHaveLength(0);
    // Env snippet is still computed so the user sees what they NEED.
    expect(r.envSnippet).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("when CA exists: returns fingerprint + checks keychain on darwin", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]); // find-certificate succeeds
    const osl = makeRunner([okFingerprint]);
    const r = caStatus({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(r.caExists).toBe(true);
    expect(r.fingerprint).toContain("SHA256");
    expect(r.inKeychain).toBe(true);
    expect(sec.calls[0][0]).toBe("find-certificate");
  });

  it("on non-darwin with CA present: skips keychain check", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = caStatus({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect(r.caExists).toBe(true);
    expect(r.inKeychain).toBe(false);
    expect(sec.calls).toHaveLength(0);
  });
});
