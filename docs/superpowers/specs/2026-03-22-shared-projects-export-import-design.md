# Shared Projects, Export & Import Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

Three features: (1) GitHub-style project sharing — shared projects appear in the member's project list as `owner/project-name`, (2) export a project as a zip of markdown files, (3) import a Synapse-exported zip into a project.

## Decisions

- **Root-level sharing only** — entire projects are shared, no subfolder-level sharing
- **GitHub-style display** — shared projects show as `owner-email/project-name` in the member's list
- **Roles: owner, editor, viewer** — reuses the existing `project_members` roles
- **Export format: zip of markdown files** — preserves directory structure, YAML frontmatter for metadata, `_synapse_meta.json` for project metadata
- **Import only Synapse exports** — must contain `_synapse_meta.json` to be accepted
- **Import upserts** — existing entries at the same path are updated, not duplicated
- **Import respects tier limits** — rejects if it would exceed the user's file limit
- **Zip library: `fflate`** — lightweight, works in Cloudflare Workers (no Node zlib dependency)

## Feature 1: Project Sharing

### Current state

The backend already has:
- `project_members` table with `(project_id, user_id, role)` — roles: owner, editor, viewer
- `POST /api/projects/:id/members` — add a member by email
- `DELETE /api/projects/:id/members/:email` — remove a member
- `share_links` table — join a project via token
- `POST /api/projects/:id/share-links` — create a share link
- `GET /api/share/:token/join` — join via share link

### What's missing

1. **`GET /api/projects` only returns owned projects.** The query filters by `owner_id = user.id`. It needs to also return projects where the user is a member.

2. **`getProjectByName` only matches owned projects.** All `/api/context/:project/*` routes use this function, which filters by `owner_id`. Members can't access shared projects by name.

3. **No owner attribution in the API response.** The frontend doesn't know who owns a shared project.

### Changes

#### `GET /api/projects` response change

Currently returns: `{ id, name, owner_id, created_at }[]`

New response: `{ id, name, owner_id, owner_email, role, created_at }[]`

- Returns both owned projects (`role: "owner"`) and shared projects (role: "editor" or "viewer")
- `owner_email` is the email of the project owner (for display as `owner/project-name`)
- Ordered by: owned first, then shared, each group by `created_at desc`

#### `getProjectByName` query change

Currently: `SELECT * FROM projects WHERE name = $1 AND owner_id = $2`

New: Look up by name where the user is either the owner OR a member. If there's ambiguity (user owns a project named "foo" and is also a member of someone else's "foo"), prefer the owned one.

To disambiguate, the API also accepts `owner/project-name` format — the MCP tools and frontend can pass the full qualified name. The `getProjectByName` function parses this: if the project param contains `/`, split into `owner_email/name` and look up by both.

#### Frontend changes

- Project list shows `owner/name` for shared projects, just `name` for owned projects
- Shared projects have a badge or label indicating role (editor/viewer)
- No changes needed to the MCP server — it already passes a project name string, which now also accepts `owner/project-name` format

## Feature 2: Export

### Endpoint

`GET /api/projects/:id/export`

- **Auth**: Required. User must be owner or member (any role).
- **Response**: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{project-name}.zip"`

### Zip structure

```
project-name.zip
├── _synapse_meta.json
├── decisions/
│   └── chose-redis.md
├── notes/
│   └── standup-2026-03-22.md
└── context/
    └── session-summaries/
        └── 2026-03-22-stripe-integration.md
```

### `_synapse_meta.json`

```json
{
  "version": 1,
  "project_name": "acme",
  "exported_at": "2026-03-22T14:00:00.000Z",
  "entry_count": 42
}
```

### Entry file format

Each `.md` file includes YAML frontmatter with metadata, followed by the content:

```markdown
---
tags: [decision, infrastructure]
source: claude
content_type: markdown
---

# Chose Redis over Memcached

We decided to use Redis because...
```

If content_type is `json`, the file extension is `.json` and no frontmatter is added (the content is raw JSON).

### Implementation

- Fetch all entries for the project via `getAllEntries(db, projectId)`
- Build zip in memory using `fflate`
- Stream response

### Frontend

- "Export" button on the project page
- Triggers a direct download (navigates to the export URL or uses fetch + blob)

## Feature 3: Import

### Endpoint

`POST /api/projects/:id/import`

- **Auth**: Required. User must be owner or editor.
- **Body**: `multipart/form-data` with a `file` field containing the zip
- **Validation**:
  - File must be a valid zip
  - Must contain `_synapse_meta.json` at the root (rejects non-Synapse exports)
  - `_synapse_meta.json` must have `version: 1`
- **Tier enforcement**: Count current entries + new entries (minus overlaps). If total would exceed the user's file limit, reject with 403.
- **Processing**:
  - Parse each `.md` file: extract YAML frontmatter for tags/source/content_type, remainder is content
  - For `.json` files: content_type is "json", no frontmatter parsing
  - Upsert each entry via the existing `upsertEntry` function
  - Skip `_synapse_meta.json` itself
- **Response**: `{ imported: number, updated: number, skipped: number }`
  - `imported`: new entries created
  - `updated`: existing entries overwritten
  - `skipped`: files that couldn't be parsed

### Implementation

- Parse zip using `fflate`
- Parse YAML frontmatter using a simple regex (no dependency needed — frontmatter is our own format)
- Batch upserts sequentially (not parallel, to avoid DB contention)

### Frontend

- "Import" button on the project page
- File picker that accepts `.zip`
- Shows result summary after import completes

## Dependencies

- Add `fflate` to `backend/package.json` — lightweight zip/unzip that works in Cloudflare Workers

## Files touched

| File | Change |
|------|--------|
| `backend/package.json` | Add `fflate` dependency |
| `backend/src/db/queries/projects.ts` | Update `getProjectByName` and `listProjects` to include shared projects |
| `backend/src/api/projects.ts` | Update `GET /api/projects` response, add export/import endpoints |
| `backend/src/lib/export.ts` | New: zip creation logic |
| `backend/src/lib/import.ts` | New: zip parsing and entry upsert logic |
| `frontend/src/lib/server/api.ts` | Add exportProject, importProject methods |
| `frontend/src/routes/(app)/projects/[name]/+page.svelte` | Add Export/Import buttons |
| `frontend/src/routes/(app)/projects/[name]/+page.server.ts` | Add export/import actions |
| `frontend/src/routes/(app)/+page.svelte` or project list component | Show `owner/name` for shared projects |
