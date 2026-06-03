# synapsesync-mcp

**Model Context Protocol (MCP) server for [Synapse](https://synapsesync.app)** — shared AI context as files in a cloud workspace, available from Claude, Cursor, Windsurf, VS Code, and other MCP-capable tools.

[![npm version](https://img.shields.io/npm/v/synapsesync-mcp.svg)](https://www.npmjs.com/package/synapsesync-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## What you get

Your assistant can use tools such as **`read`**, **`write`**, **`search`**, **`tree`**, **`ls`**, and **`history`** on paths in your Synapse projects (for example `decisions/`, `notes/`, `architecture/`). The same workspace is visible in the browser at **synapsesync.app** and across devices and teammates you invite.

The published package talks to the public API at **`https://api.synapsesync.app`**. To use your own backend, build from [source](https://github.com/metanmai/synapse) and change the `API_URL` constant in `src/index.ts` before `npm run build`.

## Quick start

### 1. Commands & help

From your project directory:

```bash
npx synapsesync-mcp           # lists commands (interactive terminal)
npx synapsesync-mcp --help
```

### 2. Interactive setup (recommended)

Use **arrow keys** and **Enter** in menus (powered by [@clack/prompts](https://github.com/bombshell-dev/clack)).

```bash
npx synapsesync-mcp login     # sign in → writes .mcp.json + editor configs
npx synapsesync-mcp signup    # new account (email) → writes configs
npx synapsesync-mcp init      # paste an API key → writes configs
npx synapsesync-mcp wizard    # menu: sign up, log in, or API key
```

These write **`.mcp.json`** and, when detected, editor-specific files for Claude Code, Cursor, Windsurf, or VS Code. **Editors** launch the same package **without a TTY** and **`SYNAPSE_API_KEY` set** — that starts the MCP server, not the setup UI.

### 3. Manual MCP config

Create or extend your MCP configuration (e.g. Cursor **`.cursor/mcp.json`**, Claude **`.mcp.json`**, or your host’s equivalent):

```json
{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync-mcp"],
      "env": {
        "SYNAPSE_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

Get an API key from **[synapsesync.app](https://synapsesync.app)** → **Account → API keys**.

## CLI commands

| Command | Purpose |
|--------|---------|
| `npx synapsesync-mcp` | In a **TTY**: show command list. With **no TTY** + `SYNAPSE_API_KEY`: MCP server. |
| `npx synapsesync-mcp --help` / `-h` / `help` | Show commands and usage. |
| `login` | **Interactive**: sign in → writes configs. **Flags** `--email` / `--password`: print JSON only; then run `init --key`. |
| `signup` | **Interactive**: new account → writes configs. **`--email`**: print JSON only; then `init --key`. |
| `init` | **`--key`** or `SYNAPSE_API_KEY`: write configs. **Interactive** with no key: prompt for key. |
| `wizard` | Interactive menu (signup / login / API key) → writes configs. Requires TTY. |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SYNAPSE_API_KEY` | **Yes** for non-wizard / stdio mode | API key from Synapse. |
| `SYNAPSE_SOURCE` | No | Label for where edits come from (default `claude`). Examples: `cursor`, `chatgpt`, `copilot`, `windsurf`. |
| `SYNAPSE_PROJECT` | No | Default project name when the tool needs one (default `My Workspace`). |
| `SYNAPSE_PASSPHRASE` | No | Optional client-side encryption passphrase (use with `SYNAPSE_USER_EMAIL`). |
| `SYNAPSE_USER_EMAIL` | No | Email associated with encryption when using a passphrase. |

## Requirements

- **Node.js** 18+ recommended.
- A valid **Synapse API key** (except while using the signup/login flow in the wizard).

## Usage examples

### Example 1: Store and retrieve an architecture decision

**User prompt:** "Remember that we chose Redis for the caching layer because of its pub/sub support."

**Expected tool behavior:** The assistant calls `write` to store the decision.

```
Tool: write
Input: { path: "decisions/chose-redis.md", content: "# Chose Redis for caching\n\nWe chose Redis over Memcached for the caching layer because of its native pub/sub support, which we need for real-time cache invalidation across services." }
Output: "Wrote decisions/chose-redis.md (194 chars)"
```

### Example 2: Search for relevant context

**User prompt:** "What do we know about the authentication flow?"

**Expected tool behavior:** The assistant calls `search` with a semantic query.

```
Tool: search
Input: { query: "authentication flow" }
Output:
2 results:

[1] architecture/auth-flow.md
  dir: architecture/ | updated: 3/28/2026
  # Auth Flow  We use JWT tokens with short-lived access tokens (15min) and long-lived refresh tokens (30 days). The auth middleware validates tokens on every request...

[2] decisions/session-storage.md
  dir: decisions/ | updated: 3/25/2026
  # Session storage decision  Chose Supabase Auth for session management because it handles refresh token rotation automatically...
```

### Example 3: Browse workspace structure and read a file

**User prompt:** "What context do we have for this project?"

**Expected tool behavior:** The assistant calls `tree` to see the workspace, then `read` to load relevant files.

```
Tool: tree
Input: {}
Output:
.
  architecture
    auth-flow.md
    gateway.md
  decisions
    chose-redis.md
    session-storage.md
  notes
    standup-2026-03-28.md

Tool: read
Input: { path: "architecture/gateway.md" }
Output:
path: architecture/gateway.md | updated: 3/27/2026 | source: claude
---
# API Gateway Architecture

All public traffic routes through a Cloudflare Worker that handles auth, rate limiting, and request routing...
```

## Security notes

- Treat **`SYNAPSE_API_KEY`** like a password; do not commit it to git.
- Prefer environment variables or your editor’s secret storage for keys.

## Privacy policy

Synapse collects and stores the context files you create in your workspace. For the full privacy policy, see [synapsesync.app/privacy](https://synapsesync.app/privacy).

**Data handling summary:**
- **What we store:** Workspace files (context, notes, decisions), account info (email), and API keys.
- **Encryption:** Optional end-to-end encryption via `SYNAPSE_PASSPHRASE`. When enabled, content is encrypted client-side before transmission — the server never sees plaintext.
- **Third-party sharing:** We do not sell or share your data with third parties. Workspace data is only accessible to you and teammates you explicitly invite.
- **Data location:** Hosted on Cloudflare Workers and Supabase (Postgres). Data resides in the provider’s default regions.
- **Deletion:** You can delete any file or your entire account at any time. Deleted data is permanently removed.
- **Support:** [github.com/metanmai/synapse/issues](https://github.com/metanmai/synapse/issues) or email via your Synapse account.

## Links

- **Product / dashboard:** [synapsesync.app](https://synapsesync.app)
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/)
- **Source (monorepo):** [github.com/metanmai/synapse](https://github.com/metanmai/synapse)

## License

MIT — see the [LICENSE](https://github.com/metanmai/synapse/blob/main/LICENSE) file in the repository.
