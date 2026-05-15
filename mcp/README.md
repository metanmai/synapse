# synapsesync-mcp

**Model Context Protocol (MCP) server for [Synapse](https://synapsesync.app)** — shared AI context as files in a cloud workspace, available from Claude, Cursor, Windsurf, VS Code, and other MCP-capable tools.

[![npm version](https://img.shields.io/npm/v/synapsesync-mcp.svg)](https://www.npmjs.com/package/synapsesync-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## What you get

Your assistant can use tools such as **`read`**, **`write`**, **`search`**, **`tree`**, **`ls`**, and **`history`** on paths in your Synapse projects (for example `decisions/`, `notes/`, `architecture/`). The same workspace is visible in the browser at **synapsesync.app** and across devices and teammates you invite.

The published package talks to the public API at **`https://api.synapsesync.app`**. To use your own backend, build from [source](https://github.com/metanmai/synapse) and change the `API_URL` constant in `src/index.ts` before `npm run build`.

## Quick start

### 1. Interactive setup (recommended)

In a terminal, from the directory where you want config files (e.g. your repo root):

```bash
npx synapsesync-mcp
```

This wizard can **sign you up**, **log you in**, or **accept an API key** you already have, then writes **`.mcp.json`** and, when detected, editor-specific snippets for Claude Code, Cursor, Windsurf, or VS Code. The wizard only runs in an interactive TTY; when your editor launches the server over stdio, it runs as a normal MCP server.

Explicit wizard:

```bash
npx synapsesync-mcp wizard
```

### 2. Manual MCP config

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
| `npx synapsesync-mcp` | Interactive wizard when run in a TTY; otherwise starts the MCP server (requires `SYNAPSE_API_KEY`). |
| `npx synapsesync-mcp wizard` | Same wizard, explicit. |
| `npx synapsesync-mcp login --email … --password …` | Non-interactive login; prints API key / config hints. |
| `npx synapsesync-mcp signup --email …` | Non-interactive signup where supported. |
| `npx synapsesync-mcp init --key <api-key>` | Write MCP config files using an existing key. |

Use `--help` on a command if your version supports it.

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

## Security notes

- Treat **`SYNAPSE_API_KEY`** like a password; do not commit it to git.
- Prefer environment variables or your editor’s secret storage for keys.

## Links

- **Product / dashboard:** [synapsesync.app](https://synapsesync.app)
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/)
- **Source (monorepo):** [github.com/metanmai/synapse](https://github.com/metanmai/synapse)

## License

MIT — see the [LICENSE](https://github.com/metanmai/synapse/blob/main/LICENSE) file in the repository.
