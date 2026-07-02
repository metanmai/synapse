// mcp/test/capture/proxy/onboarding.test.ts
//
// Dispatcher-focused tests after the Slice A.5 split. Backend-level
// install/uninstall behavior lives in backends/{mac,linux}.test.ts;
// this file guards:
//
//   - Dispatcher ROUTING: platform=darwin → MacBackend, platform=linux
//     → LinuxBackend, platform=win32 → WindowsBackend, anything else
//     (e.g. freebsd) → UnknownBackend (proven by which injected runner
//     gets called).
//   - LEGACY FIELD-NAME preservation: `installedInKeychain` (not
//     `installed`), `inKeychain` (not `inTrustStore`) — `cli.ts` reads
//     these names, breaking them would break the CLI.
//   - LEGACY skipReason bridge: non-darwin backend reasons get
//     "platform=X" prefixed if absent so existing callers keep working.
//   - Dispatcher INVARIANTS: caPath matches TlsManager (no drift), env
//     snippet port plumbing flows through, CA-absent-on-disk short-circuits
//     work BEFORE invoking the backend.
//
// Critical discipline: EVERY non-darwin test injects readOsRelease +
// runSudo + runCp so the real `/etc/os-release` is never read and the
// real `sudo` is never invoked. This is what makes the suite run
// identically on macOS local + Ubuntu CI. (The pre-Slice-A.5 version
// of this file exercised the real defaults on Linux CI, which mutated
// the real system trust store — see commit 668ac01's CI failure.)

import { mkdtempSync, rmSync } from "node:fs";
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
  fakeHome = tmpRoot;
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* */
  }
});

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

// ── Dispatcher routing (the central bug class for this file) ─────────────

describe("dispatcher routing", () => {
  it("platform=darwin invokes MacBackend (runSecurity called, no linux runners touched)", () => {
    const sec = makeRunner([okExit, okExit]);
    const osl = makeRunner([okFingerprint]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);

    installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      readOsRelease: () => null, // belt-and-suspenders
    });

    expect(sec.calls.length).toBeGreaterThan(0);
    expect(sudo.calls).toHaveLength(0);
    expect(cp.calls).toHaveLength(0);
  });

  it("platform=linux invokes LinuxBackend (runSudo/runCp called when family known, runSecurity NEVER called)", () => {
    const sec = makeRunner([okExit, okExit]);
    const osl = makeRunner([okFingerprint]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);

    installCa({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      readOsRelease: () => "ID=ubuntu\nID_LIKE=debian\n",
    });

    expect(sec.calls).toHaveLength(0);
    expect(cp.calls.length).toBeGreaterThan(0);
    expect(sudo.calls.length).toBeGreaterThan(0);
  });

  it("platform=win32 invokes WindowsBackend (powershell for install + certutil for verify, no posix runners touched)", () => {
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const certutil = makeRunner([okExit]); // -store verify
    const powershell = makeRunner([okExit]); // Import-Certificate

    const r = installCa({
      tlsManager,
      platform: "win32",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      runCertutil: certutil.runner,
      runPowerShell: powershell.runner,
      readOsRelease: () => null,
    });

    // Install path: PowerShell Import-Certificate (avoids the Windows
    // Root-store GUI confirmation dialog that hangs CI runners).
    expect(powershell.calls).toHaveLength(1);
    expect(powershell.calls[0][0]).toContain("Import-Certificate");
    expect(powershell.calls[0][0]).toContain("Cert:\\CurrentUser\\Root");
    // Verify path: certutil -store (non-destructive query, no UI prompt).
    expect(certutil.calls).toHaveLength(1);
    expect(certutil.calls[0][0]).toBe("-store");
    // Regression guard: addstore is the operation that hangs.
    expect(certutil.calls[0]).not.toContain("-addstore");
    // POSIX runners must not be touched on win32.
    expect(sec.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(cp.calls).toHaveLength(0);
    // Real install path returns installed=true on verify success — no soft-skip.
    expect(r.installedInKeychain).toBe(true);
    expect(r.skippedReason).toBeUndefined();
  });

  it("platform=freebsd (truly unknown) routes to UnknownBackend — no runners called, soft-skip", () => {
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const certutil = makeRunner([okExit]);

    const r = installCa({
      tlsManager,
      platform: "freebsd",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      runCertutil: certutil.runner,
      readOsRelease: () => null,
    });

    expect(sec.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(cp.calls).toHaveLength(0);
    expect(certutil.calls).toHaveLength(0);
    expect(r.installedInKeychain).toBe(false);
    expect(r.skippedReason).toContain("platform=freebsd");
  });

  it("platform=linux + unknown distro (readOsRelease returns null): no runners called, soft-skip", () => {
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);

    const r = installCa({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      readOsRelease: () => null,
    });

    expect(sec.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(cp.calls).toHaveLength(0);
    expect(r.installedInKeychain).toBe(false);
    expect(r.skippedReason).toContain("platform=linux");
  });
});

// ── Legacy field-name preservation (cli.ts contract) ─────────────────────

describe("legacy field-name preservation", () => {
  it("installCa returns `installedInKeychain` (not `installed`) — cli.ts:203 reads this name", () => {
    const sec = makeRunner([okExit, okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect("installedInKeychain" in r).toBe(true);
    expect(r.installedInKeychain).toBe(true);
    // The neutral name MUST NOT leak through:
    expect((r as unknown as { installed?: unknown }).installed).toBeUndefined();
  });

  it("caStatus returns `inKeychain` (not `inTrustStore`) — cli.ts:237 reads this name", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = caStatus({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
    });
    expect("inKeychain" in r).toBe(true);
    expect(r.inKeychain).toBe(true);
    expect((r as unknown as { inTrustStore?: unknown }).inTrustStore).toBeUndefined();
  });
});

// ── Legacy skipReason bridge (composeLegacySkipReason) ───────────────────

describe("legacy skipReason bridge", () => {
  it("non-darwin: prepends 'keychain install skipped on platform=X' when backend reason lacks it", () => {
    const r = installCa({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: makeRunner([okExit]).runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
      runSudo: makeRunner([okExit]).runner,
      runCp: makeRunner([okExit]).runner,
      readOsRelease: () => "ID=arch\n", // LinuxBackend returns 'unsupported distro...' (no 'platform=linux')
    });
    expect(r.skippedReason).toContain("platform=linux");
    expect(r.skippedReason).toContain("unsupported distro");
  });

  it("non-darwin: passes through unchanged if backend reason already contains 'platform=X' (e.g. UnknownBackend on freebsd)", () => {
    // UnknownBackend produces "...platform=freebsd; follow manual instructions..."
    const r = installCa({
      tlsManager,
      platform: "freebsd",
      home: fakeHome,
      runSecurity: makeRunner([okExit]).runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
      readOsRelease: () => null,
    });
    // No double-prefix: "keychain install skipped on platform=freebsd; keychain install skipped on platform=freebsd; ..."
    const occurrences = (r.skippedReason ?? "").split("platform=freebsd").length - 1;
    expect(occurrences).toBe(1);
  });

  it("darwin: backend's skipReason (if any) passes through unmodified — no platform prefix added", () => {
    // MacBackend doesn't produce skipReason on success path; this guard
    // documents the bridge's darwin-passthrough behavior.
    const r = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: makeRunner([okExit, okExit]).runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
    });
    expect(r.skippedReason).toBeUndefined();
  });

  it("uninstallCa on non-darwin: same bridge applies", () => {
    tlsManager.ensureCa();
    const r = uninstallCa({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: makeRunner([okExit]).runner,
      runSudo: makeRunner([okExit]).runner,
      runCp: makeRunner([okExit]).runner,
      readOsRelease: () => "ID=arch\n",
    });
    expect(r.skippedReason).toContain("platform=linux");
  });
});

// ── Dispatcher invariants ────────────────────────────────────────────────

describe("dispatcher invariants", () => {
  it("caPath matches TlsManager.caCertPath() (drift guard — env snippet must point at the daemon's actual CA)", () => {
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
  });

  it("env snippet port plumbing on darwin: proxyPort=9999 flows through to envSnippet", () => {
    const sec = makeRunner([okExit, okExit]);
    const osl = makeRunner([okFingerprint]);
    const r = installCa({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: osl.runner,
      proxyPort: 9999,
    });
    expect(r.envSnippet).toContain('HTTPS_PROXY="http://127.0.0.1:9999"');
    expect(r.proxyPort).toBe(9999);
  });

  it("env snippet port plumbing on linux: proxyPort=9999 flows through to envSnippet", () => {
    const r = installCa({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: makeRunner([okExit]).runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
      runSudo: makeRunner([okExit]).runner,
      runCp: makeRunner([okExit]).runner,
      readOsRelease: () => "ID=ubuntu\nID_LIKE=debian\n",
      proxyPort: 9999,
    });
    expect(r.envSnippet).toContain('HTTPS_PROXY="http://127.0.0.1:9999"');
    expect(r.proxyPort).toBe(9999);
  });

  it("uninstallCa: CA absent on disk → skip with 'no CA cert present' BEFORE invoking any backend", () => {
    const sec = makeRunner([okExit]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = uninstallCa({
      tlsManager, // CA NOT ensured — file absent on disk
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      readOsRelease: () => null,
    });
    expect(r.removed).toBe(false);
    expect(r.skippedReason).toContain("no CA cert present");
    // Crucial: no backend invocation when CA is missing — the early exit is dispatcher-level.
    expect(sec.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(cp.calls).toHaveLength(0);
  });

  it("caStatus: CA absent on disk → caExists:false + inKeychain:false + no backend.checkInstall call", () => {
    const sec = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = caStatus({
      tlsManager,
      platform: "darwin",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
      runCp: cp.runner,
      readOsRelease: () => null,
    });
    expect(r.caExists).toBe(false);
    expect(r.fingerprint).toBeNull();
    expect(r.inKeychain).toBe(false);
    expect(sec.calls).toHaveLength(0);
    expect(cp.calls).toHaveLength(0);
    // Env snippet still computed so the user has the info they need.
    expect(r.envSnippet).toContain("NODE_EXTRA_CA_CERTS");
    expect(r.envSnippet).toContain("HTTPS_PROXY");
  });

  it("caStatus on linux with CA present + unknown distro: inKeychain:false, no runSecurity calls", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]);
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = caStatus({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
      runSudo: sudo.runner,
      runCp: cp.runner,
      readOsRelease: () => null, // unknown distro
    });
    expect(r.caExists).toBe(true);
    expect(r.inKeychain).toBe(false);
    expect(sec.calls).toHaveLength(0);
    // unknown distro: linux backend's checkInstall returns inTrustStore:false WITHOUT calling cp
    expect(cp.calls).toHaveLength(0);
  });

  it("caStatus on linux with CA present + known distro: inKeychain reflects runCp result", () => {
    tlsManager.ensureCa();
    const sec = makeRunner([okExit]);
    const cp = makeRunner([okExit]); // test -f returns 0 = file exists
    const r = caStatus({
      tlsManager,
      platform: "linux",
      home: fakeHome,
      runSecurity: sec.runner,
      runOpenssl: makeRunner([okFingerprint]).runner,
      runCp: cp.runner,
      readOsRelease: () => "ID=ubuntu\nID_LIKE=debian\n",
    });
    expect(r.caExists).toBe(true);
    expect(r.inKeychain).toBe(true); // runCp returned 0
    expect(sec.calls).toHaveLength(0); // mac runner never touched
    expect(cp.calls).toHaveLength(1);
    expect(cp.calls[0]).toEqual(["test", "-f", "/etc/ssl/certs/synapse.pem"]);
  });
});
