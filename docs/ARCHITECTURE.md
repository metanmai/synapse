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

## Claude Code handoff layer

A local-first event log + background daemon sit between Claude Code and the Worker so that work done on one machine can be resumed on another without re-briefing.

```text
Claude Code hooks ──▶ ~/.synapse/projects/<id>/events.jsonl
                                 │
                                 ▼
                       capture daemon (launchd / systemd)
                                 │
                                 ├──▶ Worker (events, briefs, handoffs)
                                 │
                                 └──▶ ~/.synapse/projects/<id>/brief.md
                                                  │
                                                  ▼
                                  injected into next SessionStart
                                  as <synapse-brief>…</synapse-brief>
```

- **Hooks** (`mcp/src/hooks/`) write structured events for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `SessionEnd`, `SubagentStop`. Dispatched by `synapse hook <kind>` (`mcp/src/cli/hook-dispatch.ts`).
- **Daemon** (`mcp/src/capture/daemon.ts`) flushes events to the Worker, refreshes the brief cache, and optionally spawns Claude Code itself for opt-in AI tasks (`daemon.ai_enabled`).
- **Brief** (`mcp/src/capture/handoff-brief.ts`) renders the cached project state into the SessionStart prompt — same shape on every device.

See [docs/superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md](superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md) for the design and [docs/superpowers/plans/2026-05-11-claude-code-handoff-layer.md](superpowers/plans/2026-05-11-claude-code-handoff-layer.md) for the implementation plan.

## CI

GitHub Actions runs `npm install`, `lint`, `typecheck`, and `test` on pushes and PRs to `main` (see `.github/workflows/ci.yml`).
