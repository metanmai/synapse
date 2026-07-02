# Review comments — GUI / Browser Capture design (2026-06-11)

**Reviewer:** Claude (Cowork session with Tanmai)
**Status:** Comments for follow-up; spec NOT approved as-is
**Verdict:** The engineering inside the chosen approach is solid (the adversarial review did its job), but the approach itself is under-justified. The spec never compares OS-proxy+System-CA against a browser extension, which would capture the *committed* v1 targets (claude.ai/chatgpt.com in browsers) with a fraction of the blast radius. Resolve R1 before planning.

---

## R1 (BLOCKING) — Alternative not considered: browser extension

The v1 commitment is browsers only (§Goals). For browsers, a MV3 extension (or even a content script via an existing extension framework) can observe claude.ai/chatgpt.com conversations without: OS proxy mutation, System-trusted root CA, PAC server, crash-safety machinery, per-OS routing backends, WinINET interop, or the Sequoia persistence bug. Almost the entire spec — §1–§4, §6, half of §7 — exists to compensate for choosing MITM. The one piece of work both approaches share is §5 (web wire/format parsing), which the spec itself calls the single highest-risk unknown.

Counterarguments the spec could make (and should, explicitly, if MITM is kept): extension requires per-browser install + store review or sideloading; Safari extension distribution is painful; extension can't cover the best-effort native Claude Desktop target. But "best-effort, spike-gated, may be Cloudflare-403'd anyway" is a weak anchor for the most invasive architecture in the codebase.

**Ask:** add an Alternatives section with an honest comparison, or fold "prototype a throwaway extension for claude.ai" into the §7 spike alongside item 1. If the extension can read the wire/DOM, the MITM shell may be dead weight for v1.

## R2 (HIGH) — §5 is a treadmill, not a one-time cost

claude.ai/chatgpt.com web wire formats are private, unversioned, and change without notice (unlike `/v1/messages`). Recognizers/extractors will break silently and repeatedly. The spec scopes the build cost but not the maintenance cost or a breakage-detection story ("CONNECT seen, 0 captured" in `gui status` helps, but nothing alerts; capture just quietly stops). For a solo developer this is a recurring tax against the core loop, which per CLAUDE.md is the only thing that must not degrade.

**Ask:** add (a) an explicit maintenance posture (how breakage is detected and how fast a fix ships), (b) a "capture rate dropped to zero for host X" signal surfaced beyond `gui status`.

## R3 (HIGH) — Privacy/credential capture not addressed

MITMing claude.ai/chatgpt.com means the proxy sees session cookies, auth tokens, and non-conversation traffic (account, billing, settings pages — CAPTURE_HOSTS allowlists *hosts*, not paths). §6 covers the CA key but says nothing about scrubbing captured credentials before anything hits disk or the CloudSyncer. A synced blob containing a live claude.ai session cookie is account takeover.

**Ask:** §5/§6 must specify path-level filtering (only conversation endpoints are retained; everything else discard-after-tunnel) and header/cookie redaction before persistence or upload.

## R4 (MEDIUM) — Crash-safety honest, but the worst case is still undefined

§4 correctly narrows the guarantee, but the residual hole remains: `kill -9` / power loss / OS update leaves the auto-proxy URL set with 7728 dead, and per-browser PAC-unreachable behavior is "undefined (some stall/queue)". For a default-OFF opt-in that's arguably acceptable — but the wizard copy (§1) still says "Restores to a direct connection automatically if Synapse stops", which overpromises exactly what rev H2 disproved.

**Ask:** soften the wizard copy to match §4's actual guarantee. On the open question: the separate PAC process (2b) is not worth it for v1; graceful-shutdown-clears-URL + startup reconcile + a LaunchAgent/scheduled-task "clear if daemon absent" janitor would be cheaper than a second resilient process.

## R5 (MEDIUM) — Solo-dev cost vs. value, Windows especially

Per-OS routing backends, WinINET `DefaultConnectionSettings` authoring via a PowerShell `Add-Type` shim (flagged as risk in §2), Windows CI round-trip tests, macOS manual reboot smoke per release — this is a large permanent surface for one person, for a feature that is "everything else can degrade" territory. If R1's extension route survives the spike, most of this evaporates.

## R6 (LOW) — Answers to the spec's open questions

1. Browser-first scope: yes, and **cut native Claude Desktop entirely** from this spec. It's the only reason to prefer MITM over an extension, it's spike-gated on a 403 that's outside our control, and Anthropic can re-break it any time. Re-add later as its own spec if the spike is surprisingly clean.
2. Separate PAC process: no (see R4).
3. §5 throwaway prototype first: yes — and make it a bake-off (MITM parse vs. extension capture) per R1.

## What's good (keep)

- Proxy-enforced allowlist (rev M1) — PAC-as-advisory-only is exactly right.
- Single `CAPTURE_HOSTS` constant + the anti-drift test (PAC hosts ⊆ recognized+extractable).
- Honest crash-safety wording and the lifecycle build-up/unwind-reverse symmetry invariant.
- Cutting Linux GUI and ChatGPT Desktop rather than half-claiming them.
- Blocking spike ordered by actual risk (wire format first, routing/trust second).
