# SYNAPSE

**One workspace for shared AI context — across tools, devices, teammates, and sessions.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/protocol-MCP-5C2D91?style=for-the-badge)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/synapsesync?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/synapsesync)

[AI session handoff](#ai-session-handoff) · [Slash commands](#slash-commands) · [Invite a teammate](#invite-a-teammate) · [Web dashboard](#web-dashboard) · [REST API](#rest-api) · [Why Synapse](#why-synapse) · [How it works](#how-it-works) · [This repo](#this-repository)

---

Synapse is a **handoff layer** for AI-assisted work. It records what you and your assistant did — focus, decisions, open questions, next steps — to a local event log, syncs it to a cloud workspace, and injects a fresh `<synapse-brief>` on the next `SessionStart`. The next session — yours on another machine, or a teammate's — picks up where the last one left off without re-briefing.

---

## AI session handoff

**Tanmai** pairs with Cline on his laptop; he has to stop mid-feature. **Alex** picks the same project up on a different machine an hour later — Cline opens, reads the project brief, and Alex continues from where Tanmai left off without re-briefing.

Synapse makes that work by recording AI session events to a local log, syncing them through a background daemon, and injecting a `<synapse-brief>` summary on every new session. The brief is generated from real events (edits, prompts, commits, handoffs) — not from chat summarisation.

### Setup (recommended)

```bash
npm install -g synapsesync
synapsesync wizard          # sign in, write hook entries, install the LaunchAgent / systemd daemon
synapsesync status          # daemon healthy, hook installed, brief cache fresh
synapsesync handoff "next: finish auth flow"  # leave a baton for the next session
```

`synapsesync wizard` configures whichever AI tools you have installed:
- **Claude Code** — writes the SessionStart, UserPromptSubmit, PostToolUse, PreCompact, SessionEnd, and SubagentStop hook entries into `~/.claude/settings.json`, drops slash command files into `~/.claude/commands/synapse/`. (Claude Code is the only tool with a native hook protocol; other tools are captured via the universal proxy or per-tool file-watcher.)
- **Universal proxy** — installs a local TLS-MITM forward proxy on `http://127.0.0.1:7727` plus a CA in your keychain. Any tool that honors `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` and talks to Anthropic / OpenAI / Google APIs is captured automatically (Cline, Cursor with own key, OpenCode, Aider, custom scripts, etc.).
- **File watchers** — adapter-based capture for tools whose session storage we know about (see `mcp/src/capture/adapters/`).

The wizard also installs a launchd / systemd unit that runs the capture daemon in the background. Projects are auto-created on the backend the first time the daemon syncs from a new working directory — there is no manual `project create` step.

**Scripted / CI alternative:** `synapsesync init --api-key "<key>" [--skip-service]` is the non-interactive equivalent of the wizard. Useful for headless installs where the browser-based sign-in flow isn't an option.

**Cross-device:** sign in on a second machine inside a clone of the same git repo and the daemon auto-links to your existing project via the remote URL — the brief on machine B includes machine A's activity tagged with the originating hostname (e.g. "Your last activity (on laptop-A): ..."). If the auto-link picks the wrong target, the project Settings page has a manual **Linked Projects** picker for explicit merges.

---

## Slash commands

`synapsesync wizard` installs the following slash commands into `~/.claude/commands/synapse/` (Claude Code is the only AI tool that supports a native slash-command protocol today). Type them inside Claude Code; the command body invokes the matching `synapsesync <cmd>` CLI under the hood. The same CLI commands work standalone in any other shell session.

| Command | What it does | Example |
|---------|--------------|---------|
| `/synapse:handoff` | Record an explicit next-step baton for whoever picks this up next. | `/synapse:handoff wire the /callback route, then test against staging` |
| `/synapse:focus` | Set the current focus for this session (the "what am I working on" line). | `/synapse:focus refactoring billing webhooks` |
| `/synapse:issue` | Create, resolve, or supersede an open issue (decisions or questions). | `/synapse:issue create question should we drop the legacy adapter?` |
| `/synapse:status` | One-line health check of the local Synapse daemon. | `/synapse:status` |
| `/synapse:doctor` | Detailed daemon diagnostics — paths, last sync, queued events. | `/synapse:doctor` |
| `/synapse:invite` | Invite a teammate to this project by email. | `/synapse:invite alex@example.com` |

Each command is also a plain CLI invocation: `synapsesync handoff "..."`, `synapsesync set-focus "..."`, `synapsesync issue create ...`, `synapsesync status`, `synapsesync doctor`, `synapsesync invite <email>`.

---

## Invite a teammate

Run `synapsesync invite <email>` (or `/synapse:invite <email>` inside any AI tool that supports slash commands) from inside the project directory. The CLI prints a **join URL**; share it with the recipient. When they open it and sign in, the backend redeems the token, adds them to the project, and their next AI session in any clone of the repo will see the same `<synapse-brief>` you do.

Under the hood: `POST /api/projects/:id/invites { email }` mints a crypto-random base64url token and returns the join URL; `POST /api/invites/:token/accept` redeems it and inserts the new `project_members` row.

### How capture works across tools

| Path | Covers | How |
|---|---|---|
| **Universal proxy** (default) | Any tool that uses Anthropic / OpenAI / Google APIs over HTTPS — Cline, Cursor (own-key mode), Codex, Aider, OpenCode, Kilo, custom scripts, anything that honors `HTTPS_PROXY` | TLS-MITM forward proxy on 127.0.0.1:7727 with a local CA. Tool attribution from User-Agent header. No per-tool adapter required. |
| **File watcher** (per-tool) | Claude Code, Cline, Cursor, Codex, Gemini, GitHub Copilot CLI, Roo Code | Adapter in `mcp/src/capture/adapters/` watches the tool's local transcript storage and replays new sessions into the same pipeline as the proxy. |
| **Native hooks** (Claude Code only) | Claude Code sessions | Claude Code's hook protocol writes events into `~/.claude/settings.json`-wired stdin pipes — the only tool with this protocol today. Strictly more precise than file-watch for Claude Code; identical pipeline downstream. |

The three paths converge into the same workspace + brief output. The same `synapsesync wizard` setup picks up whichever path applies to your installed tools and wires their config automatically.

Any MCP-capable client (ChatGPT, Windsurf, VS Code Copilot, etc.) can also read the workspace via the bundled MCP server — same data, different surface.

**Legacy MCP tool surface (deprecated, slated for removal in v2.0):**
The MCP server's filesystem-style tools (`ls`, `read`, `search`, `history`, `tree`, `list_conversations`, `load_conversation`) were removed in v1.1. Only **`save_insight`** and **`list_insights`** remain for back-compat with existing installs. For everything else, use the handoff CLI or the REST API.

1. **Get an API key** — Sign up at **[synapsesync.app](https://synapsesync.app)**, open **Account → API keys**, and create a key (or create the account from the CLI).
2. **Run the wizard** (interactive sign-in → writes `.mcp.json` + editor configs):

   ```bash
   synapsesync wizard
   ```

3. **Or register the MCP server manually** — add this to your MCP host's config:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync"],
      "env": {
        "SYNAPSE_API_KEY": "<paste-your-api-key-here>"
      }
    }
  }
}
```

4. **Scripted / CI** — `synapsesync login --email … --password …` or `synapsesync signup --email …` print JSON snippets; `synapsesync init --api-key <key>` writes config files non-interactively.

Your assistant gets the legacy **`save_insight`** and **`list_insights`** tools for capturing decisions/learnings into your project.

The MCP always talks to the public API at `https://api.synapsesync.app`. Self-hosting your own API requires building `synapsesync` from source and changing the `API_URL` constant in `mcp/src/index.ts`.

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
3. **MCP** — **`synapsesync`** maps that API to MCP tools your assistant can call.
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
├── mcp/              # synapsesync (npm)
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
