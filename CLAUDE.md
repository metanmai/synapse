# Synapse

Synapse is a context management tool that stores knowledge as files in a remote workspace. It has a web frontend (SvelteKit), a backend API (Cloudflare Workers), and an MCP server that exposes the workspace as a filesystem.

## MCP Server — Synapse Workspace

You have access to a **Synapse MCP server** that connects to the user's remote workspace. Use it like a filesystem:

### Tools

| Tool | Use | Example |
|------|-----|---------|
| `mcp__synapse__ls` | List files in a directory | `ls()` or `ls({ path: "decisions" })` |
| `mcp__synapse__read` | Read a file's content | `read({ path: "decisions/chose-svelte.md" })` |
| `mcp__synapse__write` | Create or update a file | `write({ path: "notes/meeting.md", content: "..." })` |
| `mcp__synapse__search` | Search across all files | `search({ query: "authentication" })` |
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
- Run `tree()` or `search()` to check for existing context relevant to the current task.
- If the user is working on a known project, `ls("project-name/")` to load its context.

### During Work
- **Decisions made** — Immediately write to Synapse: `write({ path: "decisions/chose-redis-over-memcached.md", content: "...", tags: ["decision", "infrastructure"] })`
- **Bugs encountered** — Save the diagnosis: `write({ path: "bugs/auth-token-expiry-race.md", content: "..." })`
- **Architecture discussed** — Capture it: `write({ path: "architecture/api-gateway-design.md", content: "..." })`
- **Meeting notes** — `write({ path: "notes/standup-2026-03-22.md", content: "..." })`
- **User says "remember this"** — Always Synapse, never local files.

### Before Asking the User
- If you need context about a past decision, search Synapse first: `search({ query: "why did we choose X" })`
- If you're unsure about project conventions, check: `search({ query: "conventions" })` or `ls("standards/")`
- Don't ask the user something that might already be in Synapse.

### What NOT to Write to Synapse
- Source code (that belongs in git)
- Temporary debugging output
- Anything the user explicitly asks to keep local

### Scope Control
The user can control scope by saying things like:
- "Save this locally" — use local filesystem instead
- "Don't save this" — skip writing
- "Save this to synapse under projects/acme/" — use the specified path
- If no scope is specified, default to Synapse with a logical path.
