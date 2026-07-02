# Synapse architecture

High-level map of the monorepo. For setup, see [SELF_HOSTING.md](SELF_HOSTING.md) and the root [README.md](../README.md).

## Packages

| Package | Path | Responsibility |
|---------|------|----------------|
| `@synapse/backend` | `backend/` | Cloudflare Worker: Hono HTTP API, auth, context CRUD, search, sharing, billing hooks, MCP-related Durable Object code |
| `@synapse/frontend` | `frontend/` | SvelteKit 5 app: dashboard, projects, entries, account, server-side API proxy via `API_URL` |
| `@synapse/shared` | `packages/shared/` | Shared TypeScript types for API-shaped data |
| `synapsesync` | `mcp/` | Node CLI + capture/handoff daemon; ships a deprecated MCP server exposing only `save_insight` and `list_insights`. CLI subcommands: `init`, `handoff`, `set-focus`, `note`, `issue`, `invite`, `status`, `doctor`, plus the `hook <kind>` dispatcher |

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

## AI session handoff layer

A local-first event log + background daemon sit between your AI coding tool and the Worker so that work done on one machine can be resumed on another without re-briefing. Three capture paths feed the same pipeline:

```text
Claude Code hooks ──┐
File-watcher        │
adapters            ├──▶ ~/.synapse/projects/<id>/events.jsonl
(cline, cursor,     │
 codex, gemini,     │
 roo-code, etc.)    │
Universal proxy     │
(TLS-MITM)          ┘
                                 │
                                 ▼
                       capture daemon (launchd / systemd / Task Scheduler)
                                 │
                                 ├──▶ Worker (events, briefs, handoffs)
                                 │
                                 └──▶ ~/.synapse/projects/<id>/brief.md
                                                  │
                                                  ▼
                                  injected into next SessionStart
                                  as <synapse-brief>…</synapse-brief>
```

- **Events** — every event is a typed record (`packages/shared/src/handoff/events.ts`, `types.ts`) appended to `~/.synapse/projects/<project_id>/events.jsonl`. Project IDs start as `cwd_<sha256-of-cwd-prefix>` placeholders; the backend resolves them to canonical UUIDs on first sync and returns a `canonical_project_ids` mapping the local dispatcher writes back to disk.
- **Hooks** (`mcp/src/hooks/`) write structured events for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `SessionEnd`, `SubagentStop`. Dispatched by `synapse hook <kind>` (`mcp/src/cli/hook-dispatch.ts`).
- **Slash commands & CLI** — `synapse init` installs six slash commands into `~/.claude/commands/synapse/` (`handoff`, `focus`, `issue`, `status`, `doctor`, `invite`). Each command body runs the matching `synapse <cmd>` CLI (`mcp/src/cli/handoff-commands.ts`, `invite.ts`), which appends a typed event and signals the daemon to flush.
- **Daemon** (`mcp/src/capture/daemon.ts`, started via `startHandoffLoop`) batches local events and `POST`s them to the Worker at `/api/events/batch`; the Worker auto-creates a `projects` row on first contact, runs the reducer to materialize a `ProjectStatus`, and the daemon refreshes the brief cache. The daemon can optionally spawn Claude Code itself for opt-in AI tasks (`daemon.ai_enabled`).
- **Reducer & ProjectStatus** — server-side, events are folded into a per-project state document (focus, open issues, recent handoffs, contributors). The brief renderer turns that state into a `<synapse-brief>` block tailored to the viewer.
- **Brief** (`mcp/src/capture/handoff-brief.ts`) renders the cached project state into the SessionStart prompt — same shape on every device.

### Invite flow

`synapse invite <email>` (or `/synapse:invite <email>`) calls `POST /api/projects/:id/invites { email }`, which mints a crypto-random base64url token and returns a join URL. The recipient opens the URL, signs in, and the frontend calls `POST /api/invites/:token/accept` to redeem the token and insert a `project_members` row. From then on, both users see the same brief.

See [docs/superpowers/specs/2026-05-14-handoff-layer-v1.1-design.md](superpowers/specs/2026-05-14-handoff-layer-v1.1-design.md) for the v1.1 design (current shape), [docs/superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md](superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md) for the original v1 design with the full user-flow narrative, and [docs/superpowers/plans/2026-05-14-handoff-layer-v1.1.md](superpowers/plans/2026-05-14-handoff-layer-v1.1.md) for the v1.1 implementation plan.

## CI

GitHub Actions runs `npm install`, `lint`, `typecheck`, and `test` on pushes and PRs to `main` (see `.github/workflows/ci.yml`).
