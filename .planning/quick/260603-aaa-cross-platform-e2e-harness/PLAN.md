---
quick_id: 260603-aaa
description: Cross-platform E2E harness — proxy-based universal LLM driver replaces claude -p as the test session generator
date: 2026-06-03
status: in-progress
---

# Quick Task 260603-aaa — Cross-Platform E2E Harness

## Problem

The E2E happy-flow (`scripts/e2e-happy-flow.mjs`) used `spawnSync("claude", ["-p", prompt])` as its session-generation driver. This:

1. Couples the E2E to Claude Code being installed.
2. Doesn't work on Linux/WSL2 (per user report: `claude -p` doesn't write session files there, so the file-watcher adapter sees nothing — even though the Anthropic API call still completes).
3. Doesn't exercise the proxy daemon — the universal capture mechanism — at all in the happy-flow.

The user pivot: *"`claude -p` is again not harness agnostic"* — replacing one Claude-Code-specific subprocess with a generic one is the right move.

## Fix shape

### Surface 1 — Universal LLM driver (NEW)

`scripts/e2e-llm-driver.mjs` exports `callAnthropicViaProxy({ prompt, ... })`. Implementation: spawn `curl` to POST `api.anthropic.com/v1/messages` with the request routed through `http://127.0.0.1:7727` (the Synapse proxy) + `--cacert ~/.synapse/proxy/ca.pem`. The proxy intercepts, session-reconstruction creates a CapturedSession, the daemon syncs to backend — same downstream pipeline as the original `claude -p` capture, just driven by a tool-agnostic HTTP client.

Why curl, not Node fetch + undici.ProxyAgent:
- curl ships natively on macOS, Linux, Windows 10+ — no Node version / undici / fetch.dispatcher quirks.
- Single subprocess replaces another (claude → curl). Test shape unchanged.

### Surface 2 — Happy-flow refactor

- **Preflight**: now checks `curl` + `ANTHROPIC_API_KEY` env + Synapse CA file + proxy enabled (auto-enables idempotently). Replaces the old `which claude` check.
- **Stage 3** (capture): swapped `claude -p prompt` → `callAnthropicViaProxy({ prompt })`. Universal.
- **Stage 7** (recall integration test): KEPT `claude -p` because it tests the Claude-Code-specific hook protocol. Soft-skips with clear messaging when claude isn't on PATH.
- **Stage 7b** (NEW, universal): hits `/api/projects/:id/brief` and asserts the returned content contains the test phrase. Runs on every OS regardless of claude availability — covers what Stage 7's content check would have asserted, without needing claude.

### Surface 3 — Defensive multi-path watching

`ClaudeCodeAdapter.watchPaths()` enumerated only `~/.claude/projects/`. With Claude Code potentially writing to XDG paths on Linux, the adapter is a no-op there. Now enumerates 3 candidates: `~/.claude/projects/`, `${XDG_CONFIG_HOME}/claude/projects/`, `~/.config/claude/projects/`. Filters to existing dirs. Falls back to legacy if none exist (diagnostic).

Pure helper `claudeCodeWatchCandidates({ home, env })` exported for testability. 6 unit tests on candidate enumeration.

### Surface 4 — Doc update

`docs/E2E-PROTOCOL.md` reflects the new stage shape: Stage 3 is universal, Stage 7 is Claude-Code-specific with soft-skip, Stage 7b is the new universal content check. Prerequisites updated to list `curl + ANTHROPIC_API_KEY + proxy CA + proxy enabled` (replacing `claude on PATH`).

## must_haves

- `scripts/e2e-llm-driver.mjs` exists with `callAnthropicViaProxy` export and clear error messages on missing prereqs.
- `scripts/e2e-happy-flow.mjs` Stage 3 uses the universal driver. Stage 7 still uses `claude -p` but soft-skips.
- `scripts/e2e-happy-flow.mjs` adds Stage 7b for universal brief content check.
- `mcp/src/capture/adapters/claude-code.ts` `watchPaths()` enumerates XDG + ~/.config in addition to ~/.claude.
- `claudeCodeWatchCandidates` is a pure helper with unit tests.
- `docs/E2E-PROTOCOL.md` documents the new stage architecture.
- Lint + typecheck + full mcp test suite green per commit.

## out_of_scope

- Migrating the other 8 E2E scripts (e2e-insight-roundtrip, e2e-multi-device, e2e-resilience, etc.) to the universal driver. Each is a separate concern; happy-flow is the merge-gate-blocker.
- CI workflow changes to add `ANTHROPIC_API_KEY` as a secret. The merge gate is local (`npm run test:e2e`); CI's `e2e` job runs vitest `mcp/test/e2e/`, not these scripts.
- WSL2 path verification — user has access; defensive multi-path watching is the no-regret fix regardless.
- Replacing the daemon's compaction `claude -p` invocation with a direct Anthropic SDK call (decouples Synapse from requiring claude on PATH). Separate refactor, out of scope.

## Commits

1. `test(e2e): universal LLM driver — happy-flow runs on Mac, Linux, Windows` — `scripts/e2e-llm-driver.mjs` (NEW) + `scripts/e2e-happy-flow.mjs` refactor (8d74523)
2. `fix(adapter): claude-code watches XDG + ~/.config paths in addition to ~/.claude` — adapter + tests (885ce69)
3. `docs(e2e): document the universal driver + Stage 7b architecture` — E2E-PROTOCOL.md + SUMMARY (this commit)
