# Self-hosting Synapse

This guide is for running **your own** Worker, database, and (optionally) embedding service. It assumes you are comfortable with **Supabase**, **Cloudflare Workers**, and **Wrangler**.

## Overview

| Component | Role |
|-----------|------|
| **Supabase** | Postgres (with pgvector), Auth, Row Level Security as you configure |
| **Cloudflare Worker** (`backend/`) | REST API, MCP transport, scheduled jobs, Durable Objects for agent/MCP |
| **SvelteKit** (`frontend/`) | Web UI — can point at your Worker |
| **Embedding service** (optional) | HTTP service for `nomic-embed-text-v1.5` vectors; semantic search degrades without it |
| **MCP** (`mcp/`) | Published as `synapsesync-mcp` or run locally after `npm run build` |

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
3. From the repo root (or `supabase/`):

   ```bash
   supabase link --project-ref <your-project-ref>
   ```

4. Push migrations:

   ```bash
   cd backend && npm run db:migrate
   ```

   (`db:migrate` runs `supabase db push` — ensure CLI is authenticated and linked.)

5. Enable **Auth** providers you need in the Supabase dashboard (email, OAuth, etc.) and note:
   - **Project URL**
   - **anon key** → frontend (`SUPABASE_URL`, `SUPABASE_ANON_KEY`)
   - **service role key** → Worker only (never ship to the browser)

## 2. Cloudflare Worker — required secrets

The Worker reads bindings from `backend/wrangler.jsonc`. **Secrets** (sensitive) vs **vars** (non-secret) are documented in Cloudflare’s Wrangler docs.

Minimal secrets to set (names match `backend/src/lib/env.ts`):

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase **service role** key (server-side only) |
| `GOOGLE_CLIENT_ID` | OAuth (optional if you disable Google features) |
| `GOOGLE_CLIENT_SECRET` | OAuth |
| `CREEM_API_KEY` | Billing (Creem) — set placeholder if you stub billing locally |
| `CREEM_WEBHOOK_SECRET` | Creem webhooks |

Example (from `backend/`):

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
# ... repeat for other secrets
```

Local dev: copy **`.dev.vars.example`** (repo root) to **`backend/.dev.vars`**. Wrangler runs with `backend/` as the config directory (`npm run dev:backend`), so the secrets file belongs next to `backend/wrangler.jsonc`.

```ini
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Add Creem keys when exercising billing; for a minimal dev slice you may need to satisfy `Env` typing — see `backend/src/lib/env.ts` for full list and optional vs required behavior in code paths.

**Non-secret** vars in `wrangler.jsonc` include `CREEM_PRO_PRODUCT_ID`, `EMBEDDING_SERVICE_URL`, `EMBEDDING_SERVICE_KEY`. Adjust for your deployment; remove or override **production domains** in `routes` if you deploy elsewhere.

## 3. Frontend

1. Copy `frontend/.env.example` → `frontend/.env`.
2. Set:
   - `API_URL` — your Worker URL (e.g. `http://localhost:8787` or `https://api.example.com`)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` — from Supabase dashboard

3. Run:

   ```bash
   npm run dev:frontend
   ```

Configure Supabase **redirect URLs** and **site URL** so OAuth and magic links work with your frontend origin.

## 4. Embedding service (optional)

Semantic search uses vectors stored in Postgres. The Worker forwards text to an embedding HTTP API when `EMBEDDING_SERVICE_URL` / `EMBEDDING_SERVICE_KEY` are set.

- Reference implementation: `embedding-service/` (Dockerfile + FastAPI).
- Build and run the container; expose a URL the Worker can reach.
- Set Worker vars/secrets accordingly and keep the **API key** out of client bundles.

Without embeddings: full-text / keyword paths still work depending on your schema and API; vector search paths need populated `embedding` column.

## 5. MCP package

- **Published**: install `synapsesync-mcp` and set `SYNAPSE_API_KEY` (API host is fixed in the package; fork and change `API_URL` in `mcp/src/index.ts` if you use your own Worker).
- **Local**: from repo root run `npm install`, then `cd mcp && npm run build`, and point MCP `command` at `node` with `args` at `path/to/mcp/dist/index.js`, or use `npx` after `npm link`.

## 6. Verification checklist

- [ ] Migrations applied; pgvector extension available where required.
- [ ] Worker `/health` or equivalent responds (see `backend/test/api/health.test.ts`).
- [ ] Frontend can sign in and list projects.
- [ ] API key created in UI works with `Authorization: Bearer …`.
- [ ] MCP `tree` / `read` against a test project.

## 7. Fork-specific customization

Replace **routes** and **default CORS / APP_URL** in code or env for your domain. Search the backend for `synapsesync` and production defaults before going live.

For security reporting, see [SECURITY.md](../SECURITY.md).
