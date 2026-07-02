---
quick_id: 260602-tqy
description: Remove Claude-Code-as-canonical from every user-facing surface; ship UA classifier so data attribution is correct
date: 2026-06-02
status: complete
---

# Summary — 260602-tqy

## What shipped

Six atomic commits across four surfaces — code data attribution, frontend marketing copy, README, CLI text, technical docs:

| Commit | Surface | What |
|---|---|---|
| `68f856a` | proxy / shared types | UA classifier + drop hardcoded `"claude-code"` default in `session-reconstruction.ts` |
| `4dbb2ac` | frontend (landing + app) | Hero / HowItWorks / FAQ / FeatureCards / SetupGuide / settings / conversations — session-first copy |
| `12e15fc` | README | `## Claude Code handoff` → `## AI session handoff`, narrative tool swap (Claude Code → Cline), 3-row capture-path table |
| `4c7875e` | CLI wizard | proxy install call-out in CLI prompts |
| `b66161b` | actor attribution | `event.actor.client` hardcoded `"claude-code"` in 3 places → context-aware ("claude-code" / "synapsesync-cli" / "synapse-daemon" / "unknown") |
| `b5fe396` | ARCHITECTURE.md | "Claude Code handoff layer" → "AI session handoff layer", ASCII pipeline diagram shows 3 converging inputs |

## Framing direction (user-decided)

**Voice**: session-first, tool-agnostic. Lead with outcome (handoff / continuity / shared context), not specific tools. Tools become small "Works with" footer rows or table cells.

**Narrative** (README): Tanmai + Alex story kept; tool swap Claude Code → Cline for example variety.

## Audit categorization (50 files referencing Claude Code)

### KEEP — legitimate Claude-Code-specific code (~6 files)
- `mcp/src/capture/adapters/claude-code.ts` — the actual adapter
- `mcp/src/cli/editors/claude-code.ts` — editor handler
- `mcp/src/capture/types.ts` — tool ID in `CapturedSession["tool"]` union (extended with `"unknown"` for honest classifier fallback)
- `frontend/src/lib/components/conversations/conversation-helpers.ts` — display name map (expanded with `cline`, `copilot-cli`, `roo-code`, `unknown`)
- `mcp/src/cli/hook-dispatch.ts` — Claude Code hook protocol dispatcher (legitimately Claude-Code-specific)

### KEEP — historical planning artifacts (~16 files)
- `docs/superpowers/plans/*.md` (10), `docs/superpowers/specs/*.md` (10), `docs/drafts/*.md`, `docs/BUGS.md` — don't rewrite history.

### CHANGED — user-facing copy + code defaults

**Frontend marketing**: Hero badges now show API providers (Anthropic / OpenAI / Google) — the actual harness boundary — instead of `Claude Code, Cursor, Codex`. Tool-list enumerations replaced with universal language. FAQ "How does capture work?" rewritten to describe both paths (file-watcher + proxy). Capture-feed animation reordered (claude no longer in position 1).

**Frontend app**: settings page no longer leads with "connect Claude Code, Cursor, or other AI tools." Conversations view: source-agent badge hidden when `=== "unknown"` (the new symmetric default), not when `=== "claude-code"` (the old assumed-default).

**README**: TOC + section name `## Claude Code handoff` → `## AI session handoff`. Tanmai+Alex story keeps the arc, swaps Claude Code → Cline. New 3-row table covering Claude Code hooks, universal proxy, and file-watcher adapters as parallel capture paths instead of "Claude Code default + other tools."

**CLI**: wizard outro / prompts now mention `synapsesync capture proxy install` as the follow-up for non-Claude-Code tools. Hook-install confirm prompt: "Install Claude Code hooks for fine-grained session capture?" — explicit about scope.

**Code defaults**: `event.actor.client` was hardcoded `"claude-code"` in three places:
- `mcp/src/capture/actor.ts` resolveActor default → `"unknown"`, signature now takes `client` arg. 12 call sites updated: 6 CLI sites pass `"synapsesync-cli"`, 6 hook sites pass `"claude-code"` (accurate).
- `mcp/src/capture/daemon.ts` inline `"claude-code"` → `"synapse-daemon"` (matches the actor kind).
- `backend/src/lib/handoff-reducer.ts` rowToEvent read-path default → `"unknown"`.
- No reader of `actor.client` exists in code (grepped exhaustively) — purely metadata. Zero functional impact.

**ARCHITECTURE.md**: section header + diagram updated to show three capture paths.

## Why this matters

Before this work: every proxy-captured session was tagged `"claude-code"` regardless of source. Aider sessions, Cline sessions, even curl traffic — all attributed to Claude Code. The dashboard's per-tool filtering and counts were lying.

After: UA classifier maps the request's User-Agent header to the actual tool (claude-cli → claude-code, Cline/3.18.0 → cline, roo-cline → roo-code, etc.). Unknown UAs return `"unknown"` so dashboards surface the gap rather than silently mislabel. The marketing surface now matches: Synapse is a session capture / handoff layer that works with any AI tool, with Claude Code as one of many supported clients (the only one with a native hook protocol, but not the universal default).

## Verification

- ✓ Hero no longer leads with `Claude Code` badge (replaced with `Anthropic / OpenAI / Google` provider badges)
- ✓ README headline section: `## AI session handoff` (no longer `## Claude Code handoff`)
- ✓ Zero hardcoded `"claude-code"` fallbacks in capture / proxy / backend code paths (audit clean)
- ✓ `npm run lint` clean (pre-existing warning only)
- ✓ `npm run typecheck` clean
- ✓ `npm test` — 754 mcp passed, 0 failed (29 new UA-classifier tests added)
- ✓ All 6 commits pre-push verified
- ⏳ CI on metanmai — pending bot mirror

## Out of scope (deferred)

- Restoring proxy to wizard's main install flow (currently a manual follow-up step) — feature change, not copy.
- Adding adapters for OpenCode / Kilo / Aider — separate work; proxy already covers them.
- Surfacing per-tool source labels in the conversations view UI (data is now correct; rendering polish is follow-up).
- Historical planning docs (`docs/superpowers/plans/`, `docs/superpowers/specs/`) — don't rewrite history.
- `docs/E2E-PROTOCOL.md` Claude Code references — all legitimate (test scripts use the `claude` CLI by design).

## Action items surfaced

None new. The follow-up task (Linux `claude -p` not writing session files on WSL2) is being picked up next, separate work item.
