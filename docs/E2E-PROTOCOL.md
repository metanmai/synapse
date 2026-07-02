# Synapse end-to-end happy-flow protocol

**Status:** strict — required before merging any code change to `main`.

**Owner:** core maintainer (Tanmai).

**Last enforced:** 2026-05-30.

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

**The merge-gate chain** (since 2026-05-30): `npm run test:e2e` runs FIVE scripts in sequence. Each guards a different bug class. Total ~5-8 min when `claude` is on PATH, ~5-6 min when proxy E2Es soft-skip.

| # | Script | Covers | Soft-skips when |
|---|---|---|---|
| 1 | `e2e-happy-flow.mjs` | The canonical 9-stage user flow (file-based capture path — see detail below) | Never — preflight error halts |
| 2 | `e2e-adapter-roundtrip.mjs` | 6 adapters (cursor/codex/gemini/cline/roo-code/copilot-cli): file → chokidar → adapter.parse() → CloudSync → backend conversation row | `SYNAPSE_API_KEY` missing (exit 2) |
| 3 | `e2e-proxy-layer5.mjs` | Real `claude` CLI through the TLS-MITM proxy; `/v1/messages` capture asserted | `claude` not on PATH (exit 0) |
| 4 | `e2e-proxy-source.mjs` | One layer up: ProxySource → CapturedSession emit, same shape as file-watcher | `claude` not on PATH (exit 0) |
| 5 | `e2e-proxy-lifecycle.mjs` | Layer 9 `proxy enable/disable` config + daemon restart + 3× rapid-cycle race guard against EADDRINUSE | Neither `lsof` nor `nc` available (exit 0) |

**Not yet in the merge gate:**
- Layer 8 install/status/uninstall CLI E2E (`e2e-proxy-install.mjs`). Deferred 2026-05-30 because `security add-trusted-cert -r trustRoot` triggers an MDM-protected `TrustStore.sqlite3` update prompt on the maintainer's corporate-managed Mac (see Synapse action_item: "Pick up Layer 8 install/status/uninstall E2E on non-MDM Mac"). The 14-test unit suite at `mcp/test/unit/capture/proxy/onboarding.test.ts` still covers function-level behavior.

**Platform-matrix E2E (runs in CI only):**
- `proxy-linux-e2e` (5 distros: debian / ubuntu / fedora / rockylinux / arch). Full install → status → uninstall round-trip against real `update-ca-certificates` / `update-ca-trust extract`. Runs in Docker on `ubuntu-latest`.
- `proxy-windows-e2e` (`windows-latest`). **Validates the install pipeline up to but not including the final trust-prompt step.** Asserts the daemon's PowerShell script reaches the X509Store layer (`step6:open-store` in the `[windows-debug]` trace). Does NOT assert the cert lands in the user's Root store — the Win32 trust-confirmation dialog (`CertAddCertificateContextToStore` on Root) requires an interactive desktop that GHA runners don't have, and Windows' documented registry bypasses (`HKCU\...\ProtectedRoots\Flags=1`, `HKLM\...\Flags=0x20`) don't reliably suppress the dialog on Server 2022. Final store-state validation requires manual smoke test on a real Windows desktop.

### Happy-flow detail (script 1 of 5)

Concrete stages, in order:

1. **Install** — CLI present, daemon healthy, hooks wired in `~/.claude/settings.json`.
2. **Cold cwd SessionStart** — opening a session in a never-before-seen repo. Hook returns a bare brief (no handoff yet — correct fallback).
3. **Session capture** (UNIVERSAL) — the harness-agnostic LLM driver (`scripts/e2e-llm-driver.mjs`) makes a real Anthropic API call routed through the Synapse proxy. The proxy intercepts, the daemon syncs to backend, the backend auto-routes the session to a project by `git_remote_url`. **No `claude -p` required** — works on macOS, Linux, Windows. Pre-2026-06-03 versions of this stage used `spawnSync("claude", ["-p", prompt])` which only worked on macOS because Linux/WSL2 doesn't write session files.
4. **Message integrity** — every prompt the user typed lands in `conversation_messages` table verbatim.
5. **Fast-mode SessionStart** — second hook fire on the same cwd returns in <5s, hits the project-map cache.
6. **Background handoff** — server-side recompute completes (uses `claude -p --no-session-persistence` on the daemon's machine; doesn't depend on session file persistence), posts `handoff_markdown` to backend, captures the session content.
7. **Recall integration test** (Claude-Code-specific, SOFT-SKIPS without claude) — a NEW `claude -p` session opens with the brief, asks for facts only the prior session knew, and answers correctly FROM the brief. Tests the SessionStart hook protocol → brief injection chain. Skips with clear message when claude isn't on PATH.
7b. **Brief content check** (UNIVERSAL) — `/api/projects/:id/brief` returns content containing the test phrase. Catches "brief generation broken" without needing claude in the loop. Runs on every OS regardless of claude availability.
8. **Insights roundtrip** — `save_insight` writes, `list_insights` reads back the same record.
9. **CLI commands** — `synapsesync status`, `stats`, etc. return non-error output.

If any chain script fails, a real user will hit a corresponding failure in production.

## When to run it

| Trigger | Required? | Notes |
|---|---|---|
| Before merging to `main` | **YES — hard requirement** | This is the gate. |
| Before pushing a feature branch | Recommended | Catches it locally before CI complaints. |
| After applying a migration | **YES** | Schema changes can break the message/handoff flow silently. |
| After daemon code changes | **YES** | Daemon is the most fragile part. |
| After hook code changes | **YES** | Hooks fire from Claude Code's process, easy to break. |
| After proxy-subsystem changes (`cli.ts` proxy commands, `proxy/`, `restartDaemon`) | **YES** | Layer 5/7/9 scripts catch CLI dispatch + race-guard regressions. |
| After adapter changes (`mcp/src/capture/adapters/*`) | **YES** | Adapter-roundtrip catches file → cloud pipeline regressions across all 6 tools. |
| Daily smoke test in CI | Recommended | Catches backend regressions from auto-deploy. |
| Random nightly run | Optional | Drift detection. |

## What it costs

- **Time:** ~5-8 minutes per run with `claude` on PATH; ~5-6 minutes when claude is missing (Stage 7 soft-skips, proxy Layer 5/7 scripts soft-skip).
- **Tokens:** ~$0.01-0.05 (happy-flow's 1 universal-driver Anthropic call + 1 server-side compact via claude-haiku + 1 Stage-7 `claude -p` if installed). Proxy Layer 5/7 add ~$0.005 each when they run; adapter-roundtrip + Layer 9 lifecycle use fixtures + local port assertions, $0.
- **Prerequisites:** `curl` on PATH (universal), `ANTHROPIC_API_KEY` in env (driver makes a real API call), Synapse proxy installed + enabled (`~/.synapse/proxy/ca.pem` present), Synapse API key configured. Optional: `claude` on PATH for Stage 7's integration test.
- **Backend side effects:** Creates and deletes test projects named `synapse-e2e-<timestamp>` (happy-flow) and `e2e-roundtrip-<timestamp>-{cursor,codex,copilot}` (adapter-roundtrip). Cleanup runs even on failure.
- **Local side effects:** Lifecycle E2E uses `SYNAPSE_HOME=mktemp_dir` + `SYNAPSE_PROXY_PORT=17727` — never touches the user's real `~/.synapse/` or competes with the production daemon on port 7727.

## How to run it

```bash
# from repo root
npm run test:e2e
```

Each script in the chain prints per-stage PASS/FAIL markers. Exit code is `0` only when every script's every stage passes. The chain halts on the first non-zero exit.

To run an individual segment for targeted debugging without paying for the full chain:

```bash
npm run test:e2e:adapter-roundtrip     # ~30s, no LLM tokens
npm run test:e2e:proxy-layer5          # ~30-60s, soft-skips without claude
npm run test:e2e:proxy-source          # ~30-60s, soft-skips without claude
npm run test:e2e:proxy-lifecycle       # ~30s, no LLM tokens
```

Use these for targeted debugging — `npm run test:e2e` for the merge gate.

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

The merge-gate chain validates the **happy path** across the 6 file-based adapters and the proxy lifecycle. Edge cases that need separate testing:

- **Multi-device propagation** — needs a second machine (covered by `npm run test:e2e:multi-device`, not in the gate).
- **Trial expiration** — needs the trial code to be built.
- **Network-degraded operation** — needs traffic shaping.
- **Proxy Layer 8 (CA install/status/uninstall CLI)** — deferred; requires a non-MDM Mac OR a `skipTrustSettings` knob in `onboarding.ts`. See Synapse action_item "Pick up Layer 8 install/status/uninstall E2E on non-MDM Mac."
- **Real-CLI capture through proxy on Cursor/Claude Desktop/ChatGPT Desktop** — GUI tools require keychain-trusted CA; deferred to a non-corporate machine session.
- **Long-running session compaction** — needs hours of elapsed time, not easily scriptable.
- **Concurrent writes from many users** — load test, separate suite.

These are tracked separately. The merge-gate chain is the **bare minimum** that must pass before a merge to `main`.

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
| `claude CLI not on PATH` | Claude Code not installed | Install Claude Code (proxy Layer 5/7 will soft-skip without it; not fatal) |
| Stage 5 hook timing > 5s | Fast-mode regression OR cwd-resolve regression | Check pull-compact.ts |
| Stage 6 no handoff posted | Background recompute failing OR claude -p missing | Check `~/.synapse/pull-compact-bg.log` |
| Stage 7 NOT IN BRIEF | Brief composition or fast-mode dropped the handoff | Check session-start.ts |
| Stage 8 save_insight 403 | Tier gating misfiring | Check tier.ts requirePlus call sites |
| Test hangs in stage 3 | claude -p stalled | Anthropic API issue or stale session lock |
| Stage 6 / pull-compact: `Anthropic API 400: credit balance is too low` | External provider account at backend's COMPACTION_LLM_KEY ran out of credits | Set `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` (or `OPENROUTER_BASE_URL` / `DEEPSEEK_BASE_URL`) to a local stand-in (e.g. the repo's fake-LLM helper, a docker'd mock); local-compact will route there instead of hosted. Independently, the backend operator must top up the upstream account. |
| Adapter-roundtrip `pipeline-{tool}` fail | Watcher didn't pick up the fixture OR backend POST failed silently | Check `~/.synapse/capture.log` for that run's `from {tool}` line |
| Lifecycle preflight `port 17727 in use` | Orphan daemon from a previous lifecycle run | `lsof -nP -iTCP:17727 -sTCP:LISTEN` then `kill -9 <pid>` |
| Lifecycle race-guard `EADDRINUSE` / port-never-bound | Real regression in `restartDaemon` polling | Check `cli.ts:restartDaemon` + `waitForProcessExit` — was the timeout shortened? |
| Proxy Layer 5/7 skipped on this run | `claude` not on PATH (expected) | Install Claude Code if proxy-subsystem coverage matters for the changeset |

## The bigger picture

This protocol exists because Synapse's value is "the next session always knows where the last one left off." That promise is broken if **any** of the 9 stages above fails. A user whose handoff is missing for one new session may forgive it. A user who sees it twice in a row will uninstall.

The happy flow is the contract. Treat it as such.
