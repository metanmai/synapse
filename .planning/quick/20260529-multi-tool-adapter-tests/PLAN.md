---
slug: multi-tool-adapter-tests
quick_id: 260529-wvt
date: 2026-05-29
status: in-progress
---

# Multi-tool adapter E2E roundtrip test

## Goal

Validate the FAQ promise — "Capture works with Claude Code, Cursor, Codex CLI, and Gemini CLI" — end-to-end. Existing unit tests at `mcp/test/unit/capture/{cursor,codex,gemini}.test.ts` prove **parse-correctness**. They do NOT prove **pipeline-correctness**: that a transcript file landing in the watched directory makes it through the watcher → adapter → daemon → backend chain. The merge-gate `e2e-happy-flow.mjs` covers this chain for Claude Code only (via `claude -p`); the other 3 advertised tools have no end-to-end proof.

## Approach

Single-file E2E (`scripts/e2e-adapter-roundtrip.mjs`) that, for each adapter, drops its fixture into a temp watch directory and asserts the daemon picks it up and ships it to the backend. Mirrors the happy-flow pattern (live backend, live daemon, no mocks).

The adapter `watchPaths()` methods currently hardcode OS-specific paths (`~/Library/.../Cursor`, `~/.codex/sessions`, `~/.gemini/tmp`). To make them testable without polluting real user directories, add an env-var override:

```typescript
watchPaths(): string[] {
  const override = process.env.SYNAPSE_TEST_<TOOL>_PATH;
  if (override) return [override];
  return [/* original hardcoded path */];
}
```

This is the standard test-affordance pattern — guarded path that's only active when env var is set, zero impact on prod runtime.

## Scope

In:
- Add `SYNAPSE_TEST_CURSOR_PATH`, `SYNAPSE_TEST_CODEX_PATH`, `SYNAPSE_TEST_GEMINI_PATH` overrides
- New unit-test assertion per adapter that override is honored
- `scripts/e2e-adapter-roundtrip.mjs` exercising the 3 adapters with existing fixtures
- `test:e2e:adapter-roundtrip` npm script
- Cleanup logic: kill daemon, remove temp dirs, sweep backend projects/events

Out:
- Cline / Copilot CLI / Roo Code (no fixtures yet — Task #114)
- Claude Code (already covered by happy-flow)
- Changes to watcher / daemon / registry internals
- New fixtures or fixture acquisition

## Tasks (atomic commits)

1. **Adapter env overrides + unit-test assertions** — touch cursor.ts, codex.ts, gemini.ts (+1 test each). Commit + push.
2. **`scripts/e2e-adapter-roundtrip.mjs` + npm script** — write the E2E, wire into package.json. Commit + push.
3. **Local run + verify green** — run against live backend, fix any flakes, confirm clean.

## Risks

- **Daemon needs to be running** with overrides exposed via env. The launchctl-managed daemon won't have them. The E2E will need to spawn a fresh daemon process inline (matching how happy-flow does it for some stages).
- **Cleanup must be tight** — temp watch dirs, backend projects, daemon process must all clear even on failure.
- **Pre-existing chokidar idle behavior** — the watcher dedups by mtime+size and emits via idle detection. Need to confirm the file change triggers an event in <30s.

## Definition of done

- E2E script exits 0 on a clean run
- Backend has 3 events (one per adapter) tagged with source_tool, then they're cleaned up
- Pre-push hook passes (lint + typecheck + 481+ tests)
- CI on metanmai is green on the merged commit
