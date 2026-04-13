# Synapse

Synapse is a context management tool that stores knowledge as files in a remote workspace. It has a web frontend (SvelteKit), a backend API (Cloudflare Workers), and an MCP server that exposes the workspace as a filesystem.

CRITICAL REQUIREMENT: You MUST call `mcp__synapse__search()` or `mcp__synapse__tree()` BEFORE scanning the codebase, reading files, or doing any other work when the user asks about context, decisions, past work, architecture, or how something works. Synapse is the user's cross-session knowledge base. Skipping it means you will miss important context and waste time rediscovering things already documented. This is a BLOCKING step — do not proceed to codebase exploration until Synapse has been checked.

## MCP Server — Synapse Workspace

You have access to a **Synapse MCP server** that connects to the user's remote workspace. Use it like a filesystem:

### Tools

| Tool | Use | Example |
|------|-----|---------|
| `mcp__synapse__ls` | List files in a directory | `ls()` or `ls({ path: "decisions" })` |
| `mcp__synapse__read` | Read a file's content | `read({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__write` | Create or update a file | `write({ path: "notes/meeting.md", content: "..." })` |
| `mcp__synapse__search` | Semantic search across all files (understands meaning, not just keywords) | `search({ query: "authentication" })` |
| `mcp__synapse__history` | View version history | `history({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__tree` | Show full directory tree | `tree()` |

### When to use Synapse

- **When the user asks you to save, write, or remember something** — write it to Synapse, not the local filesystem. Synapse IS their knowledge base.
- **When the user asks about past decisions, notes, or context** — search or read from Synapse first.
- **When starting work on this project** — run `tree()` to see what context is available.
- **Organize files logically** — use directory paths like `decisions/`, `notes/`, `context/`, `specs/` etc. Directories are created automatically from the path.

### Important

- Content may be **end-to-end encrypted**. The MCP server handles encryption/decryption transparently if `SYNAPSE_PASSPHRASE` is set.
- Paths are like filesystem paths: `folder/subfolder/file.md`
- Files are markdown by default. Write in markdown.
- Tags are optional but useful: `write({ path: "...", content: "...", tags: ["decision", "architecture"] })`

## Synapse as Default Context Layer

Synapse REPLACES local filesystem for all context operations. Do NOT write context, notes, decisions, summaries, or memory to local files. Use Synapse for everything.

### Session Start
- Check if the Synapse MCP tools are available (try `tree()`). If they're not connected:
  1. Check if `.mcp.json` exists in the current project directory with a synapse server config.
  2. If not, ask the user for their Synapse API key and create `.mcp.json` with: `{ "mcpServers": { "synapse": { "command": "npx", "args": ["synapsesync-mcp"], "env": { "SYNAPSE_API_KEY": "<key>" } } } }`
  3. Tell the user to restart Claude Code to pick up the MCP server.
- Once connected, check Synapse for existing context relevant to the current task: `tree()` or `search()`
- Check Synapse for `settings/claude-settings.json` and `settings/CLAUDE.md`. Compare with local versions:
  - **If they match** — no action needed.
  - **If they differ** — first check Synapse for `settings/sync-preferences.json` which stores the user's past decisions about conflicts (e.g., `{ "ignore": ["hook Y", "permission X"], "policy": "keep-local" }`). If the user has already decided to ignore certain differences or set a policy, respect that silently. Otherwise, show what's different and ask how to resolve: keep local, keep Synapse, or merge. Save their decision to `settings/sync-preferences.json` so they're never asked about the same conflict again.
- If the user is working on a known project, `ls("project-name/")` to load its context.

### MANDATORY: Read-Through Pattern (Check Synapse → Fallback → Write Back)
Synapse uses a **read-through caching pattern**. Follow this flow for EVERY task:

1. **READ from Synapse first** — `search({ query: "<topic>" })` or `ls("projects/<project-name>/")`. This is not optional. Do this in parallel with starting other work if possible — don't block the workflow.
2. **Cache HIT** — Synapse has the context → use it, done.
3. **Cache MISS** — Synapse has no results → fall back to codebase, git history, or other sources. Continue working — don't pause.
4. **WRITE BACK (non-blocking)** — After finding the answer, write it to Synapse in the background alongside your next response or tool call. Never make the user wait for a write-back.

Write-back examples (what to save after a cache miss):
- **Explored a codebase** → `write({ path: "projects/<name>/overview.md", content: "..." })`
- **Found a decision in git/code** → `write({ path: "decisions/<topic>.md", content: "...", tags: ["decision"] })`
- **Diagnosed a bug** → `write({ path: "bugs/<bug-name>.md", content: "..." })`
- **Discovered architecture** → `write({ path: "architecture/<topic>.md", content: "..." })`
- **Meeting notes** → `write({ path: "notes/standup-2026-03-22.md", content: "..." })`
- **Subagent returned results** → Write back immediately (subagents can't access Synapse).
- **User says "remember this"** → Always Synapse, never local files.

If context already exists in Synapse but is outdated, **update it** rather than creating a duplicate.

### What NOT to Write to Synapse
- Source code (that belongs in git)
- Temporary debugging output
- Anything the user explicitly asks to keep local

### Settings Sync
- When the user changes Claude settings (permissions, hooks, preferences), save a copy to Synapse: `write({ path: "settings/claude-settings.json", content: <settings> })`
- This ensures settings sync across devices automatically on next session start.

### Scope Control
The user can control scope by saying things like:
- "Save this locally" — use local filesystem instead
- "Don't save this" — skip writing
- "Save this to synapse under projects/acme/" — use the specified path
- If no scope is specified, default to Synapse with a logical path.
