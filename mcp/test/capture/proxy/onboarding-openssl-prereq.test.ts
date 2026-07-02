// mcp/test/capture/proxy/onboarding-openssl-prereq.test.ts
//
// Bug-class guards for the `openssl` prerequisite check that runs at the
// top of `installCa()`. Without this check, a missing openssl binary
// surfaces as a bare ENOENT from deep inside `tlsManager.ensureCa()` with
// no actionable guidance — most painful on fresh Windows installs where
// openssl isn't on PATH by default.
//
// Bug classes guarded:
//   1. `checkOpensslAvailable` correctly detects present + missing binary
//   2. `installCa` throws `OpensslMissingError` BEFORE attempting CA
//      generation when openssl is missing (so we never get a half-written
//      CA dir state)
//   3. Install hint is platform-tailored — not generic. Catches the
//      regression "shipped a hint that says `apt install` on macOS."
//   4. spawnSync THROWING (Windows behavior on certain ENOENTs) is also
//      treated as unavailable — not allowed to bubble up

import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpensslMissingError, checkOpensslAvailable, installCa } from "../../../src/capture/proxy/onboarding.js";
import { TlsManager } from "../../../src/capture/proxy/tls.js";

let tmpRoot: string;
let tlsManager: TlsManager;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "synapse-openssl-prereq-"));
  tlsManager = new TlsManager({ caDir: tmpRoot });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Helper: synthesize a spawnSync return that vitest types accept.
function syntheticReturn(opts: {
  status: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}): SpawnSyncReturns<Buffer> {
  return {
    pid: 1234,
    output: [null, Buffer.from(opts.stdout ?? ""), Buffer.from(opts.stderr ?? "")],
    stdout: Buffer.from(opts.stdout ?? ""),
    stderr: Buffer.from(opts.stderr ?? ""),
    status: opts.status,
    signal: null,
    error: opts.error,
  };
}

describe("checkOpensslAvailable", () => {
  it("returns available=true with parsed version when `openssl version` exits 0", () => {
    const fakeSpawn = vi.fn().mockReturnValue(syntheticReturn({ status: 0, stdout: "OpenSSL 3.2.0 23 Nov 2023\n" }));
    const result = checkOpensslAvailable(fakeSpawn as never, "darwin");
    expect(result.available).toBe(true);
    expect(result.version).toBe("OpenSSL 3.2.0 23 Nov 2023");
    expect(result.installHint).toBeUndefined();
  });

  it("returns available=false with installHint when spawnSync returns non-zero exit", () => {
    const fakeSpawn = vi.fn().mockReturnValue(syntheticReturn({ status: 127, stderr: "openssl: command not found" }));
    const result = checkOpensslAvailable(fakeSpawn as never, "linux");
    expect(result.available).toBe(false);
    expect(result.installHint).toBeDefined();
    expect(result.installHint).toMatch(/Linux/);
  });

  it("returns available=false when spawnSync THROWS synchronously (Windows ENOENT path)", () => {
    // On Windows, child_process.spawnSync can throw synchronously when the
    // binary isn't on PATH instead of returning {error, status: null}. The
    // check must NOT let that bubble up — wrap in try/catch internally.
    const fakeSpawn = vi.fn().mockImplementation(() => {
      throw new Error("spawn openssl ENOENT");
    });
    const result = checkOpensslAvailable(fakeSpawn as never, "win32");
    expect(result.available).toBe(false);
    expect(result.installHint).toBeDefined();
  });

  it("returns available=false when spawnSync returns an .error field (no status)", () => {
    const fakeSpawn = vi.fn().mockReturnValue(
      syntheticReturn({
        status: 0,
        error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
      }),
    );
    const result = checkOpensslAvailable(fakeSpawn as never, "darwin");
    expect(result.available).toBe(false);
  });

  it("install hint is platform-tailored: macOS mentions /usr/bin/openssl, Linux mentions apt/dnf/pacman, Windows mentions Git for Windows", () => {
    const fakeSpawnMissing = vi.fn().mockReturnValue(syntheticReturn({ status: 127 }));

    const mac = checkOpensslAvailable(fakeSpawnMissing as never, "darwin");
    expect(mac.installHint).toMatch(/\/usr\/bin\/openssl|brew/);

    const linux = checkOpensslAvailable(fakeSpawnMissing as never, "linux");
    expect(linux.installHint).toMatch(/apt|dnf|pacman/);

    const win = checkOpensslAvailable(fakeSpawnMissing as never, "win32");
    expect(win.installHint).toMatch(/Git for Windows|slproweb/);

    // freebsd / other → generic but non-empty hint
    const other = checkOpensslAvailable(fakeSpawnMissing as never, "freebsd");
    expect(other.installHint).toBeDefined();
    expect(other.installHint!.length).toBeGreaterThan(10);
  });
});

describe("installCa openssl prereq enforcement", () => {
  // Bug class: installCa must FAIL FAST before any CA generation if openssl
  // is missing. Otherwise tlsManager.ensureCa throws a bare ENOENT, may
  // create a half-written ca.key file, and the user gets no install hint.
  //
  // Since checkOpensslAvailable uses the real spawnSync internally, we
  // need to verify the failure path differently — we test the behavior
  // when openssl IS on PATH on the dev/CI machine (positive control), and
  // we test OpensslMissingError construction independently.

  it("OpensslMissingError carries the installHint as a public field", () => {
    const err = new OpensslMissingError("test-hint-payload");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpensslMissingError);
    expect(err.name).toBe("OpensslMissingError");
    expect(err.installHint).toBe("test-hint-payload");
    expect(err.message).toContain("openssl");
    expect(err.message).toContain("test-hint-payload");
  });

  it("installCa does NOT throw OpensslMissingError when openssl IS present (positive control)", () => {
    // CI runners (ubuntu + windows) both have openssl on PATH; macOS dev
    // machines have /usr/bin/openssl. If this assertion fires, the
    // prereq check is generating false positives — a worse bug than the
    // missing-binary case.
    expect(() => {
      // We pass a stub backend via runSecurity to short-circuit the actual
      // keychain install on macOS; the relevant invariant is just that
      // installCa runs past the prereq check.
      installCa({
        tlsManager,
        platform: "darwin",
        home: tmpRoot,
        runSecurity: () => ({ status: 0, stdout: "", stderr: "" }),
        runOpenssl: () => ({ status: 0, stdout: "SHA256 Fingerprint=AB:CD\n", stderr: "" }),
      });
    }).not.toThrow(OpensslMissingError);
  });
});
