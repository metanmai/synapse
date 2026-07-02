// mcp/test/capture/proxy/backends/windows.test.ts
//
// Bug class: "the windows backend (a) invokes the wrong cert-store API
// (e.g. hits the certutil -addstore codepath that triggers the Windows
// GUI confirmation dialog and hangs on CI), (b) silently reports success
// when post-install verify fails, (c) leaves stale trust settings after
// uninstall, (d) ships an env snippet that only covers PowerShell OR
// only covers cmd (must cover both per spec §5.3), OR (e) omits the
// certmgr.msc fallback for GPO-blocked systems."
//
// Empirically validated 2026-05-30: `certutil -addstore -user -f Root
// <ca.pem>` hangs exactly 30 s on GHA windows-latest (UI confirmation
// dialog waiting on a desktop that doesn't exist). Switched to
// PowerShell Import-Certificate which uses the .NET X509Store API
// path — no dialog. Status queries (certutil -store) are non-destructive
// and remain certutil since they're fast (~60 ms) and never prompt.
//
// Every PowerShell + certutil invocation is injected. Tests never touch
// the real CurrentUser Root store on any machine they're run from.

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

function backendOpts(
  runPowerShell: (args: string[]) => CommandResult,
  runCertutil: (args: string[]) => CommandResult,
  proxyPort = 7727,
): BackendOptions {
  return { runPowerShell, runCertutil, proxyPort };
}

// ── installCa (bug classes a, b) ─────────────────────────────────────────

describe("WindowsBackend.installCa", () => {
  it("install script: suppresses Root trust dialog (HKCU flag) + inline PEM decode + X509Store.Add + certutil verify — bug class (a)", () => {
    const ps = makeRunner([okExit]); // X509Store.Add
    const cu = makeRunner([okExit]); // certutil -store verify
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));

    // PowerShell-side: ONE call. Script must, in order:
    //   1. Set HKCU registry flag so Windows skips the "Do you want to
    //      install this CA?" GUI dialog (the bug that hung CI in commit
    //      9c92433 — `X509Store.Add` was hitting the SAME prompt as
    //      `certutil -addstore`, because both call CertAddCertificate-
    //      ContextToStore under the hood). HKCU = no admin needed.
    //   2. Read the PEM file (LiteralPath, single-quoted for backslashes).
    //   3. Strip BEGIN/END armor + whitespace.
    //   4. Base64-decode to DER bytes.
    //   5. Construct X509Certificate2 from byte[] (.NET-Framework-portable
    //      — Import-Certificate-via-PEM is PowerShell-7+ only).
    //   6. Open Root/CurrentUser store ReadWrite and Add the cert.
    expect(ps.calls).toHaveLength(1);
    const installScript = ps.calls[0][0];
    // Registry suppression — without HKLM\...\Flags = 0x20
    // (CERT_PROT_ROOT_DISABLE_USER_UI_FLAG) the Add() call hangs on CI.
    // Wrapped in try/catch so non-admin user installs gracefully skip
    // (and just see the trust dialog, which is the intended UX there).
    expect(installScript).toContain("[Microsoft.Win32.Registry]::LocalMachine.CreateSubKey");
    expect(installScript).toContain("SOFTWARE\\Microsoft\\SystemCertificates\\Root\\ProtectedRoots");
    expect(installScript).toMatch(/SetValue\('Flags', 0x20, 'DWord'\)/);
    expect(installScript).toContain("try {"); // soft-fail on non-admin
    // PEM decode pipeline.
    expect(installScript).toContain(`Get-Content -LiteralPath '${FAKE_CA_PATH}'`);
    expect(installScript).toContain("-----[^-]+-----"); // armor-strip regex
    expect(installScript).toContain("[Convert]::FromBase64String");
    expect(installScript).toContain("X509Certificate2(,$der)");
    expect(installScript).toContain("X509Store('Root','CurrentUser')");
    expect(installScript).toContain("$store.Open('ReadWrite')");
    expect(installScript).toContain("$store.Add($cert)");

    // certutil-side: ONE call to -store for post-verify.
    // Query operations don't trigger the UI dialog and stay on certutil.
    expect(cu.calls).toHaveLength(1);
    expect(cu.calls[0]).toEqual(["-store", "-user", "Root", "Synapse Proxy CA"]);

    expect(r.installed).toBe(true);
    expect(r.proxyPort).toBe(7727);
  });

  it("install script: registry suppression flag set BEFORE X509Store.Add (ordering matters — Add() prompts if flag not yet set)", () => {
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    const s = ps.calls[0][0];
    const flagSetIdx = s.indexOf("SetValue('Flags'");
    const addIdx = s.indexOf("$store.Add");
    expect(flagSetIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(-1);
    // Regression guard: flag must come first, else the prompt fires and the
    // process hangs on CI.
    expect(flagSetIdx).toBeLessThan(addIdx);
  });

  it("does NOT use Import-Certificate cmdlet — fails on Windows PowerShell 5.1 (DER-only) for PEM input", () => {
    // Regression guard: a future contributor "simplifying" back to
    // Import-Certificate would re-break GHA Windows runs (where Node
    // spawns powershell.exe = PS 5.1, not pwsh.exe = PS 7).
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    expect(ps.calls[0][0]).not.toContain("Import-Certificate");
  });

  it("does NOT invoke `certutil -addstore` — the operation that hangs on CI runners (bug class a)", () => {
    // Regression guard: if anyone re-introduces certutil -addstore here,
    // CI will hang for 30 s before the spawnSync timeout fires.
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    for (const call of cu.calls) {
      expect(call).not.toContain("-addstore");
    }
    for (const call of ps.calls) {
      expect(call[0]).not.toContain("certutil");
    }
  });

  it("installed=false when post-install verify (-store) fails — bug class (b)", () => {
    // PowerShell Import-Certificate can succeed-but-not-store under GPO
    // restrictions (silent failure). certutil -store is the source of truth.
    const ps = makeRunner([okExit]);
    const cu = makeRunner([errExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    expect(r.installed).toBe(false);
  });

  it("escapes single quotes in caPath for PowerShell embedding (path-injection guard)", () => {
    const tricky = "C:\\Users\\O'Brien\\.synapse\\proxy\\ca.pem";
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    WindowsBackend.installCa(tricky, backendOpts(ps.runner, cu.runner));
    // Single-quote escape rule in PowerShell: ' → ''
    expect(ps.calls[0][0]).toContain("'C:\\Users\\O''Brien\\.synapse\\proxy\\ca.pem'");
  });

  it("env snippet shape — bug class (d): contains BOTH PowerShell + cmd syntaxes (spec §5.3)", () => {
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner, 9999));
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
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    expect(r.manualInstallInstructions).toContain("certmgr.msc");
    expect(r.manualInstallInstructions).toContain("Trusted Root Certification Authorities");
    expect(r.manualInstallInstructions).toContain(FAKE_CA_PATH);
  });

  it("custom proxy port flows through to envSnippet (drift guard)", () => {
    const ps = makeRunner([okExit]);
    const cu = makeRunner([okExit]);
    const r = WindowsBackend.installCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner, 9999));
    expect(r.envSnippet).toContain("9999");
    expect(r.envSnippet).not.toContain("7727");
    expect(r.proxyPort).toBe(9999);
  });
});

// ── uninstallCa (bug class c) ────────────────────────────────────────────

describe("WindowsBackend.uninstallCa", () => {
  it("uses PowerShell X509Store('Root','CurrentUser').Remove() — avoids UI prompt (bug class c)", () => {
    const ps = makeRunner([okExit]);
    const cu = makeRunner([]);
    const r = WindowsBackend.uninstallCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));

    expect(ps.calls).toHaveLength(1);
    const removeScript = ps.calls[0][0];
    // X509Store on Root scope at CurrentUser (no UAC).
    expect(removeScript).toContain("X509Store('Root','CurrentUser')");
    expect(removeScript).toContain("$store.Remove($found)");
    // Filter by the CA's Common Name.
    expect(removeScript).toContain("Synapse Proxy CA");
    // certutil is NOT invoked for uninstall (delstore also touches Root → potential UI prompt).
    expect(cu.calls).toHaveLength(0);

    expect(r.removed).toBe(true);
  });

  it("removed=false when PowerShell exits non-zero (cert not in store; script `exit 1` branch)", () => {
    // Script's `if ($found) { ... exit 0 } else { ... exit 1 }` is the
    // signal — non-zero status → cert wasn't there, idempotent uninstall.
    const ps = makeRunner([{ status: 1, stdout: "", stderr: "" }]);
    const cu = makeRunner([]);
    const r = WindowsBackend.uninstallCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    expect(r.removed).toBe(false);
  });

  it("does NOT invoke `certutil -delstore` — same UI-dialog risk as -addstore", () => {
    const ps = makeRunner([okExit]);
    const cu = makeRunner([]);
    WindowsBackend.uninstallCa(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    for (const call of cu.calls) {
      expect(call).not.toContain("-delstore");
    }
  });
});

// ── checkInstall ─────────────────────────────────────────────────────────

describe("WindowsBackend.checkInstall", () => {
  it('invokes `certutil -store -user Root "Synapse Proxy CA"` and reports inTrustStore on exit 0', () => {
    const ps = makeRunner([]);
    const cu = makeRunner([okExit]);
    const r = WindowsBackend.checkInstall(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    expect(cu.calls).toHaveLength(1);
    expect(cu.calls[0]).toEqual(["-store", "-user", "Root", "Synapse Proxy CA"]);
    // Store query is read-only — no PowerShell needed.
    expect(ps.calls).toHaveLength(0);
    expect(r.inTrustStore).toBe(true);
  });

  it("returns inTrustStore:false on certutil error (cert absent from store)", () => {
    const ps = makeRunner([]);
    const cu = makeRunner([errExit]);
    const r = WindowsBackend.checkInstall(FAKE_CA_PATH, backendOpts(ps.runner, cu.runner));
    expect(r.inTrustStore).toBe(false);
  });
});

// ── Backend identity ─────────────────────────────────────────────────────

describe("WindowsBackend identity", () => {
  it('declares name="windows" (dispatcher relies on this for routing tests)', () => {
    expect(WindowsBackend.name).toBe("windows");
  });
});
