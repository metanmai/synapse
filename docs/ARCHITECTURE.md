# Synapse architecture

High-level map of the monorepo. For setup, see [SELF_HOSTING.md](SELF_HOSTING.md) and the root [README.md](../README.md).

## Packages

| Package | Path | Responsibility |
|---------|------|----------------|
| `@synapse/backend` | `backend/` | Cloudflare Worker: Hono HTTP API, auth, context CRUD, search, sharing, billing hooks, Google sync, MCP-related Durable Object code |
| `@synapse/frontend` | `frontend/` | SvelteKit 5 app: dashboard, projects, entries, account, server-side API proxy via `API_URL` |
| `@synapse/shared` | `packages/shared/` | Shared TypeScript types for API-shaped data |
| `synapsesync-mcp` | `mcp/` | Node MCP server: `ls`, `read`, `write`, `search`, `tree`, `history`, CLI login/signup |

## Request flow (simplified)

```text
Browser ──▶ SvelteKit (cookies / Supabase session)
              │
              └── server load / actions ──▶ Worker (Bearer session or API key)

MCP / curl ──────────────────────────────▶ Worker (Bearer API key)
```

The Worker uses the Supabase **service** client for database operations authorized by your route handlers; the browser uses the **anon** key only via Supabase client patterns in the frontend.

## Data model (conceptual)

- **Users** — aligned with Supabase Auth and app `users` table.
- **Projects** — workspace boundary; entries live under a project.
- **Entries** — path + content (+ optional embedding, tags, history).
- **Sharing** — links and project membership as implemented in `backend/src/api/`.

Exact schemas live in `supabase/migrations/`.

## Search

- **Semantic**: pgvector similarity when embeddings exist; Worker may call an external embedding service.
- **Keyword / full-text**: implemented in backend query modules — see `backend/src/db/` and tests under `backend/test/db/`.

## Embedding service

Optional **Python** sidecar in `embedding-service/` — not required to boot the stack; required for best semantic search results. Configured via Worker env (`EMBEDDING_SERVICE_*`).

## CI

GitHub Actions runs `npm install`, `lint`, `typecheck`, and `test` on pushes and PRs to `main` (see `.github/workflows/ci.yml`).
