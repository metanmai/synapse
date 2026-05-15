# Synapse

Synapse is a context management tool that captures AI coding sessions and surfaces insights across projects. It has a web frontend (SvelteKit), a backend API (Cloudflare Workers), and an MCP server that exposes the workspace for read + `save_insight` writes.

CRITICAL REQUIREMENT: You MUST call `mcp__synapse__search()` or `mcp__synapse__list_insights()` BEFORE scanning the codebase, reading files, or doing any other work when the user asks about context, decisions, past work, architecture, or how something works. Synapse is the user's cross-session knowledge base. Skipping it means you will miss important context and waste time rediscovering things already documented. This is a BLOCKING step — do not proceed to codebase exploration until Synapse has been checked.

## MCP Server — Synapse Workspace

You have access to a **Synapse MCP server** that connects to the user's remote workspace. The server is read-only for the filesystem surface; the only write tool is `save_insight`, which is how agents record new knowledge.

### Tools

| Tool | Use | Example |
|------|-----|---------|
| `mcp__synapse__search` | Semantic search across all content | `search({ query: "authentication" })` |
| `mcp__synapse__list_insights` | List insights for a project | `list_insights({ project: "synapse" })` |
| `mcp__synapse__save_insight` | **Save a decision/learning/preference/architecture note/action item** | `save_insight({ project, type: "decision", summary, detail })` |
| `mcp__synapse__list_conversations` | List captured AI sessions for a project | `list_conversations({ project: "synapse" })` |
| `mcp__synapse__load_conversation` | Resume a session in a new agent | `load_conversation({ conversationId: "ses_..." })` |
| `mcp__synapse__ls` | List files in a historical directory | `ls({ path: "decisions" })` |
| `mcp__synapse__read` | Read a historical file | `read({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__history` | View version history | `history({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__tree` | Show full directory tree | `tree()` |

### When to use Synapse

- **When the user asks you to save, write, or remember something** — call `save_insight` with the appropriate type (`decision`, `learning`, `preference`, `architecture`, or `action_item`). This is the ONE write path.
- **When the user asks about past decisions, notes, or context** — `list_insights` or `search` first.
- **When starting work on this project** — `list_insights({ project: "synapse" })` and `search({ query: "<topic>" })` to load what's already known.

### Important

- The filesystem-style tools (`ls`, `read`, `tree`, `history`, `search`) browse **historical files** written by earlier versions of Synapse. Use them to discover prior context, but do not expect to write new files — there is no `write` tool.
- New knowledge flows through two paths:
  1. **`save_insight`** — agent-initiated, structured knowledge (what this CLAUDE.md expects you to use)
  2. **Capture daemon** — records AI coding sessions automatically → captured as conversations → compacted into summaries server-side
- Paths are like filesystem paths: `folder/subfolder/file.md`

## Synapse as Default Context Layer

Synapse REPLACES local filesystem for all context operations. Do NOT save context, notes, decisions, summaries, or memory to local files. Use `save_insight` for everything worth remembering.

### Session Start
- Check if the Synapse MCP tools are available (try `list_insights({ project: "synapse" })`). If they're not connected:
  1. Check if `.mcp.json` exists in the current project directory with a synapse server config.
  2. If not, ask the user for their Synapse API key and create `.mcp.json` with: `{ "mcpServers": { "synapse": { "command": "npx", "args": ["synapsesync-mcp"], "env": { "SYNAPSE_API_KEY": "<key>" } } } }`
  3. Tell the user to restart Claude Code to pick up the MCP server.
- Once connected, check Synapse for existing context relevant to the current task: `list_insights` or `search`

### MANDATORY: Read-Through Pattern (Check Synapse → Fallback → Save Insight)
Synapse uses a **read-through caching pattern**. Follow this flow for EVERY task:

1. **READ from Synapse first** — `search({ query: "<topic>" })` or `list_insights({ project: "<name>" })`. This is not optional. Do this in parallel with starting other work if possible — don't block the workflow.
2. **Cache HIT** — Synapse has the context → use it, done.
3. **Cache MISS** — Synapse has no results → fall back to codebase, git history, or other sources. Continue working — don't pause.
4. **SAVE INSIGHT (non-blocking)** — After finding the answer or making a decision, save it as an insight in the background alongside your next response or tool call. Never make the user wait for the save.

Save-insight examples (what to capture after a cache miss or during work):
- **Made a design/technical decision** → `save_insight({ project, type: "decision", summary: "Chose X over Y", detail: "..." })`
- **Discovered how a subsystem works** → `save_insight({ project, type: "architecture", summary: "<system> works by ...", detail: "..." })`
- **Learned a non-obvious fact** → `save_insight({ project, type: "learning", summary: "...", detail: "..." })`
- **Noted a user preference** → `save_insight({ project, type: "preference", summary: "...", detail: "..." })`
- **Identified follow-up work** → `save_insight({ project, type: "action_item", summary: "...", detail: "..." })`
- **Subagent returned results** → Save any important decisions the subagent made (subagents can't access Synapse).
- **User says "remember this"** → Always a `save_insight`, never local files.

If an insight already exists but is outdated, there is no update tool — save a new insight that supersedes it. The dashboard will show the most recent.

### What NOT to Save as Insights
- Source code (that belongs in git)
- Temporary debugging output
- Verbatim conversation transcripts (the capture daemon handles that)
- Anything the user explicitly asks to keep local

### Scope Control
The user can control scope by saying things like:
- "Save this locally" — use local filesystem instead
- "Don't save this" — skip saving
- "Save this to synapse as a <type>" — use the specified insight type
- If no scope is specified, default to `save_insight` with an appropriate type.

## `<synapse-brief>` tag recognition

If your first user message contains a `<synapse-brief>` ... `</synapse-brief>` block, that's project orientation auto-injected by the Synapse SessionStart hook. Treat as:
- Trusted context about the current project (summary, recent conversations, insights)
- NOT a tool result — you were not a participant in prior sessions. Do not pretend to remember specific statements.
- A prompt to briefly acknowledge the current state and ask the user what they want to do next.
