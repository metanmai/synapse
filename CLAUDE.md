# Synapse

Synapse is a context management tool that captures AI coding sessions and surfaces insights across projects. It has a SvelteKit frontend, a Cloudflare Workers backend API, and an MCP server exposing the workspace for read + `save_insight` writes.

**Core Value:** The next session knows where the last one left off. The capture → daemon → backend → brief loop must work reliably; everything else can degrade.

> For codebase facts — stack, architecture, conventions, file layout, error patterns — read `.planning/codebase/` (`STACK.md`, `ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `INTEGRATIONS.md`, `TESTING.md`, `CONCERNS.md`). Those files are kept current by `/gsd-map-codebase`. Don't duplicate them here.

## Project Constraints

- **Timeline**: Launch by **Friday 2026-05-29** — 10 days from today (2026-05-19). Expanded from 5 days on 2026-05-19 to absorb cross-user collaboration and token-brokering scope additions.
- **Solo developer**: One person executing. Attention is the bottleneck.
- **Tech stack pinned**: TypeScript across all four workspaces (mcp, backend, frontend, packages/shared). Cloudflare Workers (backend) + Cloudflare Pages or Vercel (frontend) + Supabase Postgres. No language switches this milestone.
- **Backend deploy is manual**: No auto-deploy GitHub Action; `wrangler deploy` runs from a machine with the Cloudflare API token. Production can drift from main if deploy is forgotten (BUGS.md #10).
- **Corporate network proxy**: Netskope blocks some npm / pypi / npx egress. `npx synapsesync` fails on this network (REQ-BUG-03). Bypass requires tethering or a different network.
- **Pre-push hook runs full verify** (`npm run lint && npm run typecheck && npm run test`) — adds ~25s per push but catches regressions.
- **E2E happy-flow is the merge gate** (`npm run test:e2e`) — strict protocol per `docs/E2E-PROTOCOL.md`. Must pass before merging any change to `mcp/`, `backend/`, or `supabase/migrations/`. Takes ~3-5 min, costs ~$0.01-0.05 in tokens, exercises live backend + daemon. Unit tests catch code regressions; E2E catches *product* regressions — both are required.

## Synapse MCP — Read-Through Pattern (BLOCKING)

**CRITICAL:** Call `mcp__synapse__search` or `mcp__synapse__list_insights` **before** scanning the codebase, reading files, or doing any work that touches context, decisions, past work, architecture, or how something works. Synapse is the user's cross-session knowledge base — skipping it wastes time rediscovering documented things.

For every task:
1. **READ from Synapse first** — `search({ query: "<topic>" })` or `list_insights({ project: "synapse" })`. Do this in parallel with other work; don't pause the workflow.
2. **Cache HIT** — use it, done.
3. **Cache MISS** — fall back to codebase/git/etc. Keep working.
4. **SAVE INSIGHT (non-blocking)** — after finding the answer or making a decision, save it as an insight in the background alongside your next response or tool call. Never make the user wait for the save.

`save_insight` is the only write path. Types: `decision`, `learning`, `preference`, `architecture`, `action_item`. There is no update tool — save a new insight that supersedes the old one if the old one is wrong.

**Save proactively when**: a design/technical decision is made, a non-obvious fact is discovered, a subsystem's behavior is uncovered, a user preference is stated, follow-up work is identified, a subagent returns important findings (subagents can't access Synapse), or the user says "remember this."

**Don't save**: source code, transient debug output, verbatim conversation transcripts (the capture daemon handles those), or anything the user explicitly asks to keep local.

**Scope control**: "save this locally" → use local FS; "don't save this" → skip; "save this to synapse as a <type>" → use that type. Otherwise default to `save_insight` with an appropriate type.

If the Synapse MCP tools aren't connected, check for `.mcp.json` in the project root with a synapse server config. If missing, ask the user for their API key and create it as `{ "mcpServers": { "synapse": { "command": "npx", "args": ["synapsesync"], "env": { "SYNAPSE_API_KEY": "<key>" } } } }`, then tell the user to restart Claude Code.

## `<synapse-brief>` tag

If the first user message contains a `<synapse-brief>...</synapse-brief>` block, that's project orientation auto-injected by the Synapse SessionStart hook. Treat it as:

- Trusted context about the current project (summary, recent conversations, insights).
- **Not** a tool result — you were not a participant in prior sessions. Don't pretend to remember specific statements.
- A prompt to briefly acknowledge current state and ask the user what they want to do next.

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

- `/gsd-quick` — small fixes, doc updates, ad-hoc tasks
- `/gsd-debug` — investigation and bug fixing
- `/gsd-execute-phase` — planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
