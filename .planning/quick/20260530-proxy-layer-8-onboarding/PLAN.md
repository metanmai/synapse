---
slug: proxy-layer-8-onboarding
quick_id: 260530-l8
date: 2026-05-30
status: in-progress
---

# Proxy daemon — Layer 8: CA install onboarding

## Goal

Close the last gap between "code complete" and "default-on" for the proxy: give the user a one-command path to install the CA into their system trust store and tell them what env vars to set. Layer 7 wired the proxy into the daemon; Layer 8 makes it possible for a user to actually USE that wiring without manually fiddling with `security add-trusted-cert` and Keychain Access.

## Files

```
mcp/src/capture/proxy/
└── onboarding.ts                         ← NEW: installCa / uninstallCa / caStatus

mcp/test/capture/proxy/
└── onboarding.test.ts                    ← NEW: unit tests with injected security runner

mcp/src/capture/
├── cli.ts                                ← UPDATE: dispatch `proxy install|status|uninstall`
└── capture-worker.ts                     ← UPDATE: default proxy port = 7727
```

## Design

**Injectable `security` runner.** The macOS `security` command modifies persistent system state (login keychain). Tests can't safely run real `security add-trusted-cert` — it would pollute the user's keychain. So the onboarding module accepts an optional `runSecurity` function in its options; the default calls the real binary via `spawnSync`, and tests pass a fake that records arguments + returns canned status codes.

**Best-effort install.** `security` may show a GUI confirmation prompt that the user can dismiss. We don't try to defeat that — we run the command and post-check via `security find-certificate -c "Synapse Proxy CA"`. If the cert is in the keychain after the call, install succeeded; if not, we report the manual fallback path.

**Stable proxy port (7727).** Currently `capture-worker.ts` defaults to OS-assigned (port 0). For HTTPS_PROXY env var to be a stable string in the user's shell rc, the daemon needs a known port. Change the default to 7727. Tests still override explicitly.

**Three subcommands under `synapsesync capture proxy`:**
- `install` — generate CA + install in login keychain + print env snippet
- `status` — show CA path, fingerprint, keychain trust state, daemon proxy port
- `uninstall` — remove from keychain (keeps the CA pem on disk in case of reinstall)

**Why login keychain (not System keychain).** System keychain requires admin password and trusts the cert system-wide for ALL users. Login keychain is user-scoped and requires no admin. For our case (a developer running tools as themselves), login keychain is correct. GUI tools that read system trust (Cursor, Chrome) WILL find the cert in login keychain since macOS's CFNetwork checks both keychains by default.

## Bug class under test

> The onboarding (a) generates a CA but fails to install it AND silently reports success, (b) installs the CA but doesn't set SSL trust so TLS handshakes still fail, (c) returns a different `caCertPath` than the daemon's `TlsManager` produces (path drift between install + runtime), (d) leaves stale trust settings after uninstall, OR (e) crashes on non-macOS instead of degrading to print-manual-instructions mode.

Tests:
- `installCa()` on macOS path: invokes `security add-trusted-cert` with correct args (verified via injected runner) + cert path matches `TlsManager.caCertPath()`
- `installCa()` returns `installedInKeychain: false` when the security command errors (degrades gracefully — manual instructions get included)
- `installCa()` on non-macOS: skips the security call entirely + returns manual instructions in the result
- `caStatus()` when CA doesn't exist: returns `caExists: false`, no security call attempted
- `caStatus()` when CA exists: returns the correct fingerprint + path
- `uninstallCa()` invokes `security delete-certificate -c "Synapse Proxy CA"` and reports the result
- Env snippet contains both `NODE_EXTRA_CA_CERTS` and `HTTPS_PROXY` lines (the two required env vars)
- Env snippet uses the configured proxy port (parameterized)

## Out of scope

- Auto-modifying the user's shell rc (idempotency + bashrc-vs-zshrc-vs-profile minefield)
- Auto-setting `SYNAPSE_PROXY_ENABLE=1` in the launchd plist (separate plist-edit slice)
- GUI tool detection (Cursor / Chrome configured to use HTTPS_PROXY)
- Per-tool config (e.g., writing `.claude/settings.json` to add HTTPS_PROXY)
- System keychain install (requires admin password; not needed for primary use case)
- CA rotation (regenerate + reinstall when CA approaches expiry)

## Definition of done

- Typecheck + lint clean across workspaces
- `npm run test` passes (new onboarding tests + no regressions in existing 596)
- Manual smoke: `synapsesync capture proxy install` prints sensible output on this machine
- Atomic commit + push
- Insight saved
