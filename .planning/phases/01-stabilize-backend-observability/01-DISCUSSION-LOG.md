# Phase 1: Stabilize Backend & Observability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 01-stabilize-backend-observability (slice 1a — wrangler-free subset)
**Areas discussed:** Wrangler-availability routing, BUG-04 init UX, Sentry code timing, Daemon backoff scope

---

## Wrangler-availability routing (preliminary)

User indicated they cannot use wrangler on this device. Clarification revealed two overlapping reasons: (1) Netskope corporate proxy blocks wrangler's egress to the Cloudflare API; (2) intentional separation — CF-bound work happens on a different machine, this one is for non-CF surfaces.

| Option | Description | Selected |
|--------|-------------|----------|
| Carve Phase 1 down to install bugs (BUG-02/03/04) | Wrangler-free subset of current phase. Closes 3 of 6 REQs. ~half day. | ✓ |
| Skip ahead to Phase 4 (Cross-User Collab) | Frontend-heavy; backend invite endpoint already exists. | |
| Skip ahead to Phase 6 partial (waitlist signup UI) | Frontend signup form; backend deferred. | |
| Something else | Open-ended. | |

**User's choice:** "Complete this phase partially, wherever there isn't a wrangler requirement."
**Notes:** Confirmed the carve. Phase 1 split into slice 1a (this slice, wrangler-free) and slice 1b (CF machine, wrangler-bound). Saved as project memory `project_split_machine_wrangler.md`.

---

## BUG-04 `.mcp.json` write UX

| Option | Description | Selected |
|--------|-------------|----------|
| Always write `.mcp.json` to cwd | Simplest. Risks overwriting hand-tuned configs on re-run. | |
| Always write, merge if `.mcp.json` exists | Parse existing, update only `synapse` entry, preserve other servers. ~20 LOC + test. | ✓ |
| Add `--scope local\|global` flag | Explicit control; more CLI surface. | |

**User's choice:** Always write, merge if exists.
**Notes:** Preserves Cursor / Windsurf / user-added server entries on re-run. JSON-merge logic centralized; merge target key is `synapse`.

---

## Sentry code timing (OBS-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Include — author code now, defer deploy | SDK init, Hono wiring, `wrangler.jsonc` binding land here; deploy + SC#4 verify on CF machine. | ✓ |
| Defer entirely | Keep slice 1a purely MCP/CLI; author Sentry on CF machine. | |
| Include partial (binding + stub only) | Pre-wires Prereq #4 without full SDK integration. | |

**User's choice:** Include — author the code now.
**Notes:** OBS-01 has a clean write/verify split. Code is pure TypeScript + JSONC edits. Mark OBS-01 as `code-complete, deploy-pending` after slice 1a. Avoids fresh context-load on the CF machine — that session is reduced to `wrangler deploy` + verification.

---

## Daemon flush backoff (BUGS.md #12)

| Option | Description | Selected |
|--------|-------------|----------|
| Include — colocated edit, real dogfood pain | Exponential backoff 10s→20s→40s→cap ~5min, reset on success. Same file as BUG-02. ~half day. | ✓ |
| Defer — strict scope | Honor out-of-scope guardrail; #12 is P3, not in REQ list. | |
| Cap log size only | Rotate `~/.synapse/daemon.log` without behavior change. ~10 LOC. | |

**User's choice:** Include.
**Notes:** Pulled into slice 1a because (1) it edits the same file as BUG-02 — single review pass on `mcp/src/capture/daemon.ts`, (2) the 1101 storm is currently producing ~6 log lines/min and worsens dogfood UX, (3) avoids burst-flush at recovery when slice 1b lands. Backoff state lives in the loop wrapper at `startHandoffLoop`, not per-cycle.

---

## Claude's Discretion

- Test coverage approach for slice 1a — standard unit tests per fix. Do NOT touch `.skip`'d backend integration tests (BUGS.md #5a) — that's slice 1b territory and currently P2.
- File organization for new helpers (proxy probe, MCP-command resolver, JSON merger) — planner's call; suggest `mcp/src/cli/util/`.
- Source-map upload wiring — defer to slice 1b unless cheap to pre-wire.
- `beforeSend` scrubbing exact field whitelist — open at planning time; CONTEXT.md proposes keeping `event_id`, `project_id`, `kind`, `actor_user_id`, stripping `payload`.

## Deferred Ideas

### Slice 1b (CF-machine, wrangler-bound)
- BUG-01 1101 root-cause via `wrangler tail` + fix
- OBS-01 deploy + SC#4 verification
- OPS-01 Workers Paid tier verification
- Source-map upload via wrangler (if not pre-wired in 1a)
- Closing BUGS.md #5a (handler integration tests) — revisit only if test gap blocks 1b confidence
- BUG-03 verification on live Netskope-restricted network

### Other phases / out of milestone
- Linux daemon path verification — Phase 2 if Linux machine accessed; else launch with documented gap
- Daemon log rotation/size-cap — only if backoff alone proves insufficient post-dogfood
- BUGS.md #5a integration test refactor — P2 follow-up
