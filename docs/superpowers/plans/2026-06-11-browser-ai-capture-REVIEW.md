# Review comments — Browser AI-Session Capture plan (2026-06-11)

**Reviewer:** Claude (Cowork session with Tanmai)
**Status:** Comments for follow-up; plan is close but has one logic flaw and one stale-copy bug that must be fixed before execution.
**Verdict:** Structure is right — blocking gate honored, TDD where the architecture is settled, method-dependent work deferred instead of speculated. But P1 below means the R2 breakage signal *cannot fire in the most likely failure mode*, and P2 ships wizard copy the spec explicitly retired.

---

## P1 (BLOCKING) — Task 14's zero-capture signal can't detect a broken adapter

`CaptureRateTracker.staleHosts()` flags hosts with **≥1 attempt and 0 captures**. Under the MITM design that worked: a CONNECT was the "attempt" even when parsing failed. Under the extension architecture there is no equivalent — if the claude.ai adapter breaks (the *expected* failure: UI/wire change), the extension emits **nothing**, the daemon records **zero attempts**, and `staleHosts` stays empty forever. The signal only fires if ingest receives malformed-but-present events, which is the unlikely failure mode.

**Fix:** the extension must send a lightweight **heartbeat/page-visit ping** ("tab active on claude.ai") independent of successful extraction — that becomes the `didCapture:false` attempt record. Add it to the Task 12 service-worker scope and the Task 14 test ("active tab + zero turns over window ⇒ stale"). Without this, R2 is satisfied on paper only.

## P2 (BLOCKING, trivial fix) — Task 15 wizard copy is the retired MITM copy

Step 1 quotes "…restores to a direct connection automatically if Synapse stops — wording per R4." That sentence is (a) exactly what R4 said to *remove*, and (b) meaningless in the extension architecture — there is no proxy and nothing to restore. Replace with extension-appropriate copy: what's captured (conversations on the two hosts only), where it goes (your Synapse, via the local daemon), and what happens when the daemon is down (see P4).

## P3 (HIGH) — Redaction is a key-name blocklist; the ingest contract should be an allowlist

Task 7's `REDACT_KEY` regex strips fields *named* like credentials. Two problems: (1) token-shaped **values** in innocuously-named fields survive (claude.ai web payloads embed IDs/session material in nested values the regex never inspects); (2) the Task 8 test fixture shows the extension sending `headers: { cookie: ... }` at all — per spec §Privacy the content script "does not read cookies," so headers shouldn't exist in the payload to begin with.

**Fix:** make the ingest route **schema-allowlist** the body — accept only `{ host ∈ CAPTURE_HOSTS, messages: [{role, content, ts}] }`, drop every other key, then run the redaction pass over `content` strings as defense-in-depth (value-pattern scrub for `sk-`, `Bearer `, cookie-shaped strings). Keep the Task 7 test but invert the primary mechanism: unknown keys never survive, rather than known-bad keys getting masked.

## P4 (HIGH) — MV3 service-worker lifecycle is unaddressed in Task 12

MV3 service workers are evicted after ~30s idle. "Batch / dedupe / back-off" held in worker memory loses turns on every eviction, and dedupe state resets — you'll get both data loss *and* duplicate sessions. Also unspecified: behavior when the daemon is down (buffer where? for how long? or accept loss?).

**Fix:** Task 12 must specify `chrome.storage.session` (or `.local` with a size cap) as the buffer + dedupe-hash store, flush-on-wake, and an explicit "daemon unreachable ⇒ buffer up to N, then drop oldest, surface in extension badge" policy. This needs deciding pre-gate; it's architecture-independent.

## P5 (MEDIUM) — Resolve the loopback shared-secret question now: yes, require it

The plan defers this as an open question, defaulting to loopback-only. Loopback binding does not stop (a) other local processes, or (b) webpages POSTing to `127.0.0.1` from the browser (Chrome's Private Network Access mitigates but isn't universal, and Firefox differs). The plan itself notes the fix is "one extra header check + a token in the extension config" — at that price, just do it. Generate the token at wizard-enable, store it in `proxy-config.json` + extension options; ingest rejects requests without it. Also reject any request bearing a web `Origin` header that isn't the extension's.

## P6 (LOW) — Smaller items

- **Task 8 `tool` derivation** — `host.replace(/\..*/, "") === "claude" ? ...` is a string hack; derive from a `CAPTURE_HOSTS`-keyed map in `packages/shared` so adding a host can't silently mis-tag.
- **Spike Task 2** — MV3 supports `"world": "MAIN"` in `content_scripts` (Chrome 111+), which eliminates `inject.js`, the `postMessage` relay, *and* the document_start race where the page's first fetch beats the async script injection. Use it in the spike; it likely simplifies Phase 4 too.
- **Spike URL filter** `/\/(api|chat|conversation|messages|completion)/i` may miss claude.ai's actual endpoints — during the probe, also log *all* same-origin fetch URLs (no bodies) so the filter can be corrected live rather than concluding a false negative.
- **Task 16 smoke** — add "daemon stopped mid-conversation, restarted ⇒ buffered turns arrive" once P4's buffering exists.

## What's good (keep)

- Phase 1 as a true gate with a RETHINK exit, throwaway code deleted, FINDINGS.md kept as the decision record.
- Refusing to write speculative adapter internals pre-gate, while fixing the `CaptureAdapter` interface so Phases 2–3 can proceed — right call.
- TDD steps with explicit fail-first verification; injected `sync` so tests touch no network.
- Probe C as a paper analysis instead of building MITM infrastructure for a comparison.
- Anti-drift test chain (manifest `matches` ⊆ CAPTURE_HOSTS ⊆ adapter coverage).
