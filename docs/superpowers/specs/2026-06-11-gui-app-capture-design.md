# Design — GUI-App Capture (Claude Desktop, ChatGPT Desktop, Browser)

**Date:** 2026-06-11
**Status:** Draft for review
**Author:** brainstorming session (Tanmai + Claude)

## Problem

Synapse captures AI coding sessions via two paths today:

1. **File-watcher** (chokidar on `~/.claude/projects/*.jsonl`, `~/.codex/…`, Cursor/Cline/Roo/Copilot storage dirs) — zero setup, captures any tool that writes session files to disk. This is the capture backbone.
2. **TLS-MITM proxy** (port 7727) — captures CLI tools that honor `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS`, *if* the user completed the manual env-var paste.

Neither path captures **GUI applications**: the Claude Desktop app, the ChatGPT Desktop app, or browser sessions on `claude.ai` / `chatgpt.com`. This is true for **every user on every OS**, by design, not a machine-specific quirk. Two architectural gaps cause it:

- `proxy enable` never configures the OS system proxy, so GUI apps (which obey OS proxy settings, not shell env) never route to 7727.
- `proxy install` trusts the CA only in the login keychain, but Electron/Chromium validate against the **System** trust store, so they would reject the MITM cert even if routed.

This design adds an **opt-in, default-OFF, crash-safe second tier** of the proxy that closes both gaps.

## Goals & Non-Goals

**Goals (v1 "done" criteria):**
- Capture the Claude Desktop app, the ChatGPT Desktop app, and browser sessions on `claude.ai` / `chatgpt.com`.
- All three OSes: macOS, Windows, Linux (Linux GUI capture explicitly best-effort — see §3).
- Opt-in via a wizard step, default OFF.
- **Crash-safe**: a dead daemon must never break the user's networking.
- **Best-effort coexistence** with an existing corporate MITM (e.g. Netskope) — work where the environment allows, degrade cleanly where it fights back; do not block v1 on the hard cases.

**Non-Goals:**
- Capturing GUI tools already covered by the file-watcher (Cursor, Windsurf, etc.) — file-watcher stays primary; proxy is fallback only.
- A PAC-merging engine for machines with an explicit corporate PAC already set (future enhancement).
- Per-app network-extension interception (notarized system extensions / WFP / netfilter) — out of scope; revisit only if PAC proves insufficient.
- Defeating certificate pinning. If a target app pins, capture yields nothing for that app and we document it; we do not attempt pinning bypass.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| OS scope | All three (mac/win/linux) | Full parity intent; Linux GUI leg flagged best-effort |
| Must-capture targets | Claude Desktop, ChatGPT Desktop, browser (claude.ai/chatgpt.com) | Highest-value uncaptured surfaces |
| File-captured IDEs | Out of scope (file-watcher primary, proxy fallback only) | No double-work; de-dup concern minimized |
| Corporate MITM | Best-effort coexist; don't block v1 | Detect-and-don't-clobber, not a merge engine |
| Routing primitive | PAC file + host-allowlist + `; DIRECT` fallback | Crash-safe, minimal blast radius, enables coexistence + privacy for free |
| Default state | OFF, opt-in | System-proxy + System-keychain changes are invasive |

## Architecture

The existing proxy (TLS-MITM on 7727, session reconstruction, `ProxySource → CloudSyncer`) is **unchanged**. This feature adds the routing + trust + safety shell around it. GUI capture is an **additive second tier**: Tier 1 (existing) = login-keychain CA + `proxy enable` + shell env → CLI tools; Tier 2 (new) = System-keychain CA + PAC routing → GUI apps. Tier 2 implies Tier 1; you can have Tier 1 without Tier 2.

```
                    ┌────────────────────────────────────────────────┐
   wizard opt-in ──▶│  GuiCaptureManager  (enable / disable / status) │
   (default OFF)    └───────────────┬────────────────────────────────┘
                        ┌───────────┼───────────┬──────────────┐
                        ▼           ▼           ▼              ▼
                 ┌────────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐
                 │RoutingMgr  │ │PAC      │ │SystemCA  │ │Watchdog/    │
                 │(per-OS     │ │server   │ │trust     │ │reconcile    │
                 │ autoproxy) │ │:7728    │ │(per-OS)  │ │             │
                 └─────┬──────┘ └────┬────┘ └──────────┘ └─────────────┘
                       │             │
  GUI app HTTPS ─▶ OS proxy ─▶ reads PAC ─▶ AI host? ─▶ PROXY 127.0.0.1:7727; DIRECT ─▶ [existing proxy] ─▶ capture
                                          else?      ─▶ DIRECT (untouched)
```

| New component | Job | Location |
|---|---|---|
| **RoutingManager** | Set/clear OS *auto-proxy URL* (not a hard proxy), per-OS backends | `mcp/src/capture/proxy/routing/` (new, mirrors `backends/` shape) |
| **PAC server** | Serve the allowlist PAC over `http://127.0.0.1:7728/proxy.pac` | extends the daemon (capture-worker) |
| **System-CA trust** | Per-OS machine/system trust install, admin-gated where required | extends `onboarding.ts` backends with a `scope: 'system'` variant |
| **Watchdog / reconcile** | Clear routing if daemon healthcheck goes stale; reconcile on startup | daemon supervisor + daemon startup |
| **GuiCaptureManager** | Orchestrate enable/disable/status across the four; wizard + CLI both call it | `mcp/src/capture/proxy/gui-capture.ts` (new) |

**Core invariant: every new piece is symmetric and reversible.** `disable`, `uninstall`, and crash all converge on the same clean state (auto-proxy URL cleared, optionally CA removed). Nothing is a one-way door.

## §1. Wizard flow & lifecycle

**CLI surface** (mirrors existing `proxy install/enable/disable/uninstall/status`):
```
synapsesync capture gui enable     # base proxy → System CA (admin) → PAC server → set auto-proxy URL → verify
synapsesync capture gui disable    # clear auto-proxy URL + stop PAC server  (base proxy stays up)
synapsesync capture gui uninstall  # disable + remove System CA
synapsesync capture gui status     # per-layer: CA-trust | PAC-server | auto-proxy | last-capture
```

**Wizard opt-in** — `clack.confirm`, default N, after the base capture step:
```
? Also capture desktop apps & browsers? (Claude Desktop, ChatGPT, claude.ai)
    • One admin prompt (trusts Synapse's cert system-wide)
    • Routes only AI hosts to Synapse — your other traffic is untouched
    • Auto-restores to normal if Synapse ever stops
  (y/N)
```
On `y` → `GuiCaptureManager.enable()`. If admin unavailable or an explicit existing proxy is detected → print "skipped GUI capture, CLI + file capture still active" and continue. **Never hard-fail the wizard.**

**Lifecycle ordering is the safety contract** — build up, unwind in reverse, roll back on mid-enable failure:

| Step | Enable (in order) | Teardown (reverse) |
|---|---|---|
| 1 | Ensure base proxy running | clear auto-proxy URL **first** (apps stop routing) |
| 2 | Install System CA (admin) | stop PAC server |
| 3 | Start PAC server, confirm reachable | (CA kept on `disable`; removed on `uninstall`) |
| 4 | Set OS auto-proxy URL **last** | — |

Set the auto-proxy URL last (apps never route to an unconfirmed proxy); clear it first on teardown (apps stop diverting before the proxy goes away). Any enable step that fails rolls back prior steps.

## §2. The PAC routing layer

**PAC script** — generated from the same provider-host constant the proxy already uses, so the allowlist cannot drift:
```javascript
function FindProxyForURL(url, host) {
  if (host == "api.anthropic.com" || host == "claude.ai" ||
      host == "chatgpt.com" || host == "chat.openai.com" ||
      host == "api.openai.com") {
    return "PROXY 127.0.0.1:7727; DIRECT";   // ; DIRECT = crash-safe fallback
  }
  return "DIRECT";                            // everything else untouched
}
```

**Served over HTTP, not `file://`** — `http://127.0.0.1:7728/proxy.pac` (default pacport 7728, persisted in `proxy-config.json`). Reasons: (1) `file://` PAC is flaky in Safari/Chrome/Edge; (2) all three OSes accept an http auto-config URL reliably; (3) it doubles as a kill-switch — to stop routing instantly the daemon serves a `return "DIRECT"` PAC without touching OS settings.

**Per-OS set/clear** (RoutingManager backends, injectable runners like the `onboarding.ts` backends):

| OS | Set | Clear |
|---|---|---|
| macOS | `networksetup -setautoproxyurl <svc> http://127.0.0.1:7728/proxy.pac` per active service | `-setautoproxystate <svc> off` |
| Windows | registry `AutoConfigURL` + WinINET `INTERNET_OPTION_SETTINGS_CHANGED` refresh | delete the value |
| Linux | `gsettings ...proxy.mode='auto'` + `autoconfig-url` (GNOME) | `mode='none'` |

**Corporate coexistence = detect-and-don't-clobber** (not a merge engine). The OS has one auto-proxy slot. Before setting ours, RoutingManager checks for an existing explicit proxy/PAC:
- **Slot empty** (common — Netskope typically MITMs via a transparent network extension, not the AutoConfigURL slot): safe to set our PAC. AI traffic chains `GUI app → Synapse 7727 → corporate transparent layer → real host`; works because the proxy already trusts the corporate CA upstream via `NODE_EXTRA_CA_CERTS`.
- **Slot occupied** (explicit corporate PAC/system-proxy): we'd break it → don't touch, degrade, log "explicit proxy detected, GUI capture skipped." Merging is a documented future enhancement.

**Linux GUI capture is the weakest leg** — `gsettings` only reaches GNOME apps that honor it; KDE / env-only / many Electron-on-Linux builds ignore it. v1 ships the GNOME path and reports "Linux GUI capture is best-effort" in `gui status` rather than claiming parity.

## §3. Trust layer (System-keychain CA)

GUI apps validate TLS against the OS/system trust store, not the login keychain. Extend `onboarding.ts` backends with a `scope: 'system'` variant. **The admin requirement is asymmetric across OSes — exploit that to minimize friction:**

| OS | System-trust mechanism | Admin needed? |
|---|---|---|
| macOS | `sudo security add-trusted-cert -d -r trustRoot -p ssl -k /Library/Keychains/System.keychain ca.pem` | **Yes** (admin password) |
| Windows | `certutil -addstore -f Root` in **CurrentUser** store (Chromium/Edge/Electron read CurrentUser Root for the current user) | **No** — already the Tier-1 path in `windows.ts`; GUI capture on Windows may need no extra trust step |
| Linux | Chromium/Electron use per-user NSS db: `certutil -d sql:$HOME/.pki/nssdb -A -n synapse -t C,, -i ca.pem` (no sudo). Firefox uses per-profile NSS. System store (`/usr/local/share/ca-certificates/` + `update-ca-certificates`) needs sudo but reaches curl/CLI not GUI | **Mostly no** (per-user NSS) |

So macOS is the only OS that strictly needs an admin prompt for GUI trust. The wizard copy and `GuiCaptureManager` must branch on this: prompt for admin only where required, and **degrade gracefully when admin is unavailable** (corporate-managed Macs) — skip GUI capture, keep Tier 1 + file-watcher, surface the reason in `gui status`.

`uninstall` removes the CA from whichever store(s) `enable` populated — symmetric per OS.

## §4. Crash-safe restore

Defense in depth, four layers, weakest-to-strongest dependency on a live process:

1. **PAC `; DIRECT` fallback (primary).** Even with the auto-proxy URL set and the proxy *and* PAC server both dead, every app falls through to a direct connection. Networking never breaks. This holds with zero live Synapse processes.
2. **Daemon-startup reconciliation.** The OS service (launchd/systemd/Task Scheduler) restarts a crashed daemon. On startup the daemon reconciles: "is an auto-proxy URL set pointing at my PAC, but GUI capture is not supposed to be enabled (per `proxy-config.json`)? → clear it. Is GUI capture enabled but my PAC server isn't up? → start it." Converges to the configured state.
3. **Graceful-shutdown signal handler.** On SIGTERM/SIGINT the daemon clears routing (or serves the DIRECT PAC) before exit, for clean stops.
4. **`gui status` drift surfacing.** Reports any mismatch (auto-proxy set but PAC server down, etc.) so the user / `doctor --smoke` can see and fix.

The watchdog is *layer 2+3*, not a separate always-on process — co-locating it in the daemon-startup + signal-handler avoids the "who watches the watchdog" regress. Layer 1 is what guarantees safety in the gap between crash and restart.

## §5. Capture path & de-dup

Proxy-sourced sessions flow through the existing `ProxySource → store.save + syncer.sync` path, **unchanged**. De-dup analysis:

- **Must-capture targets don't overlap the file-watcher.** Claude Desktop, ChatGPT Desktop, and browser sessions write no local session files, so they have zero file-watcher overlap → no de-dup needed for the v1 goal.
- **Only overlap source = Electron IDEs** (Cursor/Windsurf) that both write session files *and* make proxied API calls to `api.anthropic.com`. Their API host is indistinguishable from Claude Desktop's at the network layer, so the PAC can't exclude them by host.
- **v1 posture:** tag proxy-sourced sessions with `capturedVia: 'proxy'`. Accept that an IDE captured by both paths may double-store in v1 — it is rare, the user prioritized file-watcher for those, and the brief-rendering layer already de-dups insights. A proper `(source, id)` SessionStore keying + content-signature de-dup (the latent refactor noted earlier) is a **fast-follow**, not a v1 blocker.

This keeps v1 scope tight while being honest about the known edge.

## §6. Failure posture

| Condition | Behavior |
|---|---|
| Target app pins its cert | Capture silently yields nothing for that app. `gui status` shows `auto-proxy: set, last-capture: never` as a diagnostic. Per-app pinning findings documented from the spike (§7). |
| No admin (macOS) | Degrade: skip GUI capture, keep Tier 1 + file-watcher, surface reason in status. |
| Explicit corporate proxy already set | Degrade: don't clobber, log + skip. |
| Daemon crash | PAC DIRECT-fallback (networking fine) + startup reconciliation. |
| PAC server port (7728) in use | Pick next free port, persist it, regenerate auto-proxy URL. |

## §7. Testing

**Unit (CI, all OSes):**
- PAC generation: host-allowlist constant → correct `FindProxyForURL` output; AI hosts return `PROXY …; DIRECT`, others `DIRECT`.
- Detect-and-don't-clobber: mocked existing-proxy states (empty slot / occupied slot) → correct set-vs-skip decision.
- RoutingManager per-OS command construction with injected runners (mirrors existing `backends/*.test.ts` pattern) — assert exact `networksetup`/`certutil`/`gsettings` argv, no real syscalls.
- Lifecycle rollback ordering: a mid-enable failure rolls back prior steps; teardown order is reverse of enable.
- Crash reconciliation: simulate "auto-proxy set + GUI disabled in config" → daemon-startup clears it.

**Integration / e2e:**
- Linux (CI Docker, extend the existing `proxy-linux-e2e` matrix): real `gsettings` set/clear + NSS db CA install/remove round-trip.
- Windows (CI runner): registry `AutoConfigURL` set/clear round-trip.
- macOS: can't run admin + GUI in GHA → **manual smoke checklist** per release, documented in E2E-PROTOCOL.md.
- Crash-safety e2e: `gui enable` → `kill -9` daemon → assert (a) a direct fetch to a non-AI host still works, (b) next daemon start reconciles the auto-proxy URL.

**Pre-implementation spike (BLOCKING — do first):**
- Point a configured machine at the Claude Desktop app and the ChatGPT Desktop app; confirm capture actually lands. **If both must-capture native apps pin**, the feature's core value collapses and we rescope to browser-only before building. This spike gates the rest of the work — it is the single highest-risk unknown.

## Open questions for review

- Is the four-layer crash-safety model complete, or is there a gap (e.g. OS-level proxy persistence surviving a reboot with a dead daemon)?
- Is detect-and-don't-clobber the right corporate posture, or should v1 attempt the PAC-merge for occupied slots?
- Windows CurrentUser-Root trust: is it truly sufficient for the Claude Desktop Electron app, or does that app bundle its own cert store / pin?
- Should the pacport (7728) be fixed or ephemeral-but-persisted?
