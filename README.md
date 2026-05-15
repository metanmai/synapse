# SYNAPSE

**One workspace for shared AI context — across tools, devices, teammates, and sessions.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/protocol-MCP-5C2D91?style=for-the-badge)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/synapsesync-mcp?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/synapsesync-mcp)

[Claude Code handoff](#claude-code-handoff) · [Slash commands](#slash-commands) · [Invite a teammate](#invite-a-teammate) · [Web dashboard](#web-dashboard) · [REST API](#rest-api) · [Why Synapse](#why-synapse) · [How it works](#how-it-works) · [This repo](#this-repository)

---

Synapse is a **handoff layer** for AI-assisted work. It records what you and your assistant did — focus, decisions, open questions, next steps — to a local event log, syncs it to a cloud workspace, and injects a fresh `<synapse-brief>` on the next `SessionStart`. The next session — yours on another machine, or a teammate's — picks up where the last one left off without re-briefing.

---

## Claude Code handoff

**Tanmai** pairs with Claude Code on her laptop; she has to stop mid-feature. **Alex** picks the same project up on a different machine an hour later — Claude Code opens, reads the project brief, and Alex continues from where Tanmai left off without re-briefing.

Synapse makes that work by recording Claude Code session events to a local log, syncing them through a background daemon, and injecting a `<synapse-brief>` summary on every `SessionStart`. The brief is generated from real events (edits, prompts, commits, handoffs) — not from chat summarisation.

### Setup (Claude Code, recommended)

```bash
npm install -g synapsesync-mcp
synapse init            # sign in, write hook entries, install the LaunchAgent / systemd daemon
synapse status          # daemon healthy, hook installed, brief cache fresh
synapse handoff "next: finish auth flow"  # leave a baton for the next session
```

`synapse init` writes the SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd, and SubagentStop hook entries into `~/.claude/settings.json`, drops slash command files into `~/.claude/commands/synapse/`, and installs a launchd / systemd unit that runs the capture daemon in the background. Projects are auto-created on the backend the first time the daemon syncs from a new working directory — there is no manual `project create` step.

**Daemon-fired Claude Code:** the daemon can also spawn its own Claude Code sessions (e.g. to compact context, extract decisions, refresh the brief). This is **opt-in** — set `daemon.ai_enabled = true` in `~/.synapse/config.json` to turn it on.

---

## Slash commands

`synapse init` installs the following slash commands into `~/.claude/commands/synapse/`. Type them inside Claude Code; the command body invokes the matching `synapse <cmd>` CLI under the hood.

| Command | What it does | Example |
|---------|--------------|---------|
| `/synapse:handoff` | Record an explicit next-step baton for whoever picks this up next. | `/synapse:handoff wire the /callback route, then test against staging` |
| `/synapse:focus` | Set the current focus for this session (the "what am I working on" line). | `/synapse:focus refactoring billing webhooks` |
| `/synapse:issue` | Create, resolve, or supersede an open issue (decisions or questions). | `/synapse:issue create question should we drop the legacy adapter?` |
| `/synapse:status` | One-line health check of the local Synapse daemon. | `/synapse:status` |
| `/synapse:doctor` | Detailed daemon diagnostics — paths, last sync, queued events. | `/synapse:doctor` |
| `/synapse:invite` | Invite a teammate to this project by email. | `/synapse:invite alex@example.com` |

Each command is also a plain CLI invocation: `synapse handoff "..."`, `synapse set-focus "..."`, `synapse issue create ...`, `synapse status`, `synapse doctor`, `synapse invite <email>`.

---

## Invite a teammate

Run `synapse invite <email>` (or `/synapse:invite <email>` inside Claude Code) from inside the project directory. The CLI prints a **join URL**; share it with the recipient. When they open it and sign in, the backend redeems the token, adds them to the project, and their next Claude Code session in any clone of the repo will see the same `<synapse-brief>` you do.

Under the hood: `POST /api/projects/:id/invites { email }` mints a crypto-random base64url token and returns the join URL; `POST /api/invites/:token/accept` redeems it and inserts the new `project_members` row.

### Legacy: for other MCP hosts (Cursor, Windsurf, VS Code)

The same package ships an MCP server that any MCP client can use. Hosts other than Claude Code don't get the hook-driven handoff layer; they get the same workspace via tools.

The legacy MCP surface has been trimmed: `ls`, `read`, `search`, `history`, `tree`, `list_conversations`, and `load_conversation` have been removed. Only **`save_insight`** and **`list_insights`** remain for backward compatibility with existing MCP installs; for everything else use the handoff CLI or the REST API. The MCP server itself is deprecated and is scheduled for removal in v2.0.

1. **Get an API key** — Sign up at **[synapsesync.app](https://synapsesync.app)**, open **Account → API keys**, and create a key (or create the account from the CLI).
2. **Run the wizard:**

   ```bash
   synapsesync-mcp wizard        # interactive sign-in → writes .mcp.json + editor configs
   ```

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

Your assistant gets the legacy **`save_insight`** and **`list_insights`** tools for capturing decisions/learnings into your project.

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
