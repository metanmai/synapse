---
slug: multi-tool-adapter-tests
quick_id: 260529-wvt
date: 2026-05-29
status: complete
---

# Multi-tool adapter E2E roundtrip — SUMMARY

## Outcome

Multi-tool adapter capture promise (FAQ: "Capture works with Claude Code, Cursor, Codex CLI, and Gemini CLI") now has end-to-end pipeline coverage. `scripts/e2e-adapter-roundtrip.mjs` validates the full chain — chokidar → registry → adapter.parse() → SessionStore → CloudSync → backend conversation row — for the 3 non-Claude adapters in ~30 seconds, exit 0 on green.

## Commits

| SHA | Message | Files |
|---|---|---|
| `70ec4e1` | `test(capture): SYNAPSE_TEST_<TOOL>_PATH overrides for adapter watchPaths` | 6 |
| `f0dab3f` | `fix(lint): biome-ignore noDelete on env-var test cleanup` | 3 |
| `bdb1cb6` | `test(e2e): adapter-roundtrip for Cursor/Codex/Gemini pipeline` | 2 |
| `8df4f0a` | `fix(lint): biome optional-chain + plain-string fixups` | 1 |

## Coverage delta

- **Before**: Cursor/Codex/Gemini adapters had `parse()` unit tests (5-6 assertions each). Pipeline correctness (file→backend) was untested for any tool other than Claude Code.
- **After**: Per-adapter `parse()` unit tests + the full pipeline E2E for all 3 advertised non-Claude tools. The FAQ-stated multi-tool capture promise now has CI-runnable validation.

## Architecture additions

1. **`SYNAPSE_TEST_<TOOL>_PATH` env-var overrides** on `Cursor/Codex/Gemini.watchPaths()` (3 adapters). Test-affordance pattern: guarded path active only when env var is set, zero impact on prod runtime.
2. **`scripts/e2e-adapter-roundtrip.mjs`** (437 LOC) — spawns capture-worker with overrides + `SYNAPSE_CAPTURE_IDLE_MS=3000` + `SYNAPSE_HOME=/tmp/synapse-home-X` isolation.
3. **`test:e2e:adapter-roundtrip` npm script** — added to `test:e2e:all` (now 10 suites).

## Bugs surfaced during development

- **Test bug**: First iteration of `freshSessionId()` put `runId` first; hex-encoding gave identical first-16 prefix across all 3 tool calls in the same run. The daemon's SessionStore (keyed by `session_id`) overwrote each session with the next one's data, and the backend received 3 copies of whichever ran last. Fixed by putting tool name first. Documented in code comments.
- **Latent product observation**: Synapse's `SessionStore` is keyed solely by `session_id`, not `(tool, session_id)`. In practice the risk is astronomically low (UUID collision across independent tools' ID spaces), but the "trust upstream IDs to be globally unique" assumption is a fragility worth tracking. Saved as Synapse action_item insight; not fixed in this slice.

## What's deferred

- **Cline / Copilot CLI / Roo Code** — no fixtures yet. Tracked by task #114. The E2E script's `FIXTURES` table can extend cleanly to all 6 adapters once their fixtures exist.
- **Backend project naming for Gemini** — gemini's adapter hardcodes `projectPath: "unknown"`, so its conversation lands under a project literally named "unknown". The E2E sweeps cursor + codex by RUN_TAG; gemini's conversation gets attached to a pre-existing "unknown" project that accumulates over time (single shared row, not 1-per-run). Not a critical issue; tracked for cleanup.
- **CI integration as the merge gate** — adapter-roundtrip is in `test:e2e:adapter-roundtrip` but NOT in `test:e2e` (which remains the happy-flow merge gate). Promotion-to-gate decision deferred until we've seen the test stable across 10+ CI runs.

## Test pass rate

- Locally: 5/5 stages green on both initial run and re-run (no flakes observed)
- Unit tests: 484 passing (was 481, +3 override assertions)
- Pre-push hook: green on all 4 commits

## Notable design choices

- **Two-layer assertion**: capture.log line scrape ("Synced session X to cloud") for *liveness*, and `/api/projects` roundtrip + sweep for *correctness*. The second layer is what caught the session-id collision bug — log lines all matched the shared prefix, but backend correctness verification revealed only one tool's data made it through.
- **SYNAPSE_HOME isolation**: test daemon's `sessions/`, `projects/`, `sync-states.json` go to a temp dir. Only `capture.log` is shared (hardcoded in `capture-worker.ts:9`), but per-run unique session IDs disambiguate ownership.
- **Cursor's `workspaceStorage` engineering**: the test creates `/tmp/<rand>/<RUN_TAG>/workspaceStorage/cursor-X/` so the cursor adapter's "parts.slice(0, wsIdx)" derivation yields a basename containing the RUN_TAG. Makes sweep-by-name trivial.
