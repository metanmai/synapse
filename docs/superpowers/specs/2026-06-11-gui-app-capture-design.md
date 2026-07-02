# Design — Browser AI-Session Capture (claude.ai, chatgpt.com)

**Date:** 2026-06-11
**Status:** Draft for review (revised twice — adversarial Opus review, then a scope/approach review)
**Author:** brainstorming session (Tanmai + Claude), hardened by two reviews

## Problem

Synapse captures AI sessions via a file-watcher (tool session-JSONL on disk) and a TLS-MITM proxy (CLI tools honoring `HTTPS_PROXY`). Neither captures **browser AI usage** — sessions on `claude.ai` / `chatgpt.com`. This is the largest uncaptured surface for users who do AI work in a browser rather than a CLI/IDE.

This spec designs an **opt-in, default-OFF** way to capture browser AI sessions. After two reviews, the recommended approach is a **browser extension**, not the OS-proxy + System-CA MITM the first draft assumed (see Alternatives — the MITM shell is mostly dead weight for a browser-only target).

## Review changelog

**Round 1 (adversarial Opus review)** forced a rescope: native ChatGPT Desktop pins certs (uncapturable), native Claude Desktop is Cloudflare-403'd through a macOS proxy, `claude.ai`/`chatgpt.com` aren't recognized by the existing parser, the proxy MITMs any host (no allowlist), Windows routing needs WinINET `DefaultConnectionSettings`, PAC `;DIRECT` isn't transparent and dies when the daemon does, Linux trust is sudo-only. Target narrowed to **browsers**.

**Round 2 (scope/approach review)** found the bigger problem — the first revision never compared MITM against a **browser extension**, which captures the committed browser targets with a fraction of the blast radius. Resolved here:
- **R1**: Extension is now the recommended v1 approach; MITM kept only as a documented alternative + future native-app path. Spike is a **bake-off**.
- **R2**: Added a maintenance posture + zero-capture alerting (web wire/DOM formats are private, unversioned, break silently).
- **R3**: Added a Privacy/credential section — capture must be path/conversation-scoped with cookie/token redaction before anything hits disk or sync.
- **R4**: Wizard copy softened; MITM crash-safety uses a janitor, not a separate PAC process.
- **R6.1**: Native Claude Desktop **cut entirely** from this spec (re-add later as its own spec if a future spike is clean).

## Goals & Non-Goals

**v1 "done":**
- Capture conversations on `claude.ai` and `chatgpt.com` from the browser, opt-in, default OFF.
- Captured sessions flow into the same backend pipeline as file-watcher / proxy sources.
- **Chrome + Edge** (Chromium MV3) committed. **Firefox** if cheap (WebExtension parity). **Safari** best-effort (needs an app wrapper — see Alternatives).
- Conversation data only — never persist or sync credentials (R3).

**Non-Goals:**
- Native Claude Desktop app (cut, R6.1) and native ChatGPT Desktop (pins certs). Both re-addressable later as separate specs.
- File-captured IDEs (Cursor/Windsurf) — file-watcher stays primary.
- Defeating pinning/HSTS, PAC-merging, per-app network extensions.
- Linux GUI capture (deferred).

## Alternatives (R1 — the decision this spec turns on)

| Dimension | **A. Browser extension** (recommended) | **B. OS-proxy + System-CA MITM** (deferred) |
|---|---|---|
| Captures browser claude.ai/chatgpt.com | ✅ directly | ✅ if wire format parses |
| OS proxy mutation | ❌ none | ✅ required (per-OS, Sequoia persistence bug) |
| System-trusted root CA | ❌ none | ✅ required (admin on macOS) |
| PAC server + crash-safety machinery | ❌ none | ✅ required (and imperfect) |
| Per-OS routing backends / WinINET interop | ❌ none | ✅ required (large solo-dev surface) |
| Credential exposure | small (page-scoped; see R3) | large (sees all cookies/tokens for the host) |
| Can also capture native desktop apps | ❌ no | ✅ (but those targets are cut/uncapturable) |
| Install friction | per-browser: store review or dev-mode sideload; Safari painful | one-time wizard + admin prompt |
| Shared hard part | web wire/DOM parsing (R2 treadmill) | same web wire parsing (§Shared) |

**Verdict:** for a browser-only v1, the extension delivers the committed targets while eliminating ~80% of the MITM spec (its entire reason to exist was native-app capture, which is cut). The only honest argument for MITM — native desktop apps — is gone. **Recommend Approach A.** Approach B is preserved in an appendix as the future path *if* native-app capture is ever revived and *if* those apps stop pinning.

The single shared unknown — can we actually read a claude.ai/chatgpt.com conversation? — is settled by a **bake-off spike** (below) before committing real build effort.

## Architecture (Approach A — browser extension)

```
  ┌─ claude.ai / chatgpt.com tab ──────────────────────────┐
  │  content script (MV3)                                   │
  │   • observes the conversation (fetch/XHR hook OR DOM)   │
  │   • extracts {role, content, ts} — conversation only    │
  │   • redacts: never reads cookies/auth/storage (R3)      │
  └───────────────┬─────────────────────────────────────────┘
                  │ chrome.runtime → service worker
                  ▼
        ┌──────────────────────┐   POST localhost:<port>/capture
        │ extension service     │──────────────┐  (Synapse daemon,
        │ worker (batches,       │              ▼   loopback only)
        │ dedupes, backs off)    │      ┌────────────────────┐
        └──────────────────────┘       │ daemon ingest route │─▶ store.save + CloudSyncer
                                        │ (existing sync path)│   (same as file/proxy)
                                        └────────────────────┘
```

| Component | Job | Location |
|---|---|---|
| **Content script** | Per-host capture of conversation data on claude.ai/chatgpt.com; no credential access | `extension/src/content/` (new workspace) |
| **Service worker** | Batch/dedupe/back-off; POST to the daemon's loopback ingest | `extension/src/worker/` |
| **Daemon ingest route** | Accept loopback POSTs, normalize to `CapturedSession`, hand to existing `store.save + syncer.sync` | extends the daemon (capture-worker) |
| **CAPTURE_HOSTS constant** | Shared host list (extension manifest `matches` + daemon validation); the anti-drift source of truth | `packages/shared` (new) |
| **Wizard step** | Opt-in; links to the unlisted extension / dev-mode install instructions; verifies the daemon ingest route is reachable | `mcp/src/cli/wizard.ts` |

**Capture sub-approach** is the spike's job to settle: (a) **fetch/XHR hook** in page context — sees the real conversation payloads the web app exchanges (closest to ground truth, but private wire format, R2); (b) **DOM/MutationObserver** — reads rendered messages (survives wire changes, breaks on UI changes, can't see tokens/tool-calls). The bake-off measures both for reliability + effort.

**Transport:** content → service worker → `POST http://127.0.0.1:<port>/capture` on the daemon (loopback only, never remote). Reuses the daemon's existing auth + `CloudSyncer.sync()` path, so backend, dedupe, and tiering are unchanged. No API key in the extension.

## §Shared — web-session parsing & maintenance (R2)

The wire/DOM formats of claude.ai/chatgpt.com are private, unversioned, and change without notice — unlike the stable `/v1/messages` API. This is a **recurring maintenance tax**, not a one-time build, and per CLAUDE.md the core loop must not silently degrade. Posture:

- **Breakage detection (active, not passive):** the daemon tracks per-host capture rate. A **drop to zero captures for host X over a rolling window while the user is active** raises a surfaced signal — a `doctor --smoke` failure line AND a one-line daemon-log warning AND an optional brief annotation, not just a quiet `gui status` field. The user (or a future alert) learns capture broke within a session, not weeks later.
- **Fix-fast structure:** parsing lives behind a single per-host adapter (`extension/src/content/adapters/{claude-ai,chatgpt}.ts`) with golden-fixture tests, so a format change is a localized, test-covered patch — the same adapter pattern the file-watcher already uses for 7 tools.
- **Honest expectation in docs:** browser capture is "best-effort, may need periodic adapter updates," stated in the wizard outro and README. It is explicitly *not* part of the must-not-degrade core loop.

## §Privacy — credential & path scoping (R3)

Capturing browser AI traffic means proximity to session cookies and auth tokens. A synced blob with a live `claude.ai` session cookie is account takeover. Rules:

- **Conversation-only extraction.** The content script reads only conversation message data — it does **not** read `document.cookie`, `localStorage` auth tokens, or non-conversation network traffic. (This is a structural advantage of Approach A: an extension scoped to conversation DOM/fetch never touches the credential surface that a host-level MITM unavoidably sees.)
- **Path/endpoint scoping.** Only the conversation endpoints/DOM are captured; account/billing/settings pages are never read. (For the deferred MITM Approach B, this becomes path-level allowlisting on top of host-level, plus header/cookie redaction before persistence — noted in the appendix.)
- **Redaction before persistence.** Any captured payload is scrubbed of `authorization`/`cookie`/`set-cookie`/token-shaped fields before it touches disk or the CloudSyncer — a redaction pass in the daemon ingest route, with a unit test asserting known credential shapes never survive.

## Spike — bake-off (BLOCKING, do first)

A throwaway prototype, before any production build, answering one question: **can we reliably read a claude.ai (and chatgpt.com) conversation, and by which method?**

1. **Extension fetch-hook**: minimal MV3 content script, hook `fetch`/XHR on claude.ai, log the conversation payloads. Parseable? Stable across a few sessions?
2. **Extension DOM**: MutationObserver on the rendered transcript. Complete? Robust to a UI reflow?
3. **(Reference) MITM parse**: route claude.ai through 7727 with a System-trusted CA, see if the same payloads arrive — purely to compare effort/reliability against the extension, per R1/R6.3.

Decision gate: if an extension method (1 or 2) reliably captures, **commit to Approach A and shelve the MITM appendix.** If neither extension method works but MITM-parse does, reconsider B. If nothing parses, the feature needs a rethink before planning continues.

## Testing

- **Unit (CI):** per-host adapter golden-fixture tests (claude-ai, chatgpt); CAPTURE_HOSTS anti-drift (manifest `matches` ⊆ adapter-covered hosts); daemon ingest route normalization; **credential-redaction test** (known cookie/token shapes never persist — R3); zero-capture-rate signal fires on a simulated drought (R2).
- **Integration:** extension loaded headless (Playwright + persistent context) against a fixture page mimicking the claude.ai transcript shape → asserts a `CapturedSession` reaches the daemon ingest route.
- **Manual smoke per release:** real claude.ai + chatgpt.com session in Chrome with the extension → confirm capture + redaction; documented in E2E-PROTOCOL.md.

## Appendix B — MITM approach (deferred; for future native-app capture only)

Preserved from the round-1 revision for the day native-app capture is revived (and those apps stop pinning). Summary of what it would require, *none of which Approach A needs*: a per-OS RoutingManager (macOS `networksetup -setautoproxyurl`; Windows WinINET `DefaultConnectionSettings` via `InternetSetOption` — **not** a raw `AutoConfigURL` write), a PAC server on 7728 with a `;DIRECT` host-allowlist, **proxy-side allowlist enforcement** in `handleConnect` (the round-1 M1 fix — PAC is advisory only), System-keychain CA trust (admin on macOS), and crash-safety via graceful-shutdown-clears-URL + startup reconcile + a **LaunchAgent/scheduled-task janitor that clears the auto-proxy URL if the daemon is absent** (R4 — cheaper than a separate PAC process). Wizard copy for either approach must say "restores to a direct connection automatically" only as far as §4's actual guarantee allows — i.e. *not* "if Synapse stops" (R4). This appendix is not v1 scope.

## Open questions for review

- Extension distribution: unlisted Chrome Web Store item, or dev-mode sideload with a one-line installer? (Store review adds latency but removes the "enable developer mode" friction.)
- Is Safari worth a v1 app-wrapper, or explicitly Chromium+Firefox only for v1?
- Should the daemon ingest route require a loopback shared-secret (defense against other localhost processes POSTing fake sessions), or is loopback-only binding enough?
