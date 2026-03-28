# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) where versions apply (the monorepo may use independent versioning per package; the **MCP** npm package has its own `version` in `mcp/package.json`).

## [Unreleased]

### Added

- Open source hygiene: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates, PR template, `docs/SELF_HOSTING.md`, `docs/ARCHITECTURE.md`.
- CI workflow (`npm install`, lint, typecheck, test) on `main` and pull requests.

### Changed

- README: Worker secret name `SUPABASE_SERVICE_KEY` (aligned with code).
- Removed unintended root dependency `get-shit-done-cc`.
- Frontend: `App.Error` optional `detail`; crypto `SubtleCrypto` / `BufferSource` typing; `FolderTree` / project page action types; `SetupGuide` clipboard guard; Biome formatting on touched files.
- Backend: `authMiddleware` return type `Promise<void>` (compatible with Hono + TypeScript).

### MCP package

Publish release notes for **synapsesync-mcp** in [GitHub Releases](https://github.com/tanmain/synapse/releases) or here under a dedicated subsection when you cut npm tags (e.g. `mcp-v*` per `.github/workflows/publish.yml`).

<!-- Example:
## [0.2.0] - 2026-03-01

### Changed

- MCP server migrated to TypeScript (ESM).
-->
