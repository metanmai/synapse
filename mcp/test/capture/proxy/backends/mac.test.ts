// mcp/test/capture/proxy/backends/mac.test.ts
//
// Bug class: "the macOS backend (a) calls `security` with wrong args /
// wrong trust scope, (b) silently reports success when post-install
// verify fails, (c) leaves stale trust settings after uninstall, OR
// (d) ships a wrong-shaped env snippet for the configured port."
//
// All `security` invocations are injected — tests never touch the real
// login keychain. Driven against MacBackend directly so the dispatcher
// is out of the test surface (the dispatcher's job is exercised in
// onboarding.test.ts).

import { describe, expect, it } from "vitest";
import { MacBackend } from "../../../../src/capture/proxy/backends/mac.js";
import type { BackendOptions, CommandResult } from "../../../../src/capture/proxy/backends/types.js";

const FAKE_CA_PATH = "/tmp/fake-synapse-ca.pem";
const FAKE_HOME = "/tmp/fake-home";

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
const errExit: CommandResult = { status: 44, stdout: "", stderr: "errSecItemNotFound" };

function backendOpts(runSecurity: (args: string[]) => CommandResult, proxyPort = 7727): BackendOptions {
  return { home: FAKE_HOME, runSecurity, proxyPort };
}

describe("MacBackend.installCa", () => {
  it("invokes `security add-trusted-cert -r trustRoot -p ssl -k <login.keychain-db>` (correct args + user-scope)", () => {
    const sec = makeRunner([okExit, okExit]); // add + verify
    const r = MacBackend.installCa(FAKE_CA_PATH, backendOpts(sec.runner));

    expect(sec.calls).toHaveLength(2);
    const [installArgs, verifyArgs] = sec.calls;
    expect(installArgs[0]).toBe("add-trusted-cert");
    expect(installArgs).toContain("-r");
    expect(installArgs).toContain("trustRoot");
    expect(installArgs).toContain("-p");
    expect(installArgs).toContain("ssl");
    expect(installArgs).toContain(`${FAKE_HOME}/Library/Keychains/login.keychain-db`);
    expect(installArgs).toContain(FAKE_CA_PATH);
    expect(verifyArgs[0]).toBe("find-certificate");
    expect(verifyArgs).toContain("-c");
    expect(verifyArgs).toContain("Synapse Proxy CA");

    expect(r.installed).toBe(true);
    expect(r.proxyPort).toBe(7727);
  });

  it("installed=false when post-install verify fails (security exits 0 but find-certificate misses)", () => {
    // Bug class (b): security exits 0 even when GUI prompt is dismissed.
    // The find-certificate verify is the source of truth.
    const sec = makeRunner([okExit, errExit]);
    const r = MacBackend.installCa(FAKE_CA_PATH, backendOpts(sec.runner));
    expect(r.installed).toBe(false);
  });

  it("env snippet contains both env vars + the configured proxy port", () => {
    const sec = makeRunner([okExit, okExit]);
    const r = MacBackend.installCa(FAKE_CA_PATH, backendOpts(sec.runner, 9999));
    expect(r.envSnippet).toContain(`NODE_EXTRA_CA_CERTS="${FAKE_CA_PATH}"`);
    expect(r.envSnippet).toContain('HTTPS_PROXY="http://127.0.0.1:9999"');
    expect(r.proxyPort).toBe(9999);
  });

  it("manualInstallInstructions still included even on successful install (always-available fallback)", () => {
    const sec = makeRunner([okExit, okExit]);
    const r = MacBackend.installCa(FAKE_CA_PATH, backendOpts(sec.runner));
    expect(r.manualInstallInstructions).toContain("Keychain Access");
    expect(r.manualInstallInstructions).toContain(FAKE_CA_PATH);
  });
});

describe("MacBackend.uninstallCa", () => {
  it('invokes `security delete-certificate -c "Synapse Proxy CA"` against login.keychain-db', () => {
    const sec = makeRunner([okExit]);
    const r = MacBackend.uninstallCa(FAKE_CA_PATH, backendOpts(sec.runner));
    expect(sec.calls).toHaveLength(1);
    expect(sec.calls[0][0]).toBe("delete-certificate");
    expect(sec.calls[0]).toContain("-c");
    expect(sec.calls[0]).toContain("Synapse Proxy CA");
    expect(sec.calls[0]).toContain(`${FAKE_HOME}/Library/Keychains/login.keychain-db`);
    expect(r.removed).toBe(true);
  });

  it("removed=false when security returns error (cert not in keychain)", () => {
    const sec = makeRunner([errExit]);
    const r = MacBackend.uninstallCa(FAKE_CA_PATH, backendOpts(sec.runner));
    expect(r.removed).toBe(false);
  });
});

describe("MacBackend.checkInstall", () => {
  it("invokes find-certificate and returns inTrustStore:true on success", () => {
    const sec = makeRunner([okExit]);
    const r = MacBackend.checkInstall(FAKE_CA_PATH, backendOpts(sec.runner));
    expect(sec.calls).toHaveLength(1);
    expect(sec.calls[0][0]).toBe("find-certificate");
    expect(sec.calls[0]).toContain("-c");
    expect(sec.calls[0]).toContain("Synapse Proxy CA");
    expect(r.inTrustStore).toBe(true);
  });

  it("returns inTrustStore:false on security error (cert absent from keychain)", () => {
    const sec = makeRunner([errExit]);
    const r = MacBackend.checkInstall(FAKE_CA_PATH, backendOpts(sec.runner));
    expect(r.inTrustStore).toBe(false);
  });
});
