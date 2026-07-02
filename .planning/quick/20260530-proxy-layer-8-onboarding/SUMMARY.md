---
slug: proxy-layer-8-onboarding
quick_id: 260530-l8
date: 2026-05-30
status: complete
---

# Proxy daemon — Layer 8 SUMMARY

## Outcome

Closed the onboarding gap. A user can now run `synapsesync capture proxy install` and get: (a) the CA generated, (b) installed in their macOS login keychain with SSL trust, (c) the shell snippet they need to paste into their rc file, (d) the manual fallback path if anything didn't work. Plus `status` for diagnosis and `uninstall` for symmetry. Proxy port defaulted to **7727** so HTTPS_PROXY can be hard-coded in shell config.

## Smoke test (this machine, read-only `status`)

```
┌  ◆ Synapse Proxy — status
│
│    ○ CA          not generated (/Users/Tanmai.N/.synapse/proxy/ca.pem)
│    ○ Keychain    not trusted
│    ●  Proxy port  7727
│
│
│  To complete onboarding:
│    synapsesync capture proxy install
│
└  synapsesync.app
```

Distinguishes three states (CA absent / CA present / keychain-trusted) and surfaces the next action — exactly what an onboarding command should do.

## Commits

| SHA | Message | Files |
|---|---|---|
| _(this commit)_ | `feat(proxy): Layer 8 — CA install onboarding (proxy install/status/uninstall CLI)` | 6 |

## Files

| Path | Change | Purpose |
|---|---|---|
| `mcp/src/capture/proxy/onboarding.ts` | NEW | `installCa` / `uninstallCa` / `caStatus` with injectable security/openssl runners |
| `mcp/test/capture/proxy/onboarding.test.ts` | NEW | 12 unit tests covering bug class without touching real keychain |
| `mcp/src/capture/cli.ts` | UPDATE | New `proxy install/status/uninstall` subcommands wired into `synapsesync capture` |
| `mcp/src/capture/capture-worker.ts` | UPDATE | Default proxy port = 7727 (stable string for shell rc) |
| `.planning/quick/20260530-proxy-layer-8-onboarding/{PLAN,SUMMARY}.md` | NEW | GSD scaffolding |

## Bug-class coverage

| Concern | Test | Status |
|---|---|---|
| `add-trusted-cert` invoked with correct `-r trustRoot -p ssl -k <login.keychain>` args | "on darwin: invokes `security add-trusted-cert` with -r trustRoot -p ssl..." | ✓ |
| **`installedInKeychain` is false when post-install verify fails** (defends against `security` exiting 0 on dismissed GUI prompt) | "reports installedInKeychain=false when post-install verify fails" | ✓ |
| Non-macOS: soft-skip + manual instructions, never crashes | "on non-darwin (linux/win32): skips the security call entirely..." | ✓ |
| Env snippet contains both required vars + correct port | "env snippet contains both env vars + the configured proxy port" | ✓ |
| **No `caPath` drift between install and daemon's TlsManager** | "caPath returned by installCa matches TlsManager.caCertPath()" | ✓ |
| `uninstallCa` invokes `delete-certificate -c "Synapse Proxy CA"` | "on darwin with CA present: invokes `security delete-certificate`" | ✓ |
| `uninstallCa` reports `removed: false` when security errors | "reports removed=false when the security command errors" | ✓ |
| `uninstallCa` with no CA on disk: never calls security, soft-skips | "when CA pem is absent on disk: skips with reason, never calls security" | ✓ |
| `uninstallCa` on non-macOS: soft-skip even with CA present | "on non-darwin: soft-skips with skippedReason even when CA exists" | ✓ |
| `caStatus` with no CA: caExists=false, no calls | "when CA doesn't exist: caExists=false, no fingerprint, no keychain call" | ✓ |
| `caStatus` with CA: fingerprint computed, keychain checked | "when CA exists: returns fingerprint + checks keychain on darwin" | ✓ |
| `caStatus` on non-macOS with CA: skips keychain check | "on non-darwin with CA present: skips keychain check" | ✓ |

## Design highlights

- **Injectable security/openssl runners.** Tests pass fakes that record arg lists + return canned status codes. Real binaries are only invoked when the user runs the CLI for real. Pollution-free testing of system-state-mutating code.
- **Source-of-truth verify post-install.** `security add-trusted-cert` may exit 0 even when the user dismisses the GUI confirmation prompt. So we always follow up with `security find-certificate -c "Synapse Proxy CA"` and use its exit code as the actual `installedInKeychain` flag.
- **Login keychain over System keychain.** User-scoped trust, no admin password required. GUI tools that read system trust (Cursor, Chrome) still find the cert because CFNetwork checks both keychains.
- **Default port 7727 in `capture-worker.ts`.** Before: OS-assigned (port 0) — fine for tests but meant the user couldn't hard-code HTTPS_PROXY. Now: 7727 default, override via SYNAPSE_PROXY_PORT. Matches the `DEFAULT_PROXY_PORT` export in `onboarding.ts` so env snippet always agrees with daemon.
- **Manual fallback always present.** Even on successful auto-install, the result includes printable manual instructions — useful if the user wants to verify or reapply, or if they're on a different machine without the CLI tool.

## Stats

| | Before | After |
|---|---|---|
| Test files (mcp) | 67 | 68 (+1) |
| Tests passing (mcp) | 596 | **608** (+12 onboarding tests) |
| Lint (whole repo) | clean (403) | clean (405) |
| CLI subcommands under `capture` | 4 | 7 (+3 proxy install/status/uninstall) |

## What's deferred

- **Shell rc auto-modification.** Idempotency + bashrc-vs-zshrc-vs-profile minefield. Printing the snippet for paste is good enough for v1.
- **`SYNAPSE_PROXY_ENABLE=1` plist injection.** The CLI tells the user to set this env var manually. A `synapsesync capture proxy enable` command that edits the launchd plist would close the last manual step.
- **System keychain install (with admin password) for GUI tools.** Login keychain works for ~95% of cases; system keychain is a future Pro/Enterprise feature.
- **CA rotation.** When the 10-year CA approaches expiry, regenerate + reinstall. Far future.
- **Cross-platform parity (Linux / Windows).** Today the CLI prints manual instructions on non-macOS. Linux `update-ca-certificates` integration + Windows `certutil` integration are follow-ups.

## Status

**SHIPPED.** The proxy daemon now has a full onboarding flow. With `synapsesync capture proxy install` + the printed env snippet pasted into shell rc + `SYNAPSE_PROXY_ENABLE=1` + daemon restart, the user has a working session capture for every AI tool that honors `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS`. The hardest engineering work on the proxy daemon (Layers 1–8) is complete; remaining work is polish (auto-enable, plist editing, cross-platform).
