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
