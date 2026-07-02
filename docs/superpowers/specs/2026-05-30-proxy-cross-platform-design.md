# Cross-Platform Proxy Daemon — Design Spec

**Date:** 2026-05-30
**Status:** Draft — pending user review
**Slices:** A (Linux native) + B (Windows native)
**Predecessor:** Proxy Layers 1–9 (shipped 2026-05-30, macOS-only)

---

## 1. Goal

Make the Synapse proxy daemon (`mcp/src/capture/proxy/`) work natively on macOS, Linux, and Windows. Today the code has explicit `if (platform !== "darwin")` soft-skip branches in `onboarding.ts` and implicit POSIX-only assumptions in `tls.ts` + `capture-worker.ts` + `cli.ts`. After this work:

- A Linux user runs `synapsesync capture proxy install` and the CA lands in the system trust store via `update-ca-certificates` (Debian/Ubuntu/Alpine) or `update-ca-trust` (RHEL/Fedora/CentOS/Arch).
- A Windows user runs the same command and the CA lands in CurrentUser → Root via `certutil`.
- Three-command onboarding (`install` → paste env snippet → `enable`) works identically across all three platforms, with platform-correct env-snippet syntax.

Out of scope: native Windows GUI tool validation (Cursor.exe, ChatGPT Desktop, Claude Desktop) — punted to manual one-time validation; not blocked on automation.

## 2. Decisions log

These were resolved during brainstorming on 2026-05-30:

| # | Decision | Rationale |
|---|---|---|
| 1 | **Native Windows, not WSL2-only.** | User wants GUI AI tools (Cursor, Claude Desktop) to route through the proxy. WSL2 path doesn't cover those. |
| 2 | **node-forge across all platforms (replaces `execFileSync openssl`).** | Removes external prereq universally. Single code path. Also fixes a latent macOS class of bugs from broken Homebrew openssl installs. ~1MB pkg size cost; node-forge is mature (Auth0 uses it). |
| 3 | **Control-file polling for graceful shutdown, unified across all platforms.** | SIGTERM unavailable on Windows. Control-file (`~/.synapse/capture.shutdown`) works everywhere. SIGTERM kept as a POSIX fast-path fallback. ~1s shutdown latency is fine (user-initiated). |
| 4 | **Staircased: Slice A (Linux) ships first, Slice B (Windows) ships second.** | Linux is ~90% free (CI already runs Ubuntu). Windows is the heavy slice — staircasing isolates blast radius, enables Slice A user value immediately. |
| 5 | **Linux distro detection via `/etc/os-release`.** | Detects Debian/RHEL/etc. families and runs the right command. Cleaner UX than printing both and asking the user to pick. |
| 6 | **Control-file mechanism is uniform across platforms (not Windows-only).** | Single code path simplifies the daemon lifecycle. POSIX SIGTERM handler remains, but the same `gracefulShutdown()` function is invoked from both paths — idempotent. |
| 7 | **Windows CI runs full mcp test matrix (unit + integration), not just unit.** | Catches Windows-specific regressions in the proxy server, control-file shutdown, env-snippet rendering. Cost is ~2× minute multiplier but gated to `mcp/` changes only. |

## 3. Architecture

### 3.1 Platform backend abstraction

Today, `onboarding.ts` has four scattered `if (platform === "darwin")` branches. After this work, the platform-specific code lives in three files behind a single interface:

```
mcp/src/capture/proxy/
├── onboarding.ts            # dispatcher, public API (installCa, uninstallCa, caStatus)
├── backends/
│   ├── types.ts             # PlatformBackend interface
│   ├── mac.ts               # macOS impl: security add-trusted-cert into login keychain
│   ├── linux.ts             # Linux impl: detect distro family, update-ca-certificates / update-ca-trust
│   ├── windows.ts           # Windows impl: certutil -addstore -user Root
│   └── index.ts             # detectPlatform() → returns the right backend
└── tls.ts                   # node-forge-based, platform-agnostic
```

#### `PlatformBackend` interface (`backends/types.ts`)

```typescript
export interface PlatformBackend {
  /** Install the CA into the OS user trust store. Returns whether it landed. */
  installCa(caPath: string, opts: BackendOptions): InstallResult;

  /** Remove the CA from the OS user trust store. */
  uninstallCa(opts: BackendOptions): UninstallResult;

  /** Diagnose whether the CA is currently trusted. */
  checkInstall(caPath: string, opts: BackendOptions): InstallCheckResult;

  /** Build the shell-syntax env-snippet for this platform (bash/zsh/PowerShell/cmd). */
  buildEnvSnippet(caPath: string, proxyPort: number): string;

  /** Build the platform-specific manual install instructions block. */
  buildManualInstructions(caPath: string, proxyPort: number): string;
}
```

Each backend is independently unit-testable with injected runners (no real system trust store pollution).

### 3.2 TLS: node-forge port

`mcp/src/capture/proxy/tls.ts` currently has three `execFileSync("openssl", ...)` call sites: CA generation (`genrsa` + self-signed `req -x509`), leaf-cert minting (`genrsa` + `req` CSR + `x509 -req -CA`). All three become pure node-forge calls.

Public API (`ensureCa()`, `mintLeafCert(hostname)`) stays identical. Tests that exercise the public API stay unchanged. Internal helpers change.

A **snapshot test** added at `mcp/test/capture/proxy/tls-forge-vs-openssl.test.ts` generates a cert with both implementations and asserts equivalent fields (subject, issuer, SAN, key usage, basic constraints, expiry-relative). This catches drift early — if node-forge produces a cert the claude CLI rejects, the snapshot test will surface it before we ever ship.

### 3.3 Daemon shutdown: control-file polling

`mcp/src/capture/capture-worker.ts` adds:

```typescript
// Polls every 1000ms for the shutdown sentinel.
const shutdownFile = path.join(synapseHome(), "capture.shutdown");
const shutdownPoll = setInterval(async () => {
  if (fs.existsSync(shutdownFile)) {
    log("Shutdown file detected, shutting down gracefully");
    clearInterval(shutdownPoll);
    await gracefulShutdown();
    fs.unlinkSync(shutdownFile);  // signal completion to CLI
    process.exit(0);
  }
}, 1000);

// POSIX fast-path: same handler.
if (process.platform !== "win32") {
  process.on("SIGTERM", async () => {
    log("SIGTERM received, shutting down gracefully");
    clearInterval(shutdownPoll);
    await gracefulShutdown();
    process.exit(0);
  });
}
```

`mcp/src/capture/cli.ts` `restartDaemon()` becomes:

```typescript
if (pid) {
  if (process.platform === "win32") {
    fs.writeFileSync(shutdownFile, String(Date.now()));
    const exited = await waitForProcessExit(pid, 5000);
    if (!exited) {
      // Hard kill — Windows TerminateProcess via process.kill.
      try { process.kill(pid); } catch {}
      await waitForProcessExit(pid, 2000);
    }
  } else {
    // POSIX: SIGTERM first (faster), fallback to control file.
    try { process.kill(pid, "SIGTERM"); } catch {}
    let exited = await waitForProcessExit(pid, 3000);
    if (!exited) {
      fs.writeFileSync(shutdownFile, String(Date.now()));
      exited = await waitForProcessExit(pid, 2000);
    }
    if (!exited) {
      try { process.kill(pid, "SIGKILL"); } catch {}
      await waitForProcessExit(pid, 2000);
    }
  }
  stoppedPid = pid;
}
```

Idempotency invariant: `gracefulShutdown()` checks an internal `shuttingDown` flag and no-ops on re-entry. Both SIGTERM and control-file paths share the same function.

## 4. Slice A — Linux native

**Scope:** ~1 day; ~150 LOC + tests; no user-visible or internal behavior change for macOS (Slice A only refactors the `onboarding.ts` dispatcher; TLS / daemon-lifecycle stay untouched).

### 4.1 Files changed

| File | Change |
|---|---|
| `mcp/src/capture/proxy/onboarding.ts` | Extract `PlatformBackend` dispatcher. Move existing macOS logic into `backends/mac.ts`. Wire up `backends/linux.ts`. |
| `mcp/src/capture/proxy/backends/types.ts` | NEW — `PlatformBackend` interface + result types. |
| `mcp/src/capture/proxy/backends/mac.ts` | NEW — extracted from current `onboarding.ts`. Same behavior. |
| `mcp/src/capture/proxy/backends/linux.ts` | NEW — distro detection + sudo update-ca-certificates / update-ca-trust. |
| `mcp/src/capture/proxy/backends/index.ts` | NEW — `detectBackend()` returns the right impl by `process.platform` + `/etc/os-release`. |
| `mcp/test/capture/proxy/backends/linux.test.ts` | NEW — distro detection + install/uninstall/check across both families. |
| `mcp/test/capture/proxy/backends/mac.test.ts` | NEW — moved from existing onboarding tests. |
| `mcp/test/capture/proxy/onboarding.test.ts` | Updated — tests the dispatcher logic with injected fake backend. |

### 4.2 Linux distro detection

`/etc/os-release` has `ID=` and `ID_LIKE=` fields. We map:

- `debian | ubuntu | linuxmint | pop | elementary | kali | parrot | raspbian | alpine` → **Debian family** → `/usr/local/share/ca-certificates/synapse.crt` + `sudo update-ca-certificates`
- `fedora | rhel | centos | rocky | almalinux | amzn | ol` → **RHEL family** → `/etc/pki/ca-trust/source/anchors/synapse.pem` + `sudo update-ca-trust extract`
- `arch | manjaro | endeavouros | nixos | gentoo | void | <anything else>` → **Unknown** → soft-skip with manual instructions tagged "unsupported distro — see manual install for your trust store". Per-distro instructions printed for Arch (`/etc/ca-certificates/trust-source/anchors/` + `sudo trust extract-compat`) and a generic block for others.

Alpine technically uses `/usr/local/share/ca-certificates/` like Debian but with a different `update-ca-certificates` flag; same family for our purposes works.

**Why Arch isn't auto-supported:** Arch uses `/etc/ca-certificates/trust-source/anchors/` (distinct from RHEL's `/etc/pki/ca-trust/source/anchors/`) plus `trust extract-compat` (distinct from `update-ca-trust extract`). Treating it as RHEL would put the cert in a path Arch's update-tool ignores. Better to soft-skip with correct manual instructions than to "support" it badly. If a user asks, promoting Arch to a first-class family is ~20 LOC follow-up.

### 4.3 sudo handling

`update-ca-certificates` and `update-ca-trust` both require root. We invoke `sudo` explicitly via:

```typescript
spawnSync("sudo", ["update-ca-certificates"], { stdio: "inherit" });
```

`stdio: "inherit"` lets the sudo password prompt reach the user's TTY. If sudo fails (CI / non-interactive shell), `installCa()` returns:

```typescript
{ installed: false, requiresSudo: true, manualCommand: "sudo update-ca-certificates" }
```

The caller decides whether to retry or surface the manual fallback. This is the same pattern as `mkcert`.

### 4.4 Tests (Slice A)

- `backends/linux.test.ts`:
  - Distro detection: 5 fixtures (Debian, Ubuntu, Fedora, RHEL, Arch) + 2 unknown (NixOS, Gentoo) + 1 missing `/etc/os-release`.
  - Install Debian family: verifies cp to `/usr/local/share/ca-certificates/` + sudo invocation.
  - Install RHEL family: verifies cp to `/etc/pki/ca-trust/source/anchors/` + sudo invocation.
  - Uninstall: removes from the right path + re-runs `update-ca-*`.
  - CheckInstall: greps the right system trust file.
  - sudo failure: returns `requiresSudo: true` cleanly without throwing.
- `onboarding.test.ts`: updated to assert dispatcher picks `mac` on darwin, `linux` on linux, `windows` on win32; throws on unknown platform.

### 4.5 Slice A success criteria

- Existing macOS tests pass unchanged.
- New Linux tests cover both distro families.
- Documented one-line install command in `docs/E2E-PROTOCOL.md` for Linux dogfood validation.
- CI's Ubuntu job passes the new `linux.test.ts`.
- `synapsesync capture proxy install` on a real Ubuntu box installs the CA into system trust + the env snippet is bash/zsh syntax + Node.js, curl, and claude CLI all trust the CA.

## 5. Slice B — Windows native

**Scope:** ~3–5 days; ~500 LOC + tests + CI job. macOS and Linux users see **no user-visible behavior change** — the public API of `TlsManager` (`ensureCa()`, `mintLeafCert(hostname)`) is unchanged. Internally, the `execFileSync("openssl", ...)` call sites are replaced with `node-forge` calls on all platforms (this is the dependency change that makes Windows possible without an openssl prereq).

### 5.1 Files changed

| File | Change |
|---|---|
| `mcp/src/capture/proxy/tls.ts` | Replace `execFileSync("openssl", ...)` with node-forge across all platforms. |
| `mcp/src/capture/proxy/backends/windows.ts` | NEW — `certutil -addstore -user Root` install / `-delstore` uninstall / `-store` status. |
| `mcp/src/capture/capture-worker.ts` | Add `shutdownFile` polling. POSIX SIGTERM remains as fast-path. |
| `mcp/src/capture/cli.ts` | `restartDaemon()` branches Windows → control file; POSIX → SIGTERM then control file fallback. Env snippet routing per platform. |
| `mcp/src/capture/proxy/backends/index.ts` | Wire windows backend. |
| `mcp/package.json` | Add `node-forge` + `@types/node-forge` deps. Remove openssl-bundled-instructions from any prereq docs. |
| `mcp/test/capture/proxy/tls-forge-vs-openssl.test.ts` | NEW — snapshot test: node-forge cert equivalent to openssl cert for field invariants. |
| `mcp/test/capture/proxy/backends/windows.test.ts` | NEW — certutil install/uninstall/status with injected runner. |
| `mcp/test/capture/capture-worker.test.ts` | Updated — control-file shutdown path on both platforms + idempotency. |
| `mcp/test/capture/cli.test.ts` | Updated — restartDaemon Windows branch + POSIX fallback to control file when SIGTERM hangs. |
| `.github/workflows/ci.yml` | Add `windows-latest` to mcp matrix. Gate via `paths: mcp/**` to avoid Windows-job cost on non-mcp PRs. |
| `docs/E2E-PROTOCOL.md` | Add Windows manual validation checklist. Note that GH-runner Windows job does NOT include real-CLI E2E (no AI tools on the runner). |

### 5.2 Windows CA install via certutil

```typescript
// Install
spawnSync("certutil", ["-addstore", "-user", "-f", "Root", caPath], { stdio: "pipe" });
// -user    : CurrentUser store, no admin prompt
// -f       : force, overwrite existing entry
// Root     : "Trusted Root Certification Authorities"

// Uninstall — certutil uses SHA1 fingerprint or subject CN.
spawnSync("certutil", ["-delstore", "-user", "Root", "Synapse Proxy CA"], { stdio: "pipe" });

// Status
const r = spawnSync("certutil", ["-store", "-user", "Root", "Synapse Proxy CA"], { stdio: "pipe" });
const inStore = r.status === 0;
```

`certutil` is built into Windows since Vista. It's present in PATH on every Windows install. Works in cmd, PowerShell, and Git Bash uniformly. Exit code 0 = found/installed; non-zero = absent.

CurrentUser store is intentional: no admin prompt, no GPO complications for the install path. Browsers (Edge, Chrome) and Node read CurrentUser by default. Same philosophy as macOS login keychain.

### 5.3 Env snippets per platform

`backends/mac.ts` and `backends/linux.ts` → bash/zsh:
```
export NODE_EXTRA_CA_CERTS="<caPath>"
export HTTPS_PROXY="http://127.0.0.1:7727"
```

`backends/windows.ts` → both PowerShell and cmd (we don't know which shell the user is in):
```
# PowerShell — paste into $PROFILE
$env:NODE_EXTRA_CA_CERTS = "<caPath>"
$env:HTTPS_PROXY = "http://127.0.0.1:7727"

# Or for persistence, run once:
[Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", "<caPath>", "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://127.0.0.1:7727", "User")

# cmd — for non-PowerShell users:
setx NODE_EXTRA_CA_CERTS "<caPath>"
setx HTTPS_PROXY "http://127.0.0.1:7727"
```

### 5.4 node-forge porting plan

`tls.ts:108-130` (CA generation):
```typescript
// BEFORE
execFileSync("openssl", ["genrsa", "-out", keyPath, "4096"], ...);
execFileSync("openssl", ["req", "-x509", "-new", "-key", keyPath, "-out", certPath, ...], ...);

// AFTER
const keys = forge.pki.rsa.generateKeyPair({ bits: 4096 });
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = randomHex(20);
cert.validity.notBefore = new Date();
cert.validity.notAfter = addYears(new Date(), 10);
cert.setSubject([{ name: "commonName", value: "Synapse Proxy CA" }]);
cert.setIssuer(cert.subject.attributes);  // self-signed
cert.setExtensions([
  { name: "basicConstraints", cA: true, critical: true },
  { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
  { name: "subjectKeyIdentifier" },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());
fs.writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
```

`tls.ts:180-220` (leaf cert minting per hostname) follows the same pattern with `cert.setIssuer(caCert.subject.attributes) + cert.sign(caPrivateKey, ...)`. SAN extension is added via `{ name: "subjectAltName", altNames: [{ type: 2, value: hostname }] }` (type 2 = DNS).

Performance characteristic to verify in the snapshot test: leaf-cert mint should complete in < 200ms per host (today's openssl-spawn-based path is ~100ms; node-forge with 2048-bit RSA leaves should be similar; if it's 5× slower we should cache more aggressively).

### 5.5 Windows CI

```yaml
# .github/workflows/ci.yml — additions
jobs:
  test-mcp-windows:
    runs-on: windows-latest
    if: ${{ contains(github.event.head_commit.modified, 'mcp/') || github.event_name == 'workflow_dispatch' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: cd mcp && npm install
      - run: cd mcp && npm run lint
      - run: cd mcp && npm run typecheck
      - run: cd mcp && npm test
```

E2E (`npm run test:e2e`) is intentionally excluded — it requires the real `claude` CLI which isn't installed on GH Windows runners.

### 5.6 Tests (Slice B)

- `tls-forge-vs-openssl.test.ts`: equivalent-field snapshot on macOS (CI gates this on macOS-only since openssl is the reference).
- `backends/windows.test.ts`: certutil install (verifies arg order + flags), uninstall, status, env-snippet output (asserts contains both PowerShell and cmd blocks).
- `capture-worker.test.ts` updates: shutdown-file detection within 1.2s, graceful flush completes, file is deleted, exit code 0; idempotent re-entry.
- `cli.test.ts` updates: Windows branch writes shutdown file + escalates to hard kill on timeout; POSIX branch falls back to shutdown file when SIGTERM doesn't reach exit within 3s.

### 5.7 Slice B success criteria

- All existing platforms (mac, linux) pass unchanged.
- node-forge port produces certs claude CLI accepts on macOS E2E.
- Windows CI job passes for mcp unit + integration tests.
- Manual one-time validation: real Windows box runs `proxy install` → CA in CurrentUser Root → claude CLI in WSL2 still works → Windows PowerShell session with env vars set + claude CLI installed via npm → handshake succeeds via the proxy → daemon `enable` / `disable` cycle works without data loss.

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| node-forge produces certs with subtly different fields than openssl → claude CLI / Cursor rejects them | Medium | Snapshot test in Slice B Day 1. Run macOS real-claude E2E with node-forge cert before merging Slice B. |
| `update-ca-certificates` sudo prompt fails in non-interactive contexts | Low | `installCa()` returns `{ installed: false, requiresSudo: true, manualCommand: "..." }`; caller decides interactive retry or surface fallback. |
| Windows `certutil -addstore -user Root` may still prompt confirmation on Group-Policy-managed corporate Windows | Medium | Use `-f` flag to force. Document GPO override in manual instructions. Add fallback "manual install via certmgr.msc" instructions. |
| Control-file polling on POSIX + SIGTERM both active = double-shutdown race | Low | `gracefulShutdown()` guards on internal `shuttingDown` flag, second invocation no-ops. Snapshot tested. |
| Windows CI Actions minutes 2× cost over Linux | Low | Gate via `paths: mcp/**` filter. Skip when no mcp changes. |
| node-forge package size (~1MB) bloats `npx synapsesync` install time | Low | Existing daemon deps already ~10MB. Marginal. node-forge tree-shakes well. |
| Cross-platform path separator bugs in tests (`/` vs `\\`) | High | Use `path.join()` everywhere; lint rule against string-concatenated paths; ensure Windows CI runs all tests once before merge. |

## 7. Out of scope (explicit non-goals)

- Native Windows real-CLI E2E in CI — no AI tools on GH runners. Manual validation only.
- Linux distros outside the Debian/RHEL/Arch families (NixOS, Gentoo, etc.) — soft-skip with manual instructions.
- Windows LocalMachine cert store (admin-required) — CurrentUser is enough.
- Daemon installation as a Windows Service / launchd / systemd unit — out of scope for this work; daemon stays user-spawned via `synapsesync capture start`.
- Linux desktop GUI AI tool validation (Cursor for Linux, etc.) — not blocking; same code path applies.
- WSL2-specific tooling on Windows — works automatically via the Linux path, no extra work needed.
- Cert rotation logic (CA expires after 10 years) — out of scope; existing rotation backlog item still applies.

## 8. Implementation sequencing

Slice A (Linux native):
1. Create `backends/types.ts` interface.
2. Extract `backends/mac.ts` from current `onboarding.ts`. Tests pass unchanged.
3. Add `backends/index.ts` dispatcher.
4. Implement `backends/linux.ts` with distro detection + sudo invocations.
5. Add `backends/linux.test.ts` covering both families + sudo-failure path.
6. Update `onboarding.ts` to delegate to backend; thin dispatcher only.
7. Validate on Ubuntu via CI's existing ubuntu-latest job.
8. Commit + push + tag complete.

Slice B (Windows native):
1. Replace openssl with node-forge in `tls.ts`. Add `tls-forge-vs-openssl.test.ts` snapshot. Verify macOS real-claude E2E still passes.
2. Implement `backends/windows.ts` with `certutil` runners.
3. Add `backends/windows.test.ts` with injected runner.
4. Add control-file shutdown polling in `capture-worker.ts`. POSIX SIGTERM remains.
5. Update `cli.ts` `restartDaemon()` for Windows branch + POSIX fallback.
6. Add Windows env-snippet block in `backends/windows.ts` (PowerShell + cmd).
7. Add `.github/workflows/ci.yml` Windows job.
8. Manual validation on real Windows machine (when available).
9. Commit + push + tag complete.

## 9. Open questions for user review

The following are decisions I made on the user's behalf during brainstorming ("your call"). Flagging here for explicit confirmation in spec review:

1. **Linux distro detection** — via `/etc/os-release` (decided ✓). Alternative was print-both-commands-no-detection.
2. **Control-file mechanism** — uniform across platforms (decided ✓). Alternative was Windows-only gating.
3. **Windows CI scope** — full mcp test matrix unit + integration (decided ✓). Alternative was unit-only (cheaper, lower confidence).

If any of these need a different call, flag during spec review and I'll revise before planning.

## 10. Transition

After this spec is approved, the next step per project policy is `/gsd-plan-phase` to create a phase plan in `.planning/phases/`. This spec becomes the upstream context document for the phase plan.

Slice A and Slice B should likely be **two separate phases** (or one phase with two distinct slice directories) so they can ship independently. The phase planner decides the precise structure.
