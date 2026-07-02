// mcp/test/capture/proxy/backends/linux.test.ts
//
// Bug class: "the linux backend (a) misdetects distro family for any
// of the supported IDs or ID_LIKE inheritance cases, (b) writes the CA
// to the wrong trust-store path for the detected family, (c) invokes
// the wrong update tool (`update-ca-certificates` vs `update-ca-trust
// extract`) for the family, (d) crashes or throws when sudo refuses
// instead of soft-failing with `requiresSudo: true`, (e) silently
// 'succeeds' for unknown distros instead of soft-skipping with manual
// instructions, OR (f) routes Arch into RHEL family (the trap distro)."
//
// Every `runSudo` / `runCp` / `readOsRelease` invocation is injected.
// No test ever spawns sudo, reads /etc/os-release, or writes to the
// real system trust store — same outcome on macOS local and Ubuntu CI.

import { describe, expect, it } from "vitest";
import { LinuxBackend, detectDistroFamily } from "../../../../src/capture/proxy/backends/linux.js";
import type { BackendOptions, CommandResult } from "../../../../src/capture/proxy/backends/types.js";

const FAKE_CA_PATH = "/tmp/fake-synapse-ca.pem";

/** Fixture strings — verbatim shapes from each distro's /etc/os-release. */
const FIXTURES = {
  debian: 'ID=debian\nVERSION_ID="12"\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
  ubuntu: 'ID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"\n',
  linuxmint: 'ID=linuxmint\nID_LIKE="ubuntu debian"\nVERSION_ID="21.3"\n',
  fedora: "ID=fedora\nVERSION_ID=40\n",
  rhel: 'ID="rhel"\nID_LIKE="fedora"\nVERSION_ID="9.4"\n',
  rocky: 'ID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\n',
  arch: "ID=arch\n",
  manjaro: "ID=manjaro\nID_LIKE=arch\n",
  nixos: 'ID=nixos\nVERSION_ID="24.05"\n',
  gentoo: "ID=gentoo\n",
};

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
const errExit: CommandResult = { status: 1, stdout: "", stderr: "sudo: a password is required" };

function backendOpts(
  family:
    | "debian"
    | "rhel"
    | "arch"
    | "nixos"
    | "ubuntu"
    | "linuxmint"
    | "fedora"
    | "rocky"
    | "manjaro"
    | "gentoo"
    | "missing",
  sudo: ReturnType<typeof makeRunner>,
  cp: ReturnType<typeof makeRunner>,
  proxyPort = 7727,
): BackendOptions {
  return {
    runSudo: sudo.runner,
    runCp: cp.runner,
    readOsRelease: () => (family === "missing" ? null : FIXTURES[family]),
    proxyPort,
  };
}

// ── Distro detection (pure function — bug class (a) + (f)) ───────────────

describe("detectDistroFamily", () => {
  it("Debian (ID=debian) → debian-family", () => {
    expect(detectDistroFamily(FIXTURES.debian)).toBe("debian");
  });
  it("Ubuntu (ID=ubuntu + ID_LIKE=debian) → debian-family via ID_LIKE inheritance", () => {
    expect(detectDistroFamily(FIXTURES.ubuntu)).toBe("debian");
  });
  it('Linux Mint (ID=linuxmint + ID_LIKE="ubuntu debian") → debian-family via multi-token ID_LIKE', () => {
    expect(detectDistroFamily(FIXTURES.linuxmint)).toBe("debian");
  });
  it("Fedora (ID=fedora) → rhel-family", () => {
    expect(detectDistroFamily(FIXTURES.fedora)).toBe("rhel");
  });
  it('RHEL (ID="rhel" + ID_LIKE="fedora") → rhel-family (quoted ID parsing)', () => {
    expect(detectDistroFamily(FIXTURES.rhel)).toBe("rhel");
  });
  it('Rocky Linux (ID_LIKE="rhel centos fedora") → rhel-family via multi-token ID_LIKE', () => {
    expect(detectDistroFamily(FIXTURES.rocky)).toBe("rhel");
  });
  it("Arch (ID=arch) → unknown — bug class (f): the trap distro must NOT route to rhel/debian", () => {
    expect(detectDistroFamily(FIXTURES.arch)).toBe("unknown");
  });
  it("Manjaro (ID=manjaro + ID_LIKE=arch) → unknown", () => {
    expect(detectDistroFamily(FIXTURES.manjaro)).toBe("unknown");
  });
  it("NixOS (ID=nixos) → unknown", () => {
    expect(detectDistroFamily(FIXTURES.nixos)).toBe("unknown");
  });
  it("Gentoo (ID=gentoo) → unknown", () => {
    expect(detectDistroFamily(FIXTURES.gentoo)).toBe("unknown");
  });
  it("null (no /etc/os-release present) → unknown", () => {
    expect(detectDistroFamily(null)).toBe("unknown");
  });
});

// ── installCa (bug classes b, c, d, e, f) ────────────────────────────────

describe("LinuxBackend.installCa", () => {
  it("debian-family: cp to /usr/local/share/ca-certificates/synapse.crt + sudo update-ca-certificates", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("debian", sudo, cp));

    // Bug class (b): right path for debian family
    expect(cp.calls).toHaveLength(1);
    expect(cp.calls[0]).toEqual(["sudo", "cp", FAKE_CA_PATH, "/usr/local/share/ca-certificates/synapse.crt"]);
    // Bug class (c): right update tool for debian family
    expect(sudo.calls).toHaveLength(1);
    expect(sudo.calls[0]).toEqual(["update-ca-certificates"]);
    expect(r.installed).toBe(true);
  });

  it("rhel-family: cp to /etc/pki/ca-trust/source/anchors/synapse.pem + sudo update-ca-trust extract", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("fedora", sudo, cp));

    expect(cp.calls).toHaveLength(1);
    expect(cp.calls[0]).toEqual(["sudo", "cp", FAKE_CA_PATH, "/etc/pki/ca-trust/source/anchors/synapse.pem"]);
    expect(sudo.calls).toHaveLength(1);
    expect(sudo.calls[0]).toEqual(["update-ca-trust", "extract"]);
    expect(r.installed).toBe(true);
  });

  it("Ubuntu via ID_LIKE=debian: routes to debian-family paths (proves inheritance reaches install)", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("ubuntu", sudo, cp));
    expect(cp.calls[0][3]).toBe("/usr/local/share/ca-certificates/synapse.crt");
    expect(sudo.calls[0]).toEqual(["update-ca-certificates"]);
    expect(r.installed).toBe(true);
  });

  it("Rocky via ID_LIKE=rhel: routes to rhel-family paths (proves inheritance reaches install)", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("rocky", sudo, cp));
    expect(cp.calls[0][3]).toBe("/etc/pki/ca-trust/source/anchors/synapse.pem");
    expect(sudo.calls[0]).toEqual(["update-ca-trust", "extract"]);
    expect(r.installed).toBe(true);
  });

  it("Arch trap-distro: NO cp or sudo calls (soft-skip) — bug class (f)", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("arch", sudo, cp));

    expect(cp.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(r.installed).toBe(false);
    expect(r.skippedReason).toBeDefined();
    expect(r.manualInstallInstructions).toContain("/etc/ca-certificates/trust-source/anchors");
    expect(r.manualInstallInstructions).toContain("trust extract-compat");
  });

  it("NixOS: NO cp or sudo calls; soft-skip with generic (non-Arch) manual instructions", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("nixos", sudo, cp));
    expect(cp.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(r.installed).toBe(false);
    expect(r.manualInstallInstructions).not.toContain("/etc/ca-certificates/trust-source");
  });

  it("missing /etc/os-release: NO cp or sudo calls; distinct skippedReason mentioning the missing file", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("missing", sudo, cp));
    expect(cp.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(r.installed).toBe(false);
    expect(r.skippedReason).toContain("/etc/os-release");
  });

  it("sudo cp failure: returns { installed:false, requiresSudo:true, manualCommand } and DOES NOT throw — bug class (d)", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([errExit]);
    let r: ReturnType<typeof LinuxBackend.installCa> | undefined;
    expect(() => {
      r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("debian", sudo, cp));
    }).not.toThrow();
    expect(r?.installed).toBe(false);
    expect(r?.requiresSudo).toBe(true);
    expect(typeof r?.manualCommand).toBe("string");
    expect(r?.manualCommand?.length).toBeGreaterThan(0);
    // sudo update-* must NOT have been attempted after cp failed
    expect(sudo.calls).toHaveLength(0);
  });

  it("sudo update-ca-* failure (cp ok but update fails): same soft-fail shape", () => {
    const sudo = makeRunner([errExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("fedora", sudo, cp));
    expect(r.installed).toBe(false);
    expect(r.requiresSudo).toBe(true);
    expect(r.manualCommand).toContain("update-ca-trust");
  });

  it("env snippet includes both env vars + configured port (drift guard)", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.installCa(FAKE_CA_PATH, backendOpts("debian", sudo, cp, 9999));
    expect(r.envSnippet).toContain(`NODE_EXTRA_CA_CERTS="${FAKE_CA_PATH}"`);
    expect(r.envSnippet).toContain('HTTPS_PROXY="http://127.0.0.1:9999"');
    expect(r.proxyPort).toBe(9999);
  });
});

// ── uninstallCa ──────────────────────────────────────────────────────────

describe("LinuxBackend.uninstallCa", () => {
  it("debian: rm -f the debian anchor + re-run update-ca-certificates", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.uninstallCa(FAKE_CA_PATH, backendOpts("debian", sudo, cp));
    expect(cp.calls).toHaveLength(1);
    expect(cp.calls[0]).toEqual(["sudo", "rm", "-f", "/usr/local/share/ca-certificates/synapse.crt"]);
    expect(sudo.calls[0]).toEqual(["update-ca-certificates"]);
    expect(r.removed).toBe(true);
  });

  it("rhel: rm -f the rhel anchor + re-run update-ca-trust extract", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.uninstallCa(FAKE_CA_PATH, backendOpts("fedora", sudo, cp));
    expect(cp.calls[0]).toEqual(["sudo", "rm", "-f", "/etc/pki/ca-trust/source/anchors/synapse.pem"]);
    expect(sudo.calls[0]).toEqual(["update-ca-trust", "extract"]);
    expect(r.removed).toBe(true);
  });

  it("unknown distro: NO sudo/cp calls; skippedReason set", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.uninstallCa(FAKE_CA_PATH, backendOpts("arch", sudo, cp));
    expect(cp.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(r.removed).toBe(false);
    expect(r.skippedReason).toBeDefined();
  });
});

// ── checkInstall ─────────────────────────────────────────────────────────

describe("LinuxBackend.checkInstall", () => {
  it("debian: tests /etc/ssl/certs/synapse.pem existence and reports inTrustStore", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.checkInstall(FAKE_CA_PATH, backendOpts("debian", sudo, cp));
    expect(cp.calls).toHaveLength(1);
    expect(cp.calls[0]).toEqual(["test", "-f", "/etc/ssl/certs/synapse.pem"]);
    expect(r.inTrustStore).toBe(true);
  });

  it("rhel: tests rhel anchor path existence", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.checkInstall(FAKE_CA_PATH, backendOpts("fedora", sudo, cp));
    expect(cp.calls[0]).toEqual(["test", "-f", "/etc/pki/ca-trust/source/anchors/synapse.pem"]);
    expect(r.inTrustStore).toBe(true);
  });

  it("file absent: inTrustStore:false", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([errExit]); // test -f exits non-zero
    const r = LinuxBackend.checkInstall(FAKE_CA_PATH, backendOpts("debian", sudo, cp));
    expect(r.inTrustStore).toBe(false);
  });

  it("unknown distro: returns inTrustStore:false without ANY cp/sudo calls", () => {
    const sudo = makeRunner([okExit]);
    const cp = makeRunner([okExit]);
    const r = LinuxBackend.checkInstall(FAKE_CA_PATH, backendOpts("arch", sudo, cp));
    expect(cp.calls).toHaveLength(0);
    expect(sudo.calls).toHaveLength(0);
    expect(r.inTrustStore).toBe(false);
  });
});
