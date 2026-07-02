# Synapse end-to-end happy-flow protocol

**Status:** strict — required before merging any code change to `main`.

**Owner:** core maintainer (Tanmai).

**Last enforced:** 2026-05-27.

## The rule

> **Every code change that touches `mcp/`, `backend/`, or `supabase/migrations/` must pass the end-to-end happy-flow test before merging to `main`.**

Run it. If any stage fails, **do not merge**. Fix the failure, re-run, ship green.

```bash
npm run test:e2e
```

That's the only command you need to remember. Reads ~5 minutes, costs ~$0.01-0.05 in Anthropic tokens, exercises every user-visible code path against the live backend with the live daemon.

## Why this protocol exists

Every E2E we've run in this codebase has surfaced bugs that unit tests, lint, and typecheck missed:

| Date | Bug found by E2E (not by unit tests) | Commit that fixed it |
|---|---|---|
| 2026-05-24 | Hook routing — events flow to "untitled" project | `1458319` |
| 2026-05-24 | conversations.updated_at never bumped on UPDATE | `9af719d` + migration 023 |
| 2026-05-24 | Pull-compact priority bug (subprocess vs main session) | `1458319` |
| 2026-05-24 | Concurrent message-append race (HTTP 500 for 8/10 POSTs) | `8cd8980` |
| 2026-05-24 | PreCompact didn't spawn background recompute | `20c23f9` |
| 2026-05-24 | Fast-mode timer fired before staleFallback could return | `849f3af` |
| 2026-05-27 | Fast-mode no-cache: fresh project → 10s timeout → bare brief | `8e994aa` |

None of these were caught by 437 passing unit tests. **Unit tests verify code, E2E verifies product.** Both are necessary.

## What the test exercises

Concrete stages, in order:

1. **Install** — CLI present, daemon healthy, hooks wired in `~/.claude/settings.json`.
2. **Cold cwd SessionStart** — opening Claude in a never-before-seen repo. Hook returns a bare brief (no handoff yet — correct fallback).
3. **Session capture** — `claude -p` runs, daemon syncs to backend, backend auto-routes the session to a project by `git_remote_url`.
4. **Message integrity** — every prompt the user typed lands in `conversation_messages` table verbatim.
5. **Fast-mode SessionStart** — second hook fire on the same cwd returns in <5s, hits the project-map cache.
6. **Background handoff** — `claude -p` background recompute completes, posts `handoff_markdown` to backend, captures the session content.
7. **Recall (the critical test)** — a NEW `claude -p` session opens with the brief, asks for facts only the prior session knew, and answers correctly FROM the brief.
8. **Insights roundtrip** — `save_insight` writes, `list_insights` reads back the same record.
9. **CLI commands** — `synapsesync status`, `stats`, etc. return non-error output.

If any of these fail, a real user will hit the same failure in production.

## When to run it

| Trigger | Required? | Notes |
|---|---|---|
| Before merging to `main` | **YES — hard requirement** | This is the gate. |
| Before pushing a feature branch | Recommended | Catches it locally before CI complaints. |
| After applying a migration | **YES** | Schema changes can break the message/handoff flow silently. |
| After daemon code changes | **YES** | Daemon is the most fragile part. |
| After hook code changes | **YES** | Hooks fire from Claude Code's process, easy to break. |
| Daily smoke test in CI | Recommended | Catches backend regressions from auto-deploy. |
| Random nightly run | Optional | Drift detection. |

## What it costs

- **Time:** ~3-5 minutes per run.
- **Tokens:** ~$0.01-0.05 (3 `claude -p` calls + 1 server-side compact via claude-haiku).
- **Backend side effects:** Creates and deletes a test project named `synapse-e2e-<timestamp>`. Cleanup runs even on failure.

## How to run it

```bash
# from repo root
npm run test:e2e
```

Equivalent:
```bash
node scripts/e2e-happy-flow.mjs
```

Output is per-stage with PASS/FAIL markers. Final summary block lists every stage's result and exit code is `0` only when all stages pass.

## Adding new stages

When you ship a new user-facing feature, add a stage to `scripts/e2e-happy-flow.mjs` that exercises it. The pattern:

```javascript
async function stageN_yourfeature() {
  header("STAGE N · description of what this exercises");

  // 1. Set up minimal preconditions
  // 2. Trigger the feature via the same path a real user would
  // 3. Verify the side effect (DB row, file, hook output)
  // 4. Call ok(id, detail) on success, fail(id, detail) on failure
}

// In main():
await stageN_yourfeature();
```

The bar: **a stage failure should mean a real user would hit a bad experience.** If your assertion would pass when the feature is broken in production, the assertion is wrong.

## What it doesn't test

The happy flow validates the **happy path**. Edge cases that need separate testing:

- **Multi-device propagation** — needs a second machine.
- **Trial expiration** — needs the trial code to be built.
- **Network-degraded operation** — needs traffic shaping.
- **Cross-tool capture** (Cursor, Cline, Gemini) — needs those tools installed.
- **Long-running session compaction** — needs hours of elapsed time, not easily scriptable.
- **Concurrent writes from many users** — load test, separate suite.

These are tracked separately. The happy flow is the **bare minimum** that must pass.

## When the test itself is wrong

Sometimes a stage will fail because the test's assumption is outdated, not because the product is broken. When that happens:

1. Investigate: is the product actually broken, or just the test assumption?
2. If the product is fine, update the test stage to match the new correct behavior.
3. **Never** edit `scripts/e2e-happy-flow.mjs` to silence a failing stage without understanding why it failed.

If you find yourself thinking "let me just comment out this assertion," stop and read the assertion again. The reason it was written is usually still valid.

## Enforcement

The current enforcement is **discipline-based** — the maintainer is expected to run `npm run test:e2e` before pushing to main. There is no automated block.

This is sufficient for a solo-dev project. When the team grows or external contributors arrive, harden as:

1. Add a GitHub Action that runs this on push to main (gated by `SYNAPSE_API_KEY` secret).
2. Block merges via branch protection until the action passes.
3. For PRs from external contributors, run against a staging backend.

## Quick troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `MCP dist not built` | Out of date `mcp/dist/` | `cd mcp && npm run build` |
| `No SYNAPSE_API_KEY` | Not set in env or config | `synapse init` or set env |
| `claude CLI not on PATH` | Claude Code not installed | Install Claude Code |
| Stage 5 hook timing > 5s | Fast-mode regression OR cwd-resolve regression | Check pull-compact.ts |
| Stage 6 no handoff posted | Background recompute failing OR claude -p missing | Check `~/.synapse/pull-compact-bg.log` |
| Stage 7 NOT IN BRIEF | Brief composition or fast-mode dropped the handoff | Check session-start.ts |
| Stage 8 save_insight 403 | Tier gating misfiring | Check tier.ts requirePlus call sites |
| Test hangs in stage 3 | claude -p stalled | Anthropic API issue or stale session lock |

## The bigger picture

This protocol exists because Synapse's value is "the next session always knows where the last one left off." That promise is broken if **any** of the 9 stages above fails. A user whose handoff is missing for one new session may forgive it. A user who sees it twice in a row will uninstall.

The happy flow is the contract. Treat it as such.
