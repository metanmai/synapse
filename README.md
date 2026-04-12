# SYNAPSE

**Shared AI context that survives sessions — one workspace for Claude, Cursor, ChatGPT, and your team.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/protocol-MCP-5C2D91?style=for-the-badge)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/synapsesync-mcp?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/synapsesync-mcp)

[Why Synapse](#why-synapse) · [How it works](#how-it-works) · [Getting started](#getting-started) · [Connect your tools](#connect-your-tools) · [Repository layout](#repository-layout) · [Self-hosting](docs/SELF_HOSTING.md) · [Architecture](docs/ARCHITECTURE.md)

---

AI assistants start every conversation cold. Your stack, decisions, and notes live in chat transcripts — not in a place the *next* session can rely on. Synapse is a **persistent context workspace**: files in the cloud, semantic search, version history, optional encryption, and access from the web app or from AI tools via **REST** and **MCP**.

---

## Why Synapse

| Problem | What Synapse does |
|--------|-------------------|
| Context disappears between sessions | Store decisions, notes, and specs as **paths** (e.g. `decisions/auth.md`) — always retrievable |
| Tools don't share memory | **Same project** for every tool that can call the API or run the MCP server |
| Keyword search misses intent | **Semantic search** (vector + text) so “auth flow” finds login and session docs |
| Teams drift apart | **Projects, members, share links** — one source of truth for humans and AIs |

The complexity stays in the product. Your workflow: write context where it belongs, search when you need it, let tools read/write through MCP or HTTP.

---

## Who this is for

- Builders who want **durable memory** for AI-assisted work without copying prompts between tools.
- Teams who want **one context layer** instead of scattered Notion docs and chat logs.
- Anyone comfortable running a **Supabase** project and a **Cloudflare Worker** (or using a hosted deployment).

---

## How it works

1. **Workspace** — Knowledge is stored as **entries** (markdown by default) organized by path inside a **project**.
2. **Backend** — A **Cloudflare Worker** exposes a **Hono** API (auth, projects, context CRUD, search, sharing, billing hooks, optional Google sync).
3. **Frontend** — **SvelteKit** Web UI to browse, edit, search, and manage API keys.
4. **MCP** — The **`synapsesync-mcp`** package exposes filesystem-like tools (`ls`, `read`, `write`, `search`, `tree`, …) so Claude Code, Cursor, and other MCP clients can use the same workspace.
5. **Data** — **Supabase** (Postgres + **pgvector**) for storage and auth; embeddings power semantic retrieval.

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Web / MCP  │────▶│  Worker (Hono)   │────▶│  Supabase   │
│  clients    │     │  + MCP bridge    │     │  + vectors  │
└─────────────┘     └──────────────────┘     └─────────────┘
```

---

## Getting started

### Prerequisites

- **Node.js 18+**
- **Supabase** account (free tier is fine)
- **Cloudflare** account (for deploying the Worker; local dev uses Wrangler)

### 1. Clone and install

```bash
git clone https://github.com/tanmain/synapse.git
cd synapse
npm install
```

The repo is an **npm workspace** (`backend`, `frontend`, `mcp`, `packages/shared`).

### 2. Database

Create a Supabase project and apply migrations from `supabase/` (see Supabase CLI docs for `link` / `db push`). Example:

```bash
cd backend
npx supabase link --project-ref <your-project-ref>
npm run db:migrate
```

### 3. Secrets and local env

Configure Worker secrets (see `backend/wrangler.jsonc` and your deployment docs), e.g.:

```bash
cd backend
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
# Optional Google OAuth for Docs sync
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

For **local frontend**, copy `frontend/.env.example` to `frontend/.env` and fill in values:

```env
API_URL=http://localhost:8787
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run locally

```bash
# Terminal A — API + Worker
npm run dev:backend

# Terminal B — SvelteKit
npm run dev:frontend
```

Default ports are typically **8787** (Worker) and **5173** (frontend); confirm in terminal output.

### 5. Quality checks (optional)

```bash
npm run typecheck
npm test
npm run lint
```

---

## Connect your tools

### Cursor / Claude Code — MCP (`npx`)

Install the published MCP server and add it to your MCP config with your **API key** from the web app (Account → API keys):

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

Optional:

- `SYNAPSE_API_URL` — API base URL (defaults to production if unset; use `http://localhost:8787` for local).
- `SYNAPSE_PASSPHRASE` + `SYNAPSE_USER_EMAIL` — transparent **E2E-style** encryption for content (see MCP package help).

The CLI also supports `login` / `signup` flows — run `npx synapsesync-mcp` for usage.

### HTTP / custom integrations

Use **`Authorization: Bearer <api-key>`** against your Worker’s REST routes (same API the web app uses). Explore `backend/src` route modules for available endpoints.

---

## Repository layout

```text
synapse/
├── backend/                 # Cloudflare Worker — Hono API, MCP, sync
│   ├── src/
│   ├── wrangler.jsonc
│   └── package.json         # @synapse/backend
├── frontend/                # SvelteKit 5 + Tailwind 4
│   └── src/
├── mcp/                     # synapsesync-mcp (TypeScript, publishable)
├── packages/shared/         # @synapse/shared — shared types
├── supabase/                # SQL migrations
├── docs/                    # Design notes & internal plans
├── package.json             # Workspace root scripts
└── biome.json               # Lint / format
```

---

## Tech stack

| Layer | Choice |
|------|--------|
| API & edge | [Cloudflare Workers](https://workers.cloudflare.com/), [Hono](https://hono.dev/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/) |
| Web UI | [SvelteKit](https://kit.svelte.dev/) 5, [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/) 4 |
| Data & auth | [Supabase](https://supabase.com/) (Postgres, Auth, pgvector) |
| AI integration | [Model Context Protocol](https://modelcontextprotocol.io/) (`@modelcontextprotocol/sdk`) |
| Tooling | TypeScript, [Biome](https://biomejs.dev/), Vitest (backend tests) |

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, commands, and PR expectations.

- **[SECURITY.md](SECURITY.md)** — report vulnerabilities privately.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — community guidelines.
- **[CHANGELOG.md](CHANGELOG.md)** — release notes.

Short version:

1. Fork and branch from `main`.
2. Run `npm run lint`, `npm run typecheck`, and `npm test`.
3. Open a PR with a clear description.

---

## License

[MIT](LICENSE)

---

**Synapse** — stop re-explaining your codebase every session.
