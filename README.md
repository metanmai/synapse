# Synapse

**Universal AI context layer — shared memory across Claude, ChatGPT, and your team**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/tanmain/synapse/actions)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io/)

---

AI tools don't remember anything between sessions, and they certainly don't share memory with each other. Synapse fixes that. It gives every AI tool you use — Claude, ChatGPT, Cursor — a single, persistent context layer that follows you across sessions and syncs across your team.

## What it does

- **Captures decisions, conventions, and session summaries** from any AI tool, automatically or on demand
- **Shares context across all your Claude, ChatGPT, and Cursor sessions** — no more re-explaining your stack, preferences, or prior decisions
- **Team collaboration** — invite members to projects, share context via links, keep everyone's AI on the same page
- **Browse and edit context in a web UI**, or enable Google Docs bidirectional sync to manage it in your existing workflow

## How it works

Synapse is a lightweight backend that any AI tool can talk to over HTTP or MCP. Your AI tools read from and write to it, so context captured in one session is immediately available in the next — and to everyone on your team.

| Layer | Technology |
|---|---|
| Backend | Cloudflare Worker — MCP server + Hono REST API |
| Frontend | React 19 SPA (Vite + Tailwind CSS) |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth — email, magic link, Google, GitHub + API keys for AI tools |
| Sync | Google Docs bidirectional sync |

## Quick Start

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works)
- A [Cloudflare](https://cloudflare.com) account (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/tanmain/synapse.git
cd synapse
npm install
cd frontend && npm install && cd ..
```

### 2. Set up Supabase

Create a new Supabase project, then run the migrations:

```bash
npx supabase link --project-ref <your-project-ref>
npm run db:migrate
```

Copy your project URL and anon key from the Supabase dashboard — you'll need them in the next step.

### 3. Configure secrets

```bash
# Supabase connection
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Google OAuth (optional — required for Google Docs sync)
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

Create a `.env` file in `frontend/` for local development:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=http://localhost:8787
```

### 4. Run locally

```bash
# In one terminal — backend (Cloudflare Worker via Wrangler)
npm run dev

# In another terminal — frontend (Vite dev server)
cd frontend && npm run dev
```

The backend runs at `http://localhost:8787` and the frontend at `http://localhost:5173`.

### 5. Connect Claude

```bash
claude mcp add synapse http://localhost:8787/mcp --header "Authorization: Bearer <your-api-key>"
```

Generate an API key from the web UI under Account > API Keys.

### 6. Deploy

```bash
npm run deploy
```

## Connect AI Tools

### Claude (via MCP)

```bash
claude mcp add synapse https://your-domain.workers.dev/mcp \
  --header "Authorization: Bearer <your-api-key>"
```

Once connected, Claude can read context from your projects and save new entries automatically during your sessions.

### ChatGPT (Custom GPT)

Create a Custom GPT and add a REST API action pointing at:

```
https://your-domain.workers.dev/api
```

Set the authentication type to Bearer token and paste your API key. Use the OpenAPI spec at `/api/openapi.json` to configure the action schema.

### Any HTTP client

Synapse exposes a standard REST API. All endpoints accept a Bearer token:

```bash
curl https://your-domain.workers.dev/api/entries \
  -H "Authorization: Bearer <your-api-key>"
```

See [API reference](docs/) for full endpoint documentation.

## Project Structure

```
synapse/
├── src/                        # Cloudflare Worker backend
│   ├── index.ts                # Worker entry point
│   ├── api/                    # Hono REST API routes
│   │   ├── auth.ts
│   │   ├── context.ts
│   │   ├── projects.ts
│   │   ├── share.ts
│   │   └── sync.ts
│   ├── mcp/                    # MCP server
│   │   ├── agent.ts
│   │   ├── prompts.ts
│   │   ├── resources.ts
│   │   └── tools/
│   │       ├── context-capture.ts
│   │       ├── context-retrieval.ts
│   │       ├── google-sync.ts
│   │       └── project-management.ts
│   ├── sync/                   # Google Docs sync
│   │   ├── from-google.ts
│   │   ├── google-auth.ts
│   │   └── to-google.ts
│   ├── db/                     # Database helpers
│   └── lib/                    # Shared utilities
│       ├── auth.ts
│       ├── env.ts
│       └── errors.ts
├── frontend/src/               # React SPA
│   ├── pages/                  # Route-level components
│   │   ├── DashboardPage.tsx
│   │   ├── ProjectWorkspace.tsx
│   │   ├── ActivityPage.tsx
│   │   └── AccountPage.tsx
│   ├── components/             # UI components
│   │   └── workspace/
│   │       ├── EntryEditor.tsx
│   │       ├── FolderTree.tsx
│   │       └── SearchPanel.tsx
│   ├── hooks/                  # React Query hooks
│   └── lib/                    # Auth, API client
├── supabase/                   # Supabase migrations
├── wrangler.jsonc              # Cloudflare Worker config
└── package.json
```

## Tech Stack

- [Cloudflare Workers](https://workers.cloudflare.com/) — serverless edge runtime, zero cold starts
- [Hono](https://hono.dev/) — fast, TypeScript-first web framework for the edge
- [Model Context Protocol SDK](https://modelcontextprotocol.io/) — standard protocol for AI tool integrations
- [Supabase](https://supabase.com/) — Postgres database + auth
- [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) + [Tailwind CSS](https://tailwindcss.com/) — frontend stack
- [TanStack Query](https://tanstack.com/query) — server state management
- [Zod](https://zod.dev/) — runtime schema validation
- [TypeScript](https://www.typescriptlang.org/) — throughout

## Contributing

Contributions are welcome. If you find a bug, have a feature request, or want to improve the docs, please [open an issue](https://github.com/tanmain/synapse/issues) or submit a pull request.

To contribute:

1. Fork the repo and create a feature branch
2. Make your changes with tests where applicable (`npm test`)
3. Ensure TypeScript compiles cleanly (`npm run typecheck`)
4. Open a pull request with a clear description of what changed and why

## Support the Project

Synapse is free and open source. If it saves you time, consider supporting its development.

- [GitHub Sponsors](https://github.com/sponsors/tanmain)
- [Buy Me a Coffee](https://buymeacoffee.com/tanmain)

Every bit of support helps keep the project maintained and moving forward.

## License

[MIT](LICENSE) — Copyright 2026 Tanmai N
