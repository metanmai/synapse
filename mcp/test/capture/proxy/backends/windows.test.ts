// mcp/test/capture/proxy/backends/windows.test.ts
//
// Bug class: "the windows backend (a) invokes certutil with wrong args
// or wrong store scope (e.g. machine instead of CurrentUser), (b)
// silently reports success when post-install verify fails, (c) leaves
// stale trust settings after uninstall, (d) ships an env snippet that
// only covers PowerShell OR only covers cmd (must cover both per spec
// §5.3), OR (e) omits the certmgr.msc fallback for GPO-blocked systems."
//
// Every certutil invocation is injected. Tests never touch the real
// CurrentUser Root store on any machine they're run from.

import { describe, expect, it } from "vitest";
import type { BackendOptions, CommandResult } from "../../../../src/capture/proxy/backends/types.js";
import { WindowsBackend } from "../../../../src/capture/proxy/backends/windows.js";

const FAKE_CA_PATH = "C:\\Users\\test\\.synapse\\proxy\\ca.pem";

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

const okExit: CommandResult = { status: 0, stdout: "", stderr: "" };
const errExit: CommandResult = { status: 1, stdout: "", stderr: "CertUtil: -store command FAILED: 0x80092004" };

function backendOpts(runCertutil: (args: string[]) => CommandResult, proxyPort = 7727): BackendOptions {
  return { runCertutil, proxyPort };
}

// ── installCa (bug classes a, b) ─────────────────────────────────────────

describe("WindowsBackend.installCa", () => {
  it("invokes `certutil -addstore -user -f Root <caPath>` (CurrentUser scope, force-overwrite)", () => {
    const c = makeRunner([okExit, okExit]); // addstore + verify
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(c.runner));

    expect(c.calls).toHaveLength(2);
    const [installArgs, verifyArgs] = c.calls;
    // Bug class (a): exact certutil args.
    expect(installArgs).toEqual(["-addstore", "-user", "-f", "Root", FAKE_CA_PATH]);
    // -user is CRITICAL: ensures CurrentUser scope (no UAC, no admin).
    expect(installArgs).toContain("-user");
    // Root: "Trusted Root Certification Authorities"
    expect(installArgs).toContain("Root");
    // Bug class (b): verify call must follow.
    expect(verifyArgs).toEqual(["-store", "-user", "Root", "Synapse Proxy CA"]);

    expect(r.installed).toBe(true);
    expect(r.proxyPort).toBe(7727);
  });

  it("installed=false when post-install verify (-store) fails — bug class (b)", () => {
    // certutil -addstore can succeed-but-not-store under GPO restrictions
    // (silent failure). -store query is the source of truth.
    const c = makeRunner([okExit, errExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(c.runner));
    expect(r.installed).toBe(false);
  });

  it("env snippet shape — bug class (d): contains BOTH PowerShell + cmd syntaxes (spec §5.3)", () => {
    const c = makeRunner([okExit, okExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(c.runner, 9999));
    // PowerShell session form
    expect(r.envSnippet).toContain(`$env:NODE_EXTRA_CA_CERTS = "${FAKE_CA_PATH}"`);
    expect(r.envSnippet).toContain('$env:HTTPS_PROXY = "http://127.0.0.1:9999"');
    // PowerShell persistent form
    expect(r.envSnippet).toContain("SetEnvironmentVariable");
    // cmd form
    expect(r.envSnippet).toContain(`setx NODE_EXTRA_CA_CERTS "${FAKE_CA_PATH}"`);
    expect(r.envSnippet).toContain('setx HTTPS_PROXY "http://127.0.0.1:9999"');
    expect(r.proxyPort).toBe(9999);
  });

  it("manualInstallInstructions name certmgr.msc — bug class (e): GPO fallback path documented", () => {
    const c = makeRunner([okExit, okExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(c.runner));
    expect(r.manualInstallInstructions).toContain("certmgr.msc");
    expect(r.manualInstallInstructions).toContain("Trusted Root Certification Authorities");
    expect(r.manualInstallInstructions).toContain(FAKE_CA_PATH);
  });

  it("custom proxy port flows through to envSnippet (drift guard)", () => {
    const c = makeRunner([okExit, okExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(c.runner, 9999));
    expect(r.envSnippet).toContain("9999");
    expect(r.envSnippet).not.toContain("7727");
    expect(r.proxyPort).toBe(9999);
  });
});

// ── uninstallCa (bug class c) ────────────────────────────────────────────

describe("WindowsBackend.uninstallCa", () => {
  it('invokes `certutil -delstore -user Root "Synapse Proxy CA"` (CurrentUser scope, CN lookup)', () => {
    const c = makeRunner([okExit]);
    const r = WindowsBackend.uninstallCa(FAKE_CA_PATH, backendOpts(c.runner));
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toEqual(["-delstore", "-user", "Root", "Synapse Proxy CA"]);
    // Bug class (c): must be -user scope, not machine.
    expect(c.calls[0]).toContain("-user");
    expect(r.removed).toBe(true);
  });

  it("removed=false when certutil errors (cert not in store)", () => {
    const c = makeRunner([errExit]);
    const r = WindowsBackend.uninstallCa(FAKE_CA_PATH, backendOpts(c.runner));
    expect(r.removed).toBe(false);
  });
});

// ── checkInstall ─────────────────────────────────────────────────────────

describe("WindowsBackend.checkInstall", () => {
  it('invokes `certutil -store -user Root "Synapse Proxy CA"` and reports inTrustStore on exit 0', () => {
    const c = makeRunner([okExit]);
    const r = WindowsBackend.checkInstall(FAKE_CA_PATH, backendOpts(c.runner));
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toEqual(["-store", "-user", "Root", "Synapse Proxy CA"]);
    expect(r.inTrustStore).toBe(true);
  });

  it("returns inTrustStore:false on certutil error (cert absent from store)", () => {
    const c = makeRunner([errExit]);
    const r = WindowsBackend.checkInstall(FAKE_CA_PATH, backendOpts(c.runner));
    expect(r.inTrustStore).toBe(false);
  });
});

// ── Backend identity ─────────────────────────────────────────────────────

describe("WindowsBackend identity", () => {
  it('declares name="windows" (dispatcher relies on this for routing tests)', () => {
    expect(WindowsBackend.name).toBe("windows");
  });
});
