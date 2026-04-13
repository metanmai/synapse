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

## Security notes

- Treat **`SYNAPSE_API_KEY`** like a password; do not commit it to git.
- Prefer environment variables or your editor’s secret storage for keys.

## Links

- **Product / dashboard:** [synapsesync.app](https://synapsesync.app)
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/)
- **Source (monorepo):** [github.com/metanmai/synapse](https://github.com/metanmai/synapse)

## License

MIT — see the [LICENSE](https://github.com/metanmai/synapse/blob/main/LICENSE) file in the repository.
