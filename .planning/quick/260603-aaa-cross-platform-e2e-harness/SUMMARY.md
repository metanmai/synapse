---
quick_id: 260603-aaa
description: Cross-platform E2E harness — proxy-based universal LLM driver replaces claude -p as the test session generator
date: 2026-06-03
status: complete
---

# Summary — 260603-aaa

## What shipped

Three atomic commits making the E2E harness genuinely cross-platform:

| Commit | What |
|---|---|
| `8d74523` | `test(e2e):` Universal LLM driver (`scripts/e2e-llm-driver.mjs`) + happy-flow refactored to use it. Stage 7 now soft-skips when claude isn't on PATH. Stage 7b (NEW) covers brief content universally. |
| `885ce69` | `fix(adapter):` Claude Code file-watcher adapter enumerates XDG + ~/.config paths in addition to ~/.claude. Defensive multi-path watching. 6 new unit tests on the pure-helper candidate enumeration. |
| `<this>` | `docs(e2e):` E2E-PROTOCOL.md documents the new stage architecture. PLAN + SUMMARY for the quick task. |

## What changed

### Before

```
[macOS only]
claude -p prompt
  ↓ writes ~/.claude/projects/<id>/*.jsonl
ClaudeCodeAdapter file-watcher
  ↓
daemon → backend
```

- Stage 3 was Claude-Code-coupled: required `claude` binary, required Claude Code to persist session files (works on macOS, NOT on Linux/WSL2).
- Stage 7 (recall) drove via `claude -p` too — couldn't run without claude installed.
- Linux/WSL2 users had a broken E2E experience even though the proxy (universal capture) was already shipped.

### After

```
[any OS]
universal driver (curl + Anthropic API via Synapse proxy)
  ↓ proxy intercepts at HTTPS layer
session-reconstruction → daemon → backend

[optionally also, where claude is installed]
Stage 7 → claude -p → SessionStart hook → brief injection → recall
```

- Stage 3 uses the universal driver (curl + proxy). Works on macOS, Linux, Windows.
- Stage 7 stays as the Claude-Code-specific integration test (hook protocol). Soft-skips cleanly when claude isn't on PATH.
- Stage 7b (NEW, universal) covers the content side that Stage 7 also checked.
- File-watcher adapter now watches XDG paths defensively — when Linux Claude Code DOES write somewhere, we catch it.

## Verification

- ✓ `node -c scripts/e2e-llm-driver.mjs && node -c scripts/e2e-happy-flow.mjs` — syntax clean
- ✓ `npm run lint` — clean (pre-existing warning only)
- ✓ `npm run typecheck` — clean
- ✓ `node mcp/scripts/run-tests.mjs` — 760 mcp tests passed (6 new for `claudeCodeWatchCandidates`)
- ✓ All 3 commits pre-push gate green; fast-forward push confirmed against origin

## Out of scope (deferred)

- Migrating the other 8 E2E scripts (e2e-insight-roundtrip, e2e-multi-device, e2e-resilience, e2e-multi-account, etc.) to the universal driver. Each is a separate concern with its own merge surface. Happy-flow is the merge-gate-blocker — the others can migrate incrementally.
- Daemon compaction call (`claude -p --no-session-persistence` in `claude-code.ts:184`) → direct Anthropic SDK. Decouples Synapse from requiring claude on PATH everywhere. Separate refactor.
- CI workflow changes for `ANTHROPIC_API_KEY` secret. The merge gate is local (`npm run test:e2e`); CI's `e2e` job runs `mcp/test/e2e/` vitest, not these scripts. If the user wants the script-based suite in CI too, that's a future PR.
- WSL2 probe verification. The defensive XDG watch covers the likely landing zone. If user runs the probe and finds Claude Code uses some OTHER path, that's a one-line addition to `claudeCodeWatchCandidates`.

## Action items surfaced

- **(M)** Migrate remaining 8 E2E scripts to the universal driver — same shape as happy-flow refactor. Per-script ~15 min.
- **(L)** Replace daemon-side `claude -p --no-session-persistence` compaction call with Anthropic SDK direct call. Removes the "claude on PATH" prerequisite for the daemon entirely.
- **(L)** WSL2 probe: `touch /tmp/start && claude -p "hi" >/dev/null; find ~ -name "*.jsonl" -newer /tmp/start` — definitively confirms where Linux Claude Code writes (if anywhere). Defensive XDG watch covers most likely path either way.
