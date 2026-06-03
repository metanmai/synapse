# synapsesync

**Model Context Protocol (MCP) server for [Synapse](https://synapsesync.app)** — shared AI context as files in a cloud workspace, available from Claude, Cursor, Windsurf, VS Code, and other MCP-capable tools.

[![npm version](https://img.shields.io/npm/v/synapsesync.svg)](https://www.npmjs.com/package/synapsesync)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## What you get

Your assistant captures and recalls structured **insights** — decisions, learnings, architecture notes, preferences, and action items — across sessions, devices, and teammates. Two MCP tools, **`save_insight`** and **`list_insights`**, let any MCP-capable assistant write to and read from your Synapse workspace. The same insights surface in the browser at **synapsesync.app** and across devices and teammates you invite.

The bulk of context capture happens automatically via the **handoff layer**: the background daemon installed by `synapsesync wizard` records hook events, syncs them to the backend, and injects a `<synapse-brief>` block at every `SessionStart` so the next session starts with full context — no tool calls needed.

The published package talks to the public API at **`https://api.synapsesync.app`**. To use your own backend, build from [source](https://github.com/metanmai/synapse) and change the `API_URL` constant in `src/index.ts` before `npm run build`.

## Quick start

### 1. Install

```bash
npm install -g synapsesync
```

### 2. Commands & help

From your project directory:

```bash
synapsesync               # lists commands (interactive terminal)
synapsesync --help
```

### 3. Interactive setup (recommended)

Use **arrow keys** and **Enter** in menus (powered by [@clack/prompts](https://github.com/bombshell-dev/clack)).

```bash
synapsesync wizard        # menu: sign up, log in, or paste API key
```

These write **`.mcp.json`** and, when detected, editor-specific files for Claude Code, Cursor, Windsurf, or VS Code. **Editors** launch the same package **without a TTY** and **`SYNAPSE_API_KEY` set** — that starts the MCP server, not the setup UI.

### 3. Manual MCP config

Create or extend your MCP configuration (e.g. Cursor **`.cursor/mcp.json`**, Claude **`.mcp.json`**, or your host’s equivalent):

```json
{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync"],
      "env": {
        "SYNAPSE_API_KEY": "<your-api-key>"
      }
    }
  }
}
```

Get an API key from **[synapsesync.app](https://synapsesync.app)** → **Account → API keys**.

## CLI commands

Install once with `npm install -g synapsesync`, then run `synapsesync <command>`.

| Command | Purpose |
|--------|---------|
| `synapsesync` | In a **TTY**: show interactive menu. With **no TTY** + `SYNAPSE_API_KEY`: MCP server. |
| `synapsesync --help` / `-h` / `help` | Show commands and usage. |
| `synapsesync wizard` | Interactive menu (signup / login / API key) → writes configs. Requires TTY. |
| `synapsesync status` | Show connection health and which editor configs Synapse is configured in. |
| `synapsesync refresh` | Rotate the API key and update all editor configs. |
| `synapsesync whoami` | Show the signed-in account, tier, and file count. |
| `synapsesync reset` | Wipe all workspace data (keeps account + subscription). |
| `synapsesync uninstall` | Remove all Synapse configs from this machine. |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SYNAPSE_API_KEY` | **Yes** for non-wizard / stdio mode | API key from Synapse. |
| `SYNAPSE_SOURCE` | No | Label for where edits come from (default `claude`). Examples: `cursor`, `chatgpt`, `copilot`, `windsurf`. |
| `SYNAPSE_PROJECT` | No | Default project name when the tool needs one (default `My Workspace`). |

## Requirements

- **Node.js** 18+ recommended.
- A valid **Synapse API key** (except while using the signup/login flow in the wizard).

## Usage examples

### Example 1: Save a decision

**User prompt:** "Remember that we chose Redis for the caching layer because of its pub/sub support."

**Expected tool behavior:** The assistant calls `save_insight` with `type: "decision"`.

```
Tool: save_insight
Input: {
  project: "my-app",
  type: "decision",
  title: "Chose Redis over Memcached for caching",
  content: "Native pub/sub support is required for real-time cache invalidation across services."
}
Output: {
  id: "9f2c1d3e-...",
  active: true,
  created_at: "2026-05-28T..."
}
```

### Example 2: Browse what the project has decided

**User prompt:** "What architecture decisions have we made on this project?"

**Expected tool behavior:** The assistant calls `list_insights` filtered by project + type.

```
Tool: list_insights
Input: { project: "my-app", type: "decision" }
Output: [
  {
    id: "9f2c1d3e-...",
    title: "Chose Redis over Memcached for caching",
    content: "Native pub/sub support is required for real-time cache invalidation across services.",
    created_at: "2026-05-28T..."
  },
  {
    id: "4b3d8d8b-...",
    title: "Auth uses JWT with 15-min access + 30-day refresh tokens",
    content: "Sticky sessions are unworkable behind the CDN edge.",
    created_at: "2026-05-25T..."
  }
]
```

### Example 3: Supersede an old decision when it changes

**User prompt:** "Update that — we switched the caching layer from Redis to Cloudflare KV for cost reasons."

**Expected tool behavior:** The assistant calls `save_insight` with the new decision *and* `supersedes` pointing at the old ID it just listed. The default `list_insights` query then hides the old one.

```
Tool: save_insight
Input: {
  project: "my-app",
  type: "decision",
  title: "Switched cache from Redis to Cloudflare KV",
  content: "Cost-driven — KV's free tier covers projected load; pub/sub was dropped in favor of polling.",
  supersedes: ["9f2c1d3e-..."]
}
Output: {
  id: "8a1f2b4c-...",
  active: true,
  superseded: ["9f2c1d3e-..."]
}
```

## Security notes

- Treat **`SYNAPSE_API_KEY`** like a password; do not commit it to git.
- Prefer environment variables or your editor’s secret storage for keys.

## Privacy policy

Synapse collects and stores the context files you create in your workspace. For the full privacy policy, see [synapsesync.app/privacy](https://synapsesync.app/privacy).

**Data handling summary:**
- **What we store:** Workspace files (context, notes, decisions), account info (email), and API keys.
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
