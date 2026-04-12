# Contributing to Synapse

Thanks for helping improve Synapse. This document describes how we work and what we expect from contributions.

## Before you start

- Read [README.md](README.md) for an overview.
- For production-like setup, see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).
- Security-sensitive reports: use [SECURITY.md](SECURITY.md), not public issues.

## Development setup

1. **Node.js 22** (LTS) is what CI uses; Node 18+ should work locally.
2. Clone the repo and install from the **repository root** only (npm workspaces). This repo does not commit lockfiles — use:

   ```bash
   npm install
   ```

3. Run services locally (see README) once Supabase and Worker secrets are configured for your environment.

## Commands (from repo root)

| Command | Purpose |
|---------|---------|
| `npm run dev:backend` | Cloudflare Worker (API + MCP) via Wrangler |
| `npm run dev:frontend` | SvelteKit dev server |
| `npm run lint` | Biome check |
| `npm run lint:fix` | Biome check with auto-fix |
| `npm run typecheck` | TypeScript across workspaces that define `typecheck` |
| `npm test` | Vitest (backend and any other workspace tests) |

Package-specific shortcuts:

```bash
npm run test -w @synapse/backend
npm run check -w @synapse/frontend
```

## Pull requests

1. **Branch off `main`** with a descriptive name (e.g. `fix/mcp-timeout`, `feat/search-filters`).
2. **Keep changes focused** — one logical concern per PR is easier to review.
3. **Run locally** before pushing:

   ```bash
   npm install
   npm run lint
   npm run typecheck
   npm test
   ```

4. **Describe the PR** clearly: what changed, why, and how to verify (manual steps if needed).
5. **Link issues** when applicable (`Fixes #123`).

We squash-merge by default when that keeps history clean; follow maintainer direction on merge strategy.

## Code style

- **TypeScript** throughout backend, frontend, MCP, and shared package.
- **Biome** is the source of truth for formatting and many lint rules; run `npm run lint:fix` before committing when possible.
- **Svelte** files are not linted by Biome in this repo; rely on `npm run check -w @synapse/frontend` for Svelte/TS diagnostics.

## Tests

- Add or update **Vitest** tests in `backend/test/` when you change behavior that can be exercised in isolation.
- Prefer tests that avoid real network calls and external services (see existing patterns in `backend/test/setup.ts` and worker tests).

## Documentation

- User-facing behavior changes should update **README.md** or **docs/** as appropriate.
- Notable releases should add an entry to **CHANGELOG.md** (see top of file for format).

## Community

- Be respectful; the [Code of Conduct](CODE_OF_CONDUCT.md) applies to all project spaces.

Questions are welcome in issues or discussions (if enabled on the repository).
