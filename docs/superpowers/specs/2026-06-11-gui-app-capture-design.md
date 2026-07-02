# Design — GUI / Browser Capture (claude.ai, chatgpt.com, desktop apps best-effort)

**Date:** 2026-06-11
**Status:** Draft for review (revised after adversarial design review — see "Review changelog")
**Author:** brainstorming session (Tanmai + Claude), hardened by an Opus design review

## Problem

Synapse captures AI sessions two ways today:

1. **File-watcher** (chokidar on tool session-JSONL dirs) — zero setup, the capture backbone.
2. **TLS-MITM proxy** (port 7727) — captures CLI tools that honor `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS`, *if* the user did the manual env-var paste.

Neither captures GUI/browser AI usage — the Claude Desktop app, ChatGPT Desktop app, or browser sessions on `claude.ai` / `chatgpt.com`. This is universal (every user, every OS), because (a) GUI apps obey the OS system proxy, not shell env, and `proxy enable` never sets the OS proxy; (b) the CA is trusted only in the login keychain, but Electron/Chromium validate against the System trust store.

This design adds an **opt-in, default-OFF, crash-safe** routing+trust shell around the existing proxy to close the gap **for browsers as the primary target**, with native desktop apps as explicitly best-effort (see Goals — a design review found both native apps are largely uncapturable today).

## Review changelog (what the adversarial review changed)

The first draft assumed the native desktop apps were the prize and that routing+trust would suffice. Verification falsified key claims; this revision incorporates all findings:

- **Native ChatGPT Desktop (macOS) pins certs** and OpenAI removed pinning exceptions (2026-02) → uncapturable by local-CA MITM. **Demoted out of v1.** (rev C1)
- **Native Claude Desktop (Electron) is Cloudflare-403'd through an explicit proxy on macOS** (UA-based, independent of trust) → at-risk even if routed+trusted. **Best-effort, not a v1 commitment.** (rev C2)
- **There is no shared host constant** and `endpoint-recognition.ts` classifies `claude.ai`/`chatgpt.com` as `capture:false`. Routing browser hosts captures *nothing* without **net-new web-session parsing** — now explicit in-scope work. (rev C3)
- **Proxy MITMs any host routed to it** (no allowlist in `handleConnect`) — host restriction was PAC-advisory only. Now enforced at the proxy. (rev M1)
- **Windows raw `AutoConfigURL` write is unreliable** for Chromium/Electron — must author `DefaultConnectionSettings`. (rev H1)
- **PAC `;DIRECT` failover isn't transparent** (first-request stall, ~5min bad-proxy cache) and **fails entirely when the PAC server itself is down** (daemon fully dead). Crash-safety reworded + hardened. (rev H2/H3)
- **macOS `setautoproxyurl` persistence is unreliable** (Sequoia regression) → manual reboot smoke test added. (rev H3)
- **Linux trust = sudo system-store only today**; per-user NSS is net-new. Linux GUI **cut from v1**. (rev H4)
- Added a **Security section** (CA key protection under System-trust). (rev M2)
- De-dup, Netskope coexistence, status diagnostics, pacport, wizard copy all corrected (rev M3/M4/L1/L2/L3).

## Goals & Non-Goals

**v1 "done" = browser capture works:**
- Capture browser sessions on `claude.ai` and `chatgpt.com` (Chrome/Edge/Safari) — **this is the primary, committed target.**
- Opt-in via a wizard step, default OFF.
- **Crash-safe**: a dead daemon must self-heal networking to DIRECT (within one failover timeout — not instantly; see §4).
- macOS + Windows. **Linux GUI/browser capture is NOT in v1** (sudo-only trust today + weak gsettings routing — revisit later).

**Best-effort (ship if the spike says capturable, don't block v1):**
- Native Claude Desktop app — gated on the macOS Cloudflare-403 spike (rev C2).

**Non-Goals:**
- Native ChatGPT Desktop app — known-uncapturable (pinning, rev C1). Out.
- File-captured IDEs (Cursor/Windsurf) — file-watcher stays primary; do not target via proxy.
- Defeating cert pinning / HSTS — if a target pins, capture yields nothing; we document, not bypass.
- PAC-merging for machines with an explicit corporate PAC already set (future enhancement).
- Per-app network-extension interception (notarized extensions / WFP / netfilter) — out.
- Linux GUI capture (deferred).

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Primary target | **Browsers** (claude.ai/chatgpt.com) | Native apps largely uncapturable (rev C1/C2) |
| Native Claude Desktop | Best-effort, spike-gated | Cloudflare-403 risk on macOS proxied path |
| Native ChatGPT Desktop | Out | Cert pinning, no exceptions |
| OS scope | macOS + Windows (Linux deferred) | Linux trust/routing too weak for v1 (rev H4) |
| Routing primitive | PAC + host-allowlist + `;DIRECT` fallback | Crash-safe-ish, minimal blast radius |
| Allowlist enforcement | **Both** PAC (advisory) **and** proxy (enforced) | PAC isn't a security boundary (rev M1) |
| Web-session capture | **Net-new** recognition + extractors for claude.ai/chatgpt.com | Existing code only parses API bodies (rev C3) |
| Default state | OFF, opt-in | System-proxy + System-keychain are invasive |

## Architecture

Existing proxy (TLS-MITM 7727, `ProxySource → CloudSyncer`) unchanged. New shell:

```
   wizard opt-in ──▶ GuiCaptureManager (enable / disable / status)
   (default OFF)        │
        ┌───────────────┼─────────────┬───────────────┬──────────────┐
        ▼               ▼             ▼               ▼              ▼
   RoutingMgr       PAC server    SystemCA      Watchdog/        WebSession
   (per-OS          :7728         trust         reconcile        recognizers
    autoproxy)      (allowlist)   (per-OS)      (clear on stale) (claude.ai/
        │               │                                         chatgpt.com)
        ▼               ▼
  OS proxy ─▶ reads PAC ─▶ host ∈ CAPTURE_HOSTS? ─▶ PROXY 127.0.0.1:7727; DIRECT ─▶ proxy
                          else ─▶ DIRECT                                              │
                                                          proxy ENFORCES allowlist ───┤
                                                          (refuse-MITM non-allowlist) │
                                                          recognize + extract ────────┘
```

| New component | Job | Location |
|---|---|---|
| **CAPTURE_HOSTS constant** | Single source of truth for routed+captured hosts; consumed by PAC gen, `endpoint-recognition`, and proxy enforcement | `mcp/src/capture/proxy/capture-hosts.ts` (new) |
| **RoutingManager** | Set/clear OS auto-proxy, per-OS backends | `mcp/src/capture/proxy/routing/` (new) |
| **PAC server** | Serve allowlist PAC over `http://127.0.0.1:7728/proxy.pac` | extends daemon |
| **System-CA trust** | Per-OS system-trust install, admin-gated where required | extends `onboarding.ts` with `scope:'system'` |
| **Web-session recognizers** | Classify + extract `claude.ai`/`chatgpt.com` web wire formats (SSE/JSON, differ from API bodies) | extends `endpoint-recognition.ts` + `session-reconstruction.ts` |
| **Proxy allowlist enforcement** | `handleConnect` refuses to MITM hosts ∉ CAPTURE_HOSTS | edit `server.ts` |
| **Watchdog/reconcile** | Clear routing on stale healthcheck; reconcile on startup | daemon |
| **GuiCaptureManager** | Orchestrate the above | `mcp/src/capture/proxy/gui-capture.ts` (new) |

**Core invariant:** every piece is symmetric/reversible — `disable`, `uninstall`, crash all converge on "auto-proxy cleared."

## §1. Wizard flow & lifecycle

CLI (mirrors existing verbs): `synapsesync capture gui enable | disable | uninstall | status`.

**Wizard opt-in** — `clack.confirm`, default N:
```
? Also capture browser AI sessions? (claude.ai, chatgpt.com)
    • One admin prompt on macOS (trusts Synapse's cert system-wide)
    • Routes only AI hosts to Synapse — other traffic stays direct
    • Restores to a direct connection automatically if Synapse stops
  (y/N)
```
On `y` → `GuiCaptureManager.enable()`. Admin unavailable / explicit corporate proxy detected → "skipped GUI capture, CLI + file capture still active," continue. Never hard-fail.

**Lifecycle ordering = safety contract** (build up; unwind reverse; roll back on mid-enable failure):

| Step | Enable | Teardown (reverse) |
|---|---|---|
| 1 | Ensure base proxy running | clear auto-proxy URL **first** |
| 2 | Install System CA (admin if macOS) | stop PAC server |
| 3 | Start PAC server, confirm reachable | (CA kept on disable; removed on uninstall) |
| 4 | Set OS auto-proxy URL **last** | — |

## §2. Routing layer (PAC + enforced allowlist)

**PAC script** — generated from the new shared `CAPTURE_HOSTS` constant:
```javascript
function FindProxyForURL(url, host) {
  if (CAPTURE_HOSTS.includes(host)) return "PROXY 127.0.0.1:7727; DIRECT";
  return "DIRECT";
}
```
`CAPTURE_HOSTS` = `api.anthropic.com, claude.ai, chatgpt.com, chat.openai.com, api.openai.com` (browser + API). **The same constant drives `endpoint-recognition` and proxy enforcement** — a real shared source, not a hope (rev C3). A test asserts PAC hosts ⊆ recognized-and-extractable hosts.

**Served over HTTP** (`http://127.0.0.1:7728/proxy.pac`) not `file://` (flaky in browsers); doubles as a kill-switch (serve `DIRECT` PAC to stop routing instantly). pacport default 7728, **persisted in `proxy-config.json` (new field), and startup-reconcile rewrites the OS auto-proxy URL to the actually-bound port** so a port change can't silently break routing (rev L2).

**Proxy-side enforcement (rev M1):** `handleConnect` refuses to MITM any host ∉ `CAPTURE_HOSTS` (blind-tunnel it instead). PAC narrows what's *sent*; the proxy enforces what's *intercepted*. Closes the "any client can tunnel arbitrary HTTPS through a System-trusted-CA proxy" hole.

**Per-OS set/clear:**

| OS | Set | Clear |
|---|---|---|
| macOS | `networksetup -setautoproxyurl <svc> http://127.0.0.1:7728/proxy.pac` per service | `-setautoproxystate <svc> off` |
| Windows | author `DefaultConnectionSettings` (+`SavedLegacySettings`) via `InternetSetOption(INTERNET_OPTION_PER_CONNECTION_OPTION)` then `SETTINGS_CHANGED`+`REFRESH` — **NOT a raw `AutoConfigURL` registry write** (rev H1; Chromium/Electron read WinINET `DefaultConnectionSettings`, not the loose string) | rewrite the blob (not "delete a value") |

**Windows implementation risk (rev H1):** the existing Windows backend deliberately shells out (PowerShell/certutil) and avoids native APIs; `InternetSetOption` needs WinINET interop with no built-in Node binding. Flag as an impl risk — may need a tiny PowerShell `Add-Type` shim or a vetted helper.

**Corporate coexistence — two stacked MITMs, partial detection (rev M4):** Netskope steers via a macOS **network extension** below the proxy layer — it generally does *not* occupy the auto-proxy slot, so "slot empty ⇒ set ours" is reasonable. But: (1) when our proxy connects upstream, Netskope's extension intercepts *that* too — it's **two stacked MITMs**, not a linear chain; double-decryption can break HTTP/2 coalescing or trip DLP. (2) A transparent network-extension MITM is **undetectable from a Node daemon** — detect-and-don't-clobber only sees the *explicit* proxy/PAC slot. So on a Netskope Mac we proceed blind and hope upstream-CA-trust (`NODE_EXTRA_CA_CERTS`) holds. Slot occupied (explicit corporate PAC) → don't clobber, degrade. Best-effort, not guaranteed.

## §3. Trust layer (System-trust CA)

Extend `onboarding.ts` backends with `scope:'system'`:

| OS | Mechanism | Admin? |
|---|---|---|
| macOS | `sudo security add-trusted-cert -d -r trustRoot -p ssl -k /Library/Keychains/System.keychain ca.pem` | **Yes** |
| Windows | `certutil -addstore -f Root` (CurrentUser) — already the Tier-1 path in `windows.ts`; **verify in the spike** whether Claude Desktop Electron honors CurrentUser Root or bundles its own store (rev H1/C2) | Likely **no** |

Branch wizard copy on admin need (only macOS prompts). Degrade gracefully when admin unavailable. `uninstall` removes from whichever store `enable` populated.

**Linux trust is cut from v1 (rev H4):** the existing Linux backend is sudo-system-store only and (per its own logic) doesn't reach Chromium/Electron, which use per-user NSS (`~/.pki/nssdb`) — that's unbuilt. Don't half-claim it.

## §4. Crash-safe restore (corrected — rev H2/H3)

Four layers, honest about the gap:

1. **PAC `;DIRECT` fallback** — works **only while the PAC is still served**. "Proxy 7727 dead, PAC 7728 alive" ⇒ apps fetch the PAC, get `;DIRECT`, fall through. **NOT transparent**: the first request per app stalls for the connect-failure timeout, and Chromium marks the proxy "bad" for ~5 min. A *half-open* 7727 (accepts, never responds) is the dangerous case — full connect timeout. Reword the guarantee to **"networking self-heals to DIRECT within one failover timeout per app,"** not "never breaks."
2. **Daemon-fully-dead gap (the real hole):** if the daemon is dead, **7728 is also down → the PAC can't be fetched at all**, and per-browser PAC-unreachable behavior is undefined (many fall back to DIRECT; some stall/queue). Layer 1's guarantee does **not** cover this. **Mitigations:** (a) on graceful shutdown (SIGTERM/SIGINT) clear the auto-proxy URL entirely — don't rely on a dead PAC; (b) consider running the PAC server in a *separate, more-resilient* tiny process from the capture proxy so 7728 outlives a 7727 crash.
3. **Daemon-startup reconciliation:** restarted daemon reconciles OS auto-proxy vs `proxy-config.json` (clear if GUI disabled; restart PAC + rewrite URL to bound port if enabled).
4. **`gui status` drift surfacing** (+ per-host diagnostics, see L1).

**macOS persistence risk (rev H3):** `setautoproxyurl` is not reliably persistent across OS updates and has a reported Sequoia regression (proxy stops functioning / GUI toggle breaks after set). **Add a manual smoke step:** set auto-proxy URL → reboot with daemon stopped → confirm a GUI app still has working networking.

## §5. Capture path & web-session reconstruction (expanded — rev C3)

**Net-new work, not free:** routing `claude.ai`/`chatgpt.com` captures nothing today because `endpoint-recognition.ts` returns `capture:false` for them and `session-reconstruction.ts` only extracts the API `/v1/messages` body shape. The browser wire format (SSE streams, different JSON envelopes, auth via cookies not API keys) needs **new recognizers + extractors**. This is the bulk of the implementation risk and must be scoped explicitly. The spike (§7) must confirm the wire format is parseable before committing.

**De-dup (rev M3):** must-capture browsers write no session files → no file-watcher overlap. The only overlap (file-captured IDEs making proxied API calls) is now moot — IDEs aren't targeted and the proxy enforces the host allowlist. **Before accepting any residual double-capture, verify:** (a) it doesn't inflate the tier/quota counts the daemon's flush path reads, and (b) `session-reconstruction`'s `ses_<firstMessageHash>` keying behavior when the same conversation arrives via two sources. Tag proxy-sourced sessions `capturedVia:'proxy'`. The `(source,id)` SessionStore keying remains a fast-follow.

## §6. Security (new — rev M2)

System-trust escalates the stakes vs. login-keychain Tier 1: a leaked CA private key now lets an attacker MITM the victim's AI traffic against a root the OS/GUI apps trust.

- Enforce `0600` on the CA key, `0700` on `~/.synapse/proxy/`.
- Proxy enforces the host allowlist (rev M1) so a stolen-key attacker's *own* proxy is the threat model, not arbitrary interception via ours.
- Document CA validity + a rotation story; shorter validity preferred.
- `gui uninstall` offers to delete the on-disk key, not just remove it from trust stores (today `uninstallCa` leaves the pem).
- Stated accepted risk: a System-trusted long-lived CA + readable key = MITM capability.

## §7. Failure posture & testing

| Condition | Behavior |
|---|---|
| Target pins / HSTS | Capture yields nothing; `gui status` per-host "CONNECT seen, 0 captured" distinguishes pin-vs-routing (rev L1) |
| Claude Desktop macOS Cloudflare-403 | Best-effort target may fail; documented, browser path unaffected |
| No admin (macOS) | Degrade, keep Tier 1 + file-watcher |
| Explicit corporate proxy | Don't clobber, degrade |
| Daemon crash | self-heal within failover timeout (§4 L1) + startup reconcile; graceful-shutdown clears URL |
| pacport in use | bind next free, persist, reconcile OS URL to bound port (rev L2) |

**`gui status` (rev L1):** per allowlisted host report "last CONNECT seen" vs "last captured" — splits routing failure from capture/extractor/pin failure.

**Testing:**
- *Unit (CI):* `CAPTURE_HOSTS`→PAC output; PAC hosts ⊆ recognized+extractable (the anti-drift test); detect-and-don't-clobber; per-OS routing argv via injected runners; proxy allowlist enforcement (refuse-MITM non-allowlisted host); rollback ordering; startup reconcile.
- *Integration:* Windows CI runner — `DefaultConnectionSettings` author/clear round-trip. (Linux deferred.)
- *macOS:* manual smoke checklist per release (admin + GUI + reboot-persistence — rev H3), documented in E2E-PROTOCOL.md.
- *Crash-safety e2e:* `gui enable` → `kill -9` daemon → assert direct fetch to a non-AI host works; → restart → assert reconcile.

**BLOCKING pre-implementation spike (do first — reframed rev C1/C2/C3):**
1. **Primary:** route `claude.ai`/`chatgpt.com` from a real browser through 7727 with the CA System-trusted — does traffic arrive, and is the web wire format recognizable + extractable? (If not parseable, browser capture needs a reconstruction redesign before building.)
2. Claude Desktop macOS: does claude.ai 403 the Electron UA through the proxy?
3. Windows: does Claude Desktop Electron honor CurrentUser Root, or bundle its own store?

If (1) fails, the whole feature is in question — it is the single highest-risk unknown, ahead of any routing/trust work.

## Open questions for review

- Is "browser-first, native apps best-effort" the right v1 scope, or should native Claude Desktop be cut entirely too (simplest) or fought for (Cloudflare-403 workaround research)?
- Separate-process PAC server (§4 layer 2b) — worth the complexity for reboot resilience, or is graceful-shutdown-clears-URL enough?
- Web-session reconstruction (§5) is the biggest unknown — should the spike become its own throwaway prototype before this spec is even planned?
