# Windows + Codex — Manual Smoke Test

**For:** Whoever (human or AI agent) picks up Synapse on a Windows desktop with `codex` installed.
**Created:** 2026-05-30, after Slice B (cross-platform proxy CA install) shipped.
**Why this doc exists:** CI's `proxy-windows-e2e` validates the install pipeline up to `X509Store.Open` — it cannot click the Windows trust-confirmation dialog, cannot land the cert in the real store, and cannot exercise an actual AI CLI round-trip. This doc covers what needs human-on-desktop interaction to verify.

---

## Context the next agent needs (read this first)

- **HEAD when written:** `b14f923` (`test(proxy): Windows CI validates install pipeline, skips trust-prompt assertion`)
- **What's already validated by automation:**
  - CI matrix: 9/9 green on `b14f923` — verify, e2e, migrate, proxy-linux-e2e × 5 distros, proxy-windows-e2e (pipeline scope only)
  - 677 unit tests passing on macOS local
  - The Windows install pipeline reaches `X509Store.Open` in CI (`step6:open-store` trace assertion in `e2e-proxy-install.ps1`)
- **What's NOT validated and is the point of this smoke test:**
  - The actual Windows trust dialog → user clicks Yes → cert lands in `CurrentUser\Root`
  - `synapsesync` round-trip through proxy with a real AI CLI (specifically `codex`)
  - Whether the proxy's endpoint-recognition handles OpenAI's `/v1/chat/completions` or `/v1/responses` (it was built for Anthropic's `/v1/messages` originally; codex is the OpenAI-shaped traffic stress test)
- **Known limitation surfaced during Slice B:** `certutil -addstore`, PowerShell `Import-Certificate`, and `X509Store('Root','CurrentUser').Add` all ultimately call Win32's `CertAddCertificateContextToStore`, which shows a GUI confirmation dialog on Root-store adds. The dialog cannot be reliably suppressed on Server 2022 even with HKLM `ProtectedRoots\Flags=0x20`. **On a real Windows desktop the user has a desktop to click Yes on, so this isn't a problem there — but the install command WILL pause waiting for the click.**

## Prerequisites — verify BEFORE starting

Run in PowerShell:

```powershell
# 1. openssl on PATH (Synapse uses it to generate the local CA — no graceful
#    fallback exists today; missing openssl causes a raw ENOENT crash)
where.exe openssl
# Expected: a path like C:\Program Files\Git\usr\bin\openssl.exe
# If "INFO: Could not find files for the given pattern(s).":
#   - Install Git for Windows from https://git-scm.com/download/win, OR
#   - winget install ShiningLight.OpenSSL.Light
#   - Then re-open PowerShell so PATH refreshes

# 2. Node.js >= 24 (mcp uses @synapse/shared which ships .ts only,
#    needing Node's native type-stripping in v22+ improved in v24)
node --version
# Expected: v24.x or higher

# 3. codex CLI
codex --version
# Expected: codex prints its version

# 4. synapsesync CLI
synapsesync --version
# OR if installed from this repo's mcp workspace:
node "$env:USERPROFILE\Documents\synapse\mcp\dist\index.js" --version
```

If any prerequisite fails, fix it before proceeding — the tests below assume all four work.

---

## Test plan — 4 tests, ~15 min total

Run in this order. **Stop and report on first failure** rather than continuing through — a failed earlier test usually invalidates assumptions for later tests.

### Test 1 — Install pipeline + trust dialog (5 min)

This is the headline gap CI can't cover.

```powershell
cd $env:USERPROFILE\Documents\synapse   # or wherever the repo is checked out
git log -1 --oneline   # confirm you're at b14f923 or later
npm run test:e2e:proxy-windows
```

**What you should see:**

1. CLI prints: `== e2e-proxy-install (Windows) ==`
2. CLI prints: `[install] node ...\mcp\dist\index.js capture proxy install`
3. **Windows pops up a dialog: "Do you want to install this certificate? Thumbprint: ..."**
   - **Click Yes.**
   - If no dialog appears within ~10s, something has changed since this doc was written — capture the daemon's stderr (the `[windows-debug]` lines printed to the script's output) and check whether `step7:add` appears in the trace.
4. CLI prints daemon debug traces (`[windows-debug ...]`) and clack output (`CA installed in login keychain`)
5. CLI prints: `[install] PASS (pipeline reached X509Store layer; trust-prompt skip is expected on headless CI)`
6. CLI prints: `[status] PASS`
7. CLI prints: `[uninstall] command completed`
8. CLI prints: `PASS windows`

**The script doesn't verify the cert actually landed in the store** — it was relaxed to make CI pass without a dialog. So **between the install and uninstall stages, manually verify:**

```powershell
# Run this AFTER you click Yes but BEFORE the script gets to the uninstall stage.
# You may need to add a `Read-Host "press enter to continue"` between stages
# in scripts/e2e-windows/e2e-proxy-install.ps1 if the script runs too fast.
certutil -store -user Root "Synapse Proxy CA"
# Expected: exit 0, output contains "Synapse Proxy CA"
```

**Easier alternative:** run the install + status + uninstall stages by hand instead of via the script:

```powershell
# Install with manual click-Yes pause for verification
node mcp\dist\index.js capture proxy install
# (click Yes on the dialog)
certutil -store -user Root "Synapse Proxy CA"   # Expected: exit 0, cert listed
Get-ChildItem Cert:\CurrentUser\Root | Where-Object Subject -Match "Synapse Proxy CA"   # Expected: returns the cert

node mcp\dist\index.js capture proxy status
# Expected: "CA: present", "Keychain: trusted" (misleading message — should say "Windows trust store"), proxy port 7727

node mcp\dist\index.js capture proxy uninstall
# Expected: success message
certutil -store -user Root "Synapse Proxy CA"
# Expected: exit non-zero, "CertUtil: -store command FAILED: 0x80090011" (NTE_NOT_FOUND)
```

**PASS criteria for Test 1:**
- Trust dialog appears
- After clicking Yes, `certutil -store -user Root "Synapse Proxy CA"` returns exit 0
- `synapsesync capture proxy status` reports CA present + trusted
- After uninstall, `certutil -store` returns NTE_NOT_FOUND

**Cosmetic issues to note (don't fail the test):**
- "CA installed in login keychain" is macOS-flavored copy — on Windows it should say "Windows trust store". File as a follow-up if confirmed.

---

### Test 2 — Codex traffic actually goes through proxy AND gets captured (5 min)

This is the real product test — proves the entire stack works on Windows with a non-Anthropic AI CLI.

**Setup once (BEFORE the test):**

```powershell
# Install the CA (Test 1 procedure) and KEEP it installed for this test.
node mcp\dist\index.js capture proxy install
# (click Yes on dialog)

# Apply env vars persistently to user scope so a fresh PowerShell sees them.
[Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", "$env:USERPROFILE\.synapse\proxy\ca.pem", "User")
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://127.0.0.1:7727", "User")

# Close this PowerShell window — env vars only inherit in NEW shells.
```

**Open a FRESH PowerShell window**, then:

```powershell
# Verify env propagated
$env:NODE_EXTRA_CA_CERTS   # Should print the ca.pem path
$env:HTTPS_PROXY           # Should print http://127.0.0.1:7727

# Enable the proxy capture
synapsesync capture proxy enable
# Expected: daemon restarts, proxy enabled

# Run codex with a memorable prompt
codex
# Type something like: "What's the capital of Slovenia? Answer in one word."
# Codex should respond normally with "Ljubljana" or similar.

# Check what was captured
synapsesync sessions
# Expected: a new session entry timestamped from when you ran codex.

# Inspect the captured session content
# (replace <session-id> with whatever sessions listed)
synapsesync session <session-id>
# OR look at the raw capture files in:
ls $env:USERPROFILE\.synapse\captures\
```

**PASS criteria for Test 2:**
- Codex completes the request successfully (no TLS error like "self-signed cert in chain" — would indicate `NODE_EXTRA_CA_CERTS` not propagated)
- `synapsesync sessions` lists the new codex session
- The captured session contains the prompt text and the response text (proves endpoint recognition handles OpenAI's API format)

**Critical thing to look at:** does `synapsesync sessions` show your prompt CONTENT, or just the request URL with no body? If just URL, the proxy is intercepting but **not parsing** OpenAI's traffic format. The endpoint recognition (`mcp/src/capture/proxy/endpoint-recognition.ts`) was built around Anthropic's `/v1/messages` shape; OpenAI uses `/v1/chat/completions` or `/v1/responses`. **If you see URL but no content, that's a real product gap to file — codex doesn't actually get captured today, only intercepted.**

---

### Test 3 — Enable/disable cycle on Windows (2 min)

Confirms daemon restart on Windows is clean (no port collision, no orphan listener).

```powershell
synapsesync capture proxy disable
# Expected: daemon restarts without proxy

# Run codex AGAIN with a different prompt
codex
# Type something else, like "What's 7 squared?"
# Codex should still work (no proxy → no capture, but no failure either).

synapsesync sessions
# Expected: NO new session captured for this codex run (proxy was disabled).

synapsesync capture proxy enable
# Expected: daemon restarts with proxy on again

codex
# Type "Repeat after me: hello world"
# Codex completes.

synapsesync sessions
# Expected: a NEW session captured (proxy was re-enabled).
```

**PASS criteria:** captures only happen during the enabled state. Daemon restarts cleanly each time without "EADDRINUSE 127.0.0.1:7727" errors.

---

### Test 4 — Uninstall removes the cert (1 min)

```powershell
synapsesync capture proxy uninstall
# Expected: success
certutil -store -user Root "Synapse Proxy CA"
# Expected: exit code != 0, error 0x80090011 (NTE_NOT_FOUND)

Get-ChildItem Cert:\CurrentUser\Root | Where-Object Subject -Match "Synapse Proxy CA"
# Expected: empty result (no match)
```

**PASS criteria:** cert genuinely removed from the trust store. Both certutil and PowerShell agree it's gone.

---

## Reporting back

After running:

### If everything passes
- Save a Synapse insight: `learning` type, "Windows + codex e2e validated end-to-end on real desktop"
- File the cosmetic copy issue ("login keychain" message on Windows) as a follow-up if confirmed
- Update `docs/E2E-PROTOCOL.md` to note manual Windows validation was completed for `<HEAD-sha>`

### If Test 2 shows captured URL but no content (the endpoint-recognition gap)
- This is a real product gap, not a Windows-specific bug.
- Save Synapse action_item: "Proxy endpoint recognition handles only Anthropic /v1/messages; OpenAI codex traffic intercepted but not captured. Extend `mcp/src/capture/proxy/endpoint-recognition.ts` to recognize `/v1/chat/completions` and `/v1/responses`."
- Don't fix on the Windows machine — file the task, let someone implement on a dev machine with full toolchain.

### If anything else fails
- Capture the FULL output of the failing step.
- Look for `[windows-debug ...]`, `[onboarding-debug ...]`, or `[tls-debug ...]` lines (these are env-gated by `SYNAPSE_PROXY_DEBUG=1` which the test script sets).
- The LAST `stepN:` trace line tells you exactly where the daemon was when it broke.
- File the bug class — don't try to fix the daemon in a CI-disconnected Windows session without the full TypeScript build environment.

---

## Known gotchas specific to Windows

1. **openssl absence is a hard blocker** — if `where.exe openssl` returns nothing, install crashes with a raw `ENOENT` stack trace. The deferred `node-forge` port would eliminate this dependency; until then, openssl is an implicit prereq.
2. **Git for Windows openssl is on PATH in Git Bash but NOT necessarily in PowerShell** — Git installs to `C:\Program Files\Git\usr\bin\openssl.exe`, which is in Git Bash's PATH by default but typically NOT in PowerShell's. You may need to add it to the user PATH manually, or `winget install ShiningLight.OpenSSL.Light` to get a PowerShell-PATH-native install.
3. **Trust dialog requires interactive desktop** — if running over SSH or via a headless RDP session, the dialog may appear on a desktop you can't see and the install will hang. Use an interactive logon session.
4. **WSL is a separate world** — if you're running codex in WSL, this test doesn't apply. WSL uses the Linux backend (`update-ca-certificates`) — that path is already CI-validated for Debian/Ubuntu/Fedora/Rocky/Arch.
5. **Persistent env vars only apply to NEW shells** — `[Environment]::SetEnvironmentVariable(..., "User")` writes to the registry, but the current PowerShell process has already loaded its environment. Open a new PowerShell window after applying.
6. **Misleading "keychain" copy** — the success message says "CA installed in login keychain" on Windows. It's just untranslated macOS copy. File as a follow-up if confirmed.

---

## Where to find things

- **Repo HEAD reference:** `b14f923` on tanmain/synapse main, mirrored to metanmai/synapse (bot ~1-2 min lag)
- **Windows install backend code:** `mcp/src/capture/proxy/backends/windows.ts`
- **Unit tests:** `mcp/test/capture/proxy/backends/windows.test.ts` (13 cases) + dispatcher routing in `mcp/test/capture/proxy/onboarding.test.ts`
- **CI workflow:** `.github/workflows/ci.yml` → `proxy-windows-e2e` job
- **E2E script:** `scripts/e2e-windows/e2e-proxy-install.ps1` (run via `npm run test:e2e:proxy-windows`)
- **E2E protocol overview:** `docs/E2E-PROTOCOL.md` (see "Platform-matrix E2E" section)
- **Synapse insights to read first:** search Synapse for "Windows Root-store add" and "Cross-platform proxy CA backends shipped"
