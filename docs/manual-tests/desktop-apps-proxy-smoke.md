# Desktop apps through the Synapse proxy — manual smoke checklist

**Task #118** in `.planning/STATE.md`. Tests whether Cursor, Claude
Desktop, and ChatGPT Desktop honor `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS`
and produce captures via the proxy.

> Sibling automated coverage already exists for the CLI tools (`claude`,
> `codex`) via `scripts/e2e-proxy-layer5.mjs`. Desktop apps need manual
> execution because they're GUI Electron processes — no headless harness.

## Pre-check (2 min — run this first)

Before launching anything, run the static cert-pinning probe:

```bash
node scripts/desktop-apps-tls-probe.mjs
```

The probe inspects each app's `Info.plist` (`NSAppTransportSecurity`,
`NSPinnedDomains`) and walks `Contents/Resources/` for bundled CA stores.
It outputs a per-app verdict — `cert-pinned`, `likely-cert-pinned`,
`proxy-friendly`, or `ambiguous` — plus a recommendation on whether the
manual checklist below is worth running for that app.

If an app comes back `cert-pinned` (high or medium confidence), skip the
per-app section below for it and record the finding directly as a Synapse
insight: "(app-name) through proxy: cert-pinned (static signal), MITM not
viable." That's the answer; no manual launch needed.

Use `--json` for machine-readable output if scripting around the probe.
The probe is read-only — it never launches the apps or touches the network.

## Prerequisites

Run these once before the per-app sections.

- [ ] **Synapse installed locally.** `synapsesync init` ran successfully,
  `synapsesync status` shows daemon running.
- [ ] **Proxy CA installed in the OS trust store.**
  ```bash
  synapsesync capture proxy install
  # confirm in trust store:
  #   macOS:  Keychain Access → login → search "Synapse Proxy CA"
  #   Linux:  /etc/ssl/certs/synapse.pem present
  #   Windows: certmgr.msc → Trusted Root Cert Authorities → "Synapse Proxy CA"
  ```
- [ ] **Proxy enabled.**
  ```bash
  synapsesync capture proxy enable
  synapsesync capture proxy status   # confirms enabled + port 7727
  ```
- [ ] **Daemon restarted** so the proxy server is bound (`enable` triggers
  this automatically — verify via `lsof -i :7727` on macOS/Linux, or
  `Get-NetTCPConnection -LocalPort 7727` on Windows).
- [ ] **Note the snapshot of captured sessions BEFORE testing** so you
  can tell new captures apart from old ones:
  ```bash
  synapsesync sessions | wc -l   # remember this number
  ```

---

## Cursor

Cursor is an Electron + Chromium app. Two routes to make it use the proxy:

1. **OS-level proxy** (recommended for the test) — set System Settings →
   Network → Proxies → HTTPS Proxy = `127.0.0.1:7727`. Cursor inherits.
2. **Env-var launch** — `HTTPS_PROXY=http://127.0.0.1:7727
   NODE_EXTRA_CA_CERTS=~/.synapse/proxy/ca.pem open -a Cursor` on macOS.
   Note: Cursor's renderer process may NOT inherit env vars set this
   way — preferred to use route 1.

- [ ] Quit Cursor completely (right-click dock icon → Quit), then set the
  OS-level HTTPS proxy + relaunch.
- [ ] Open any project. Open the Cursor chat panel.
- [ ] Send a one-turn prompt: "What does the file structure look like?"
- [ ] Wait for the response to complete.
- [ ] **Check capture:**
  ```bash
  synapsesync sessions | head -5
  # expected: a new session entry with tool=cursor and recent timestamp
  ```
- [ ] **If no capture appears**, check `~/.synapse/daemon.log` for proxy
  errors. Possible failure modes:
  - Cursor ignoring system proxy → try the env-var route.
  - Cursor cert-pinning → TLS handshake fails with our CA-signed leaf
    cert. Look for "cert authority invalid" in `daemon.log`. If
    confirmed: **document as a hard "cert pinning, proxy MITM not
    viable" finding** and skip Cursor.
- [ ] Disable OS-level proxy after testing (restore prior value).

---

## Claude Desktop

Anthropic's official Mac/Windows desktop app. Electron-based. Uses
`api.anthropic.com` directly.

- [ ] Quit Claude Desktop fully.
- [ ] Set OS-level HTTPS proxy = `127.0.0.1:7727` (same as Cursor).
- [ ] Relaunch Claude Desktop.
- [ ] Start a new conversation. Send a one-turn prompt.
- [ ] **Check capture:**
  ```bash
  synapsesync sessions | head -5
  # expected: new session, tool=claude-desktop (or whatever the proxy
  # endpoint-recognition classifies it as based on User-Agent)
  ```
- [ ] If captured but tool field is wrong, note the actual value and
  open a follow-up issue against `proxy/endpoint-recognition.ts`.
- [ ] If TLS errors appear in `~/.synapse/daemon.log`, Claude Desktop is
  likely cert-pinning — document and move on.

---

## ChatGPT Desktop

OpenAI's official Mac/Windows desktop app. Electron-based. Uses
`api.openai.com` + websocket endpoints.

- [ ] Quit ChatGPT Desktop fully.
- [ ] OS-level HTTPS proxy still set from previous step.
- [ ] Relaunch ChatGPT Desktop.
- [ ] Start a new conversation. Send a one-turn prompt.
- [ ] **Check capture:**
  ```bash
  synapsesync sessions | head -5
  # expected: new session, tool=chatgpt-desktop
  ```
- [ ] If websocket endpoints aren't intercepted (the proxy currently
  only MITMs HTTPS CONNECT), the chat-streaming traffic may bypass the
  proxy entirely. **This is the most likely failure mode** — note the
  exact behavior and we'll need WebSocket-CONNECT handling in a future
  layer.

---

## Cleanup

- [ ] Restore OS-level proxy to its prior value (or leave on if you're
  permanently capturing).
- [ ] `synapsesync capture proxy disable` if you don't want capture
  active for future sessions.
- [ ] Add a short summary to the Synapse insight log:
  ```
  synapse: save_insight type=learning summary="<app> through proxy: <captures | TLS-pinned | unrecognized>"
  ```

## What "pass" looks like

A test passes if, after the per-app section:
- `synapsesync sessions` shows a NEW entry for that app
- The session message count matches the conversation length (1-turn
  prompt → 2 messages: user + assistant)
- `~/.synapse/daemon.log` shows the proxy intercepting requests for the
  right host (`api.anthropic.com` / `api.openai.com`)

A test FAILS (but is informative) if:
- TLS errors in `daemon.log` indicate cert pinning — record the app as
  "proxy-MITM not viable" and consider whether to deprioritize.
- Captures appear but with wrong tool identifier — open a focused issue
  against `endpoint-recognition.ts` with the captured User-Agent.

## After running

Save results back to Synapse as an insight, then mark Task #118
completed in `.planning/STATE.md`.
