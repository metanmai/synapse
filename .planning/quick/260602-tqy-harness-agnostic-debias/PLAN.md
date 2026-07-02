---
quick_id: 260602-tqy
description: Remove Claude-Code-as-canonical from every user-facing surface; ship UA classifier so data attribution is correct
date: 2026-06-02
status: in-progress
---

# Quick Task 260602-tqy — Harness-Agnostic Debias

## Problem

Synapse was built Claude-Code-first because Claude Code was the only tool with a hook protocol when capture shipped. The proxy daemon (Layers 1-9, shipped 2026-05-30) makes Synapse universal — any tool talking to `api.anthropic.com`, `api.openai.com`, or `generativelanguage.googleapis.com` is captured without code changes — but the product surface still presents Claude Code as primary/canonical:

- **Hero badges** lead with Claude Code (first of 3 visible tools)
- **Marketing copy** anchors on `"Claude Code, Cursor, Codex, and Gemini"` (Claude Code always first)
- **README** opens with a `## Claude Code handoff` section as the headline user story
- **Hardcoded default** in `mcp/src/capture/proxy/session-reconstruction.ts:69`:
  ```ts
  const tool = opts.tool ?? "claude-code";
  ```
  Every proxy-captured session is currently labeled `"claude-code"` regardless of the actual source tool.

## Framing direction (user-decided)

**Voice**: session-first, tool-agnostic. Lead with the outcome (handoff / continuity / shared context), not specific tools. Tools become a small "Works with" footer.

**Narrative** (README): Keep the Tanmai+Alex story arc; swap the tool name `Claude Code` → `Cline` for example variety. The story is about handoff, the tool is illustrative.

## Audit (50 files referencing Claude Code)

### KEEP — legitimate Claude-Code-specific code

| File | Why |
|---|---|
| `mcp/src/capture/adapters/claude-code.ts` | The actual adapter for the actual tool |
| `mcp/src/cli/editors/claude-code.ts` | Claude Code editor handler |
| `mcp/src/capture/types.ts` | Type union `"claude-code" \| "cline" \| ...` — a tool ID, not a brand statement |
| `frontend/src/lib/components/conversations/conversation-helpers.ts` (display map line) | `"claude-code": "Claude Code"` is the canonical display name for that one tool |
| `frontend/src/lib/components/conversations/conversation-helpers.test.ts` | Tests the above |
| `mcp/src/cli/hook-dispatch.ts` | Claude Code hooks are a Claude-Code-specific protocol — file comments stay accurate |

### KEEP — historical planning artifacts (don't rewrite history)

- `docs/BUGS.md`
- `docs/superpowers/plans/*.md` (10 files — historical plans)
- `docs/superpowers/specs/*.md` (10 files — historical specs)
- `docs/drafts/blog-launch-post.md`, `docs/drafts/launch-assets.md` (drafts, not shipped)

### CHANGE — UI / marketing copy

| File | Change shape |
|---|---|
| `frontend/src/lib/components/landing/Hero.svelte` | Headline + subhead session-first; replace 3-badge row with API-provider badges (Anthropic/OpenAI/Google) OR move "Works with" tool list to small footer band |
| `frontend/src/lib/components/landing/HowItWorks.svelte` | Step 1 description: drop "Claude Code, Cursor, Codex, and Gemini" enumeration → "your AI coding sessions"; capture-feed animation: reorder tools so claude isn't first |
| `frontend/src/lib/components/landing/Faq.svelte` | Replace canonical anchor examples; rephrase FAQ answers to lead with universality |
| `frontend/src/lib/components/landing/FeatureCards.svelte` | "watches Claude Code, Cursor, Codex, and Gemini" → "watches your AI coding sessions" |
| `frontend/src/lib/components/landing/SetupGuide.svelte` | "Works with Claude Code, Cursor, VS Code..." → tool-agnostic |
| `frontend/src/routes/(app)/settings/+page.svelte` | "connect Claude Code, Cursor, or other AI tools" → "connect your AI tools" |
| `frontend/src/routes/(app)/home/+page.svelte` | Audit + edit |
| `frontend/src/routes/(app)/projects/[name]/conversations/[id]/+page.svelte` | Audit + edit |

### CHANGE — README

- `README.md` headline `## Claude Code handoff` → `## AI session handoff`
- Narrative: `Tanmai pairs with Claude Code` → `Tanmai pairs with Cline`
- Section `### Setup (Claude Code, recommended)` → `### Setup (recommended)` with tool-agnostic prose (the actual setup IS Claude-Code-flavored because of the hooks protocol — so keep the technical accuracy of "writes hook entries into ~/.claude/settings.json" but soften the headline)
- TOC entry `[Claude Code handoff](#claude-code-handoff)` → `[AI session handoff](#ai-session-handoff)`
- Subsection `### Other tools: Cursor, Codex, Gemini, VS Code, Windsurf` — keep but reframe so it's not "other than Claude Code" but rather "tools captured via file-watcher" vs "tools captured via proxy"

### CHANGE — CLI/wizard text

| File | Audit needed |
|---|---|
| `mcp/src/cli/wizard.ts` | Setup prompts that lead with Claude Code |
| `mcp/src/cli/init.ts` | Same |
| `mcp/src/cli/smoke.ts` | Status + onboarding output |
| `mcp/src/cli/commands.ts` | Help text + error messages |
| `mcp/src/cli/editors/detect.ts` | Editor detection prompts |

### CHANGE — code defaults (data-attribution)

| File | Change |
|---|---|
| `mcp/src/capture/proxy/session-reconstruction.ts:69` | Replace `opts.tool ?? "claude-code"` with `classifyUserAgent(req.userAgent)` |
| `mcp/src/capture/proxy/proxy-source.ts` | Audit for hardcoded defaults |
| `mcp/src/capture/proxy/user-agent-classify.ts` | **NEW**: pure classifier function |
| `mcp/src/capture/default-registry.ts` | Audit |
| Other `mcp/src/capture/*.ts` | Audit |
| `backend/src/lib/handoff-reducer.ts` | Audit for `"claude-code"` defaults in brief generation |

### SURGICAL — technical docs

- `docs/ARCHITECTURE.md` — keep technical-accurate references; change copy-style framing
- `docs/E2E-PROTOCOL.md` — keep (Claude Code hooks ARE the protocol being tested)

## Commits

1. `refactor(proxy): UA-classify for session attribution + drop hardcoded "claude-code" default`
2. `refactor(frontend/landing): session-first framing, no tool primacy in marketing copy`
3. `refactor(frontend/app): debias settings + audit app routes`
4. `docs(readme): session-first framing — "Claude Code handoff" → "AI session handoff"`
5. `refactor(cli): debias wizard/init/smoke/commands text — tool-agnostic prompts`
6. `refactor(capture): audit + remove hardcoded "claude-code" defaults in capture/* and backend/handoff-reducer`
7. SUMMARY.md

## must_haves

- `mcp/src/capture/proxy/user-agent-classify.ts` new file with positive + negative tests
- Zero hardcoded `"claude-code"` fallbacks for tool attribution (the literal string only appears as a member of a tool-name set or as the legitimate display label)
- `npm run lint` + `npm run typecheck` + `npm test` green per commit
- Pre-push hook passes on every commit
- Hero no longer leads with Claude Code badge
- README headline section is no longer `## Claude Code handoff`

## out_of_scope

- Rewriting historical planning docs (`docs/superpowers/plans/`, `docs/superpowers/specs/`)
- Changing the tool ID strings in `CapturedSession["tool"]` type union
- Renaming `claude-code.ts` files
- Frontend visual redesign beyond copy + badge swaps
- Adding new tool adapters (separate work)
