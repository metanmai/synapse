# Capture Adapters Expansion — 7-Tool Coverage

**Date:** 2026-04-05
**Status:** Approved
**Goal:** Add 3 new capture adapters (Cline, Roo Code, Copilot CLI) to go from 4 to 7 supported AI tools.

## Context

SessionFS (a direct competitor) supports 8 AI tools. Synapse currently captures from 4: Claude Code, Cursor, Codex CLI, and Gemini CLI. This spec closes the biggest visible gap by adding Cline, Roo Code, and Copilot CLI adapters, all following the existing `ToolAdapter` interface.

Amp (Sourcegraph) was evaluated and deferred — its local storage format is undocumented and cloud-primary. We ship 7 solid adapters rather than 8 with one unreliable.

## Architecture

No structural changes. The existing adapter pattern is fully extensible:

```
ToolAdapter interface
├── tool: string
├── watchPaths(): string[]
└── parse(filePath): CapturedSession | null
```

Each new adapter is a single file in `mcp/src/capture/adapters/`. The watcher, store, daemon, distill pipeline, and MCP tools are all tool-agnostic — they operate on `CapturedSession` objects regardless of origin.

## Type Changes

### `mcp/src/capture/types.ts`

Widen the `CapturedSession.tool` union:

```typescript
tool: "claude-code" | "cursor" | "codex" | "gemini" | "copilot-cli" | "cline" | "roo-code"
```

Update `VALID_TOOLS`:

```typescript
const VALID_TOOLS = new Set([
  "claude-code", "cursor", "codex", "gemini",
  "copilot-cli", "cline", "roo-code"
]);
```

### `mcp/src/capture/capture-worker.ts`

Register 3 new adapters:

```typescript
import { ClineAdapter } from "./adapters/cline.js";
import { RooCodeAdapter } from "./adapters/roo-code.js";
import { CopilotCliAdapter } from "./adapters/copilot-cli.js";

registry.register(new ClineAdapter());
registry.register(new RooCodeAdapter());
registry.register(new CopilotCliAdapter());
```

## Adapter 1: Cline

**File:** `mcp/src/capture/adapters/cline.ts`

### Watch Paths

- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/`
- Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/`

Platform detected via `process.platform === "darwin"`.

### Source File

`{task-id}/api_conversation_history.json` — JSON array of Anthropic Messages API format.

### Parsing Strategy

- Parse the JSON array of messages with `role: "user" | "assistant"`
- Content is an array of content blocks:
  - `{ type: "text", text: "..." }` → extract text
  - `{ type: "tool_use", name: "...", id: "...", input: {...} }` → extract tool calls
  - `{ type: "tool_result", ... }` → skip (internal plumbing)
- Skip pure `tool_result` user messages (all content blocks are `tool_result`)
- Session ID: `sessionIdFromNative(taskDirectoryUUID)`
- Project path: attempt to read `cwdOnTaskInitialization` from sibling files or parent `taskHistory.json`, fallback to `"unknown"`
- Timestamps: use file mtime for `updatedAt`. For `startedAt`, first try reading the matching entry's `ts` field from `taskHistory.json` in the parent directory; if unavailable, fall back to the `api_conversation_history.json` file's birthtime.

## Adapter 2: Roo Code

**File:** `mcp/src/capture/adapters/roo-code.ts`

### Watch Paths

- macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks/`
- Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks/`

### Source File

Same format as Cline — `{task-id}/api_conversation_history.json` in Anthropic Messages API format.

### Parsing Strategy

Identical parsing logic to Cline (duplicated, not shared — each adapter is self-contained):

- Same content block extraction (text, tool_use, skip tool_result)
- Roo-specific fields (`condenseParent`, `isSummary`, `apiProtocol`, subtask chain fields) are ignored
- Each task is a standalone captured session (subtask chains are flattened)
- Session ID: `sessionIdFromNative(taskDirectoryUUID)`
- Same timestamp strategy as Cline (parent `taskHistory.json` `ts` → file birthtime fallback for `startedAt`, file mtime for `updatedAt`)
- Same project path strategy as Cline (`cwdOnTaskInitialization` → `"unknown"` fallback)

### Why No Shared Parser

Cline and Roo Code parse the same JSON format today, but they are independent projects that may diverge. Duplicating ~50 lines of parsing logic keeps each adapter fully self-contained with zero coupling. A bug fix or format change in one doesn't risk the other.

## Adapter 3: Copilot CLI

**File:** `mcp/src/capture/adapters/copilot-cli.ts`

### Watch Path

- `~/.copilot/session-state/` (same on macOS and Linux)

### Source File

`{session-id}/events.jsonl` — JSONL event stream, one JSON object per line.

### Event Format

```json
{
  "type": "event.type",
  "data": { ... },
  "id": "uuid",
  "timestamp": "ISO-8601",
  "parentId": "uuid | null"
}
```

### Parsing Strategy

- JSONL line-by-line parsing (same approach as Claude Code and Codex adapters)
- **Unicode sanitization:** Strip U+2028 (Line Separator) and U+2029 (Paragraph Separator) characters before `JSON.parse()` — known Copilot CLI issue where raw Unicode in tool output breaks JSONL parsing
- Map event types to messages:
  - `user.message` → user message, extract `data.content`
  - `assistant.message` → assistant message, extract `data.content`
  - `tool.execution_start` / `tool.execution_complete` → collect as tool calls, attach to the preceding/next assistant message
  - `session.start` → extract project path from `data` (cwd or workspace info)
  - All other event types → skip
- Session ID: `sessionIdFromNative(sessionDirectoryName)`
- Timestamps: from each event's `timestamp` field (ISO 8601). First event → `startedAt`, last event → `updatedAt`
- Project path: from `session.start` data, or from sibling `workspace.yaml` if present, fallback to `"unknown"`
- Parse errors tracked in `parseErrors[]` (same as Claude Code and Codex adapters)

## Test Strategy

### E2E Tests (`mcp/test/e2e/capture-pipeline.test.ts`)

Gated behind `TEST_E2E=1`, following the existing pattern:

**Full pipeline tests** (1 per adapter — added to `"Full Pipeline"` describe block):
- Create temp directory mimicking tool's watch path structure
- Start `CaptureWatcher` with all adapters registered
- Write realistic fixture file into watched directory
- Wait for `session` event
- Assert `CapturedSession` has correct `id`, `tool`, message count, roles
- Save to `SessionStore` and verify roundtrip

**Adapter-specific E2E** (1 new describe block per adapter):
- Write fixture file to temp directory
- Call `adapter.parse()` directly
- Assert:
  - Correct message count and role alternation
  - Tool call extraction (name, input)
  - `tool_result` messages filtered (Cline, Roo Code)
  - Session ID is deterministic (`ses_` prefix + first 16 hex chars)
  - Handles missing/malformed files gracefully (returns `null`)
- Copilot CLI specific:
  - U+2028/U+2029 sanitization test
  - Parse error tracking for corrupt JSONL lines

**Validation tests:**
- Update `"all four tools are valid"` → `"all seven tools are valid"`

### Fixture Data

Realistic session files for each tool:
- `cline-conversation.json` — Anthropic Messages API format array with text + tool_use + tool_result blocks
- `roo-code-conversation.json` — Same format with Roo-specific extra fields present (ignored by parser)
- `copilot-events.jsonl` — Event stream with `session.start`, `user.message`, `assistant.message`, `tool.execution_complete` events

## Files Changed

| File | Change |
|------|--------|
| `mcp/src/capture/types.ts` | Widen tool union, update VALID_TOOLS |
| `mcp/src/capture/capture-worker.ts` | Import + register 3 new adapters |
| `mcp/src/capture/adapters/cline.ts` | **New** — Cline adapter |
| `mcp/src/capture/adapters/roo-code.ts` | **New** — Roo Code adapter |
| `mcp/src/capture/adapters/copilot-cli.ts` | **New** — Copilot CLI adapter |
| `mcp/test/e2e/capture-pipeline.test.ts` | New E2E + pipeline tests for 3 adapters |
| `mcp/src/cli/stats.ts` | Update tool count if displayed |

## What Does NOT Change

- Watcher (`watcher.ts`) — tool-agnostic, works on any registered adapter
- Store (`store.ts`) — persists any `CapturedSession`
- Daemon (`daemon.ts`) — manages watcher lifecycle, adapter-agnostic
- Distill pipeline — operates on session transcripts regardless of source tool
- MCP tools — expose sessions regardless of origin
- Backend API — no changes
- Frontend — no changes

## Out of Scope

- Amp adapter (deferred — undocumented local format)
- CLI features (search, resume, fork, prune — separate future spec)
- Shared parser between Cline/Roo Code (intentionally duplicated)
