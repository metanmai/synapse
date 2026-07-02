# SYNAPSE

**One workspace for shared AI context — across tools, devices, teammates, and sessions.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/protocol-MCP-5C2D91?style=for-the-badge)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/synapsesync-mcp?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/synapsesync-mcp)

[MCP setup](#mcp-setup) · [Web dashboard](#web-dashboard) · [REST API](#rest-api) · [Why Synapse](#why-synapse) · [How it works](#how-it-works) · [This repo](#this-repository)

---

Synapse stores your AI context as **files in a cloud workspace** so the same memory is there in **every MCP-capable tool**, on **every device**, and for **teammates** you invite — not trapped in a single chat thread.

---

## MCP setup

Connect Claude Code, Cursor, Windsurf, VS Code (MCP), or any client that supports **Model Context Protocol**.

1. **Get an API key** — Sign up at **[synapsesync.app](https://synapsesync.app)**, open **Account → API keys**, and create a key (or create the account from the CLI — see below).
2. **CLI setup (recommended)** — In a terminal, `cd` to your project and run:

   ```bash
   npx synapsesync-mcp --help    # command list
   npx synapsesync-mcp login     # interactive sign-in → writes .mcp.json + editor configs
   # or: signup | init | wizard
   ```

   Interactive flows use keyboard navigation (arrow keys + Enter). Editors that spawn the MCP **without a TTY** still run the **server** when **`SYNAPSE_API_KEY`** is set — not the setup UI.

3. **Or register the server yourself** — Add the published **`synapsesync-mcp`** package to your MCP config:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync-mcp"],
      "env": {
        "SYNAPSE_API_KEY": "<paste-your-api-key-here>"
      }
    }
  }
}
```

4. **Scripted / CI** — `login --email … --password …` or `signup --email …` print JSON snippets; run `init --key <key>` to write config files.

Your assistant gets tools such as **`read`**, **`write`**, **`search`**, **`tree`**, **`ls`**, and **`history`** against your project paths (e.g. `decisions/`, `notes/`, `architecture/`).

**Optional environment variables**

| Variable | When to set |
|----------|----------------|
| `SYNAPSE_PASSPHRASE` + `SYNAPSE_USER_EMAIL` | Optional client-side encryption for content at rest (see package documentation). |

The MCP always talks to the public API at `https://api.synapsesync.app`. Self-hosting your own API requires building `synapsesync-mcp` from source and changing the `API_URL` constant in `mcp/src/index.ts`.

Restart the editor or MCP host after changing config.

---

## Web dashboard

**[synapsesync.app](https://synapsesync.app)** is the same workspace in the browser: create **projects**, invite **members**, **search** and edit entries, manage **API keys**, and handle billing. Use it alongside MCP — your tools and the site always see the same data.

---

## REST API

Automation, scripts, or non-MCP clients can call the same backend as the web app: send **`Authorization: Bearer <api-key>`** on HTTP requests. This repository’s **`backend/src`** defines routes; there is no separate public OpenAPI file in-repo — explore the code or your deployment’s network tab when in doubt.

---

## Why Synapse

| Problem | What Synapse does |
|--------|-------------------|
| Context disappears between sessions | Store decisions, notes, and specs as **paths** (e.g. `decisions/auth.md`) — always retrievable |
| Tools don’t share memory | **One project** in the cloud for Claude, Cursor, ChatGPT-style clients, and anything else that can use MCP or the API |
| Context doesn’t follow you across devices | **Same workspace** everywhere you log in or attach an API key |
| Keyword search misses intent | **Semantic search** (vector + text) so “auth flow” finds login and session docs |
| Teams and users stay out of sync | **Projects, members, share links** — one source of truth for humans and AIs |

---

## Who this is for

- Builders who want **durable memory** across **tools and devices**, not locked to one chat or one machine.
- Teams who want **one context layer for multiple people** — every assistant reads and writes the same project instead of re-briefing in DMs.
- Anyone who lives in **MCP-aware editors and CLIs** and wants a **hosted** workspace without running infrastructure.

---

## How it works

1. **Workspace** — Knowledge lives as **entries** (usually markdown) at paths inside a **project**.
2. **Cloud API** — A **Cloudflare Worker** (**Hono**) serves auth, projects, context CRUD, search, sharing, and optional integrations.
3. **MCP** — **`synapsesync-mcp`** maps that API to MCP tools your assistant can call.
4. **Data** — **Supabase** (Postgres + **pgvector**) stores content and auth; search blends semantic and text retrieval.

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Web / MCP  │────▶│  Worker (API)    │────▶│  Supabase   │
│  clients    │     │                  │     │  + vectors  │
└─────────────┘     └──────────────────┘     └─────────────┘
```

---

## This repository

This monorepo is the **implementation** of Synapse: **Worker** (`backend/`), **web app** (`frontend/`), **MCP package** (`mcp/`), and shared types (`packages/shared/`). If you want to **run or fork the stack**, use **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)** — that is separate from day-to-day use via MCP and the hosted app.

```
synapse/
├── backend/          # API (Cloudflare Worker)
├── frontend/         # Dashboard (SvelteKit)
├── mcp/              # synapsesync-mcp (npm)
├── packages/shared/  # Shared TypeScript types
└── supabase/         # Database migrations
```

**Stack (summary):** Cloudflare Workers, Hono, SvelteKit 5, Tailwind 4, Supabase, MCP SDK, TypeScript, Biome, Vitest.

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** — **[SECURITY.md](SECURITY.md)** · **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** · **[CHANGELOG.md](CHANGELOG.md)**

---

## License

[MIT](LICENSE)

---

**Synapse** — stop re-explaining your codebase every session.
