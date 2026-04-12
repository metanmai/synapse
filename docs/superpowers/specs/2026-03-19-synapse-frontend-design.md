# Synapse Frontend: Collaborative Context Workspace

## Overview

A React SPA that provides a full workspace UI for Synapse — browse and edit shared context, manage projects and team members, share via links, and track activity. Deployed to Railway, authenticated via Supabase Auth, talks to the existing Cloudflare Worker REST API.

## Goals

- Full workspace for browsing/editing project context (folder tree, inline markdown editor, search)
- Multiple auth methods: email+password, magic link, Google/GitHub OAuth, with account linking
- Share projects via email invites (existing) and shareable links (new)
- Activity feed showing who changed what, with version history and restore
- API key management for connecting AI tools (Claude, ChatGPT)

## Tech Stack

- **React 18 + Vite + TypeScript** — fast dev, lightweight build
- **React Router** — client-side routing
- **Supabase Auth JS** — handles all auth methods client-side (email+password, magic link, OAuth, account linking)
- **TanStack Query** — API data fetching, caching, optimistic updates
- **Tailwind CSS** — utility-first styling
- **Railway** — deployment (static site with SPA fallback)

## Auth Changes (Backend)

### Problem

The backend currently only supports API key auth (Bearer token → SHA-256 hash → user lookup). The frontend needs session-based auth via Supabase Auth JWTs.

### Solution

Support both auth methods in the Worker's auth middleware:

1. **API key path (existing):** `Authorization: Bearer <api_key>` → hash → lookup in `users.api_key_hash`
2. **JWT path (new):** `Authorization: Bearer <supabase_jwt>` → verify JWT signature against Supabase JWT secret → extract `sub` (user UUID) → lookup in `users.supabase_auth_id`

**Detection:** Try JWT verification first (JWTs have a recognizable structure — three dot-separated base64 segments). If it fails, fall back to API key hash lookup.

### Database Changes

**Modify `users` table:**
- Add `supabase_auth_id` (uuid, nullable, unique) — links to `auth.users.id` in Supabase Auth

**Supabase database trigger:** On `auth.users` INSERT, create a matching row in `users` with `supabase_auth_id` set and a generated API key hash. This ensures every Supabase Auth user automatically gets a `users` row.

```sql
create or replace function handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (email, api_key_hash, supabase_auth_id)
  values (new.email, encode(gen_random_bytes(32), 'hex'), new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
```

### API Key Management

Users can generate/regenerate their API key from the `/account` page. The key is shown once and stored as a hash. This is how they connect Claude, ChatGPT, etc.

**New endpoints:**
- `POST /api/account/regenerate-key` — generates a new API key, returns it once, stores hash

## Share Links

### Database

```sql
create table share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  token text unique not null default encode(gen_random_bytes(24), 'hex'),
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references users(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz default now() not null
);

create index share_links_token_idx on share_links(token);
create index share_links_project_idx on share_links(project_id);
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/projects/:id/share-links` | Create a share link (owner/editor only) |
| GET | `/api/projects/:id/share-links` | List active share links (owner/editor only) |
| DELETE | `/api/projects/:id/share-links/:token` | Revoke a share link (owner only) |
| POST | `/api/share/:token/join` | Accept a share link (adds authenticated user as member) |

### Share Link Flow

1. Owner/editor creates a link via project settings → gets URL like `https://app.synapse.dev/share/<token>`
2. Recipient opens the link in the frontend
3. If not logged in → redirected to login, then back to the share link
4. Frontend calls `POST /api/share/:token/join` → backend validates token, checks expiry, adds user as member with the link's role
5. User is redirected to the project workspace

## Activity Log

### Database

```sql
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null check (action in (
    'entry_created', 'entry_updated', 'entry_deleted',
    'member_added', 'member_removed',
    'settings_changed', 'share_link_created', 'share_link_revoked'
  )),
  target_path text,
  target_email text,
  source text not null default 'human' check (source in ('claude', 'chatgpt', 'human', 'google_docs')),
  metadata jsonb,
  created_at timestamptz default now() not null
);

create index activity_log_project_idx on activity_log(project_id, created_at desc);
```

### Integration

Every mutation in the backend (REST routes AND MCP tools) inserts an activity log entry after the operation succeeds. This is a small addition to existing handlers — not a separate system.

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects/:id/activity?limit=50&offset=0` | Paginated activity feed |
| GET | `/api/context/:project/history/:path` | Version history for a specific entry |
| POST | `/api/context/:project/history/:path/restore/:historyId` | Restore entry to a previous version |

## Frontend Pages & Components

### Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/login` | LoginPage | Email+password, magic link, Google/GitHub OAuth |
| `/signup` | SignupPage | Same auth options, creates account |
| `/` | DashboardPage | List of projects, create new project button |
| `/projects/:name` | ProjectWorkspace | Main workspace — folder tree + entry viewer/editor + search |
| `/projects/:name/settings` | ProjectSettings | Members, share links, preferences, Google Drive link |
| `/projects/:name/activity` | ActivityPage | Chronological activity feed |
| `/projects/:name/history/:path` | HistoryPage | Version history for an entry, diff view, restore |
| `/account` | AccountPage | Profile, connected accounts, API key management |
| `/share/:token` | ShareAcceptPage | Handles share link acceptance flow |

### Key Components

**Layout:**
- `AppShell` — top nav (logo, project switcher, user menu), wraps all authenticated pages
- `Sidebar` — project-level nav (workspace, settings, activity)

**Workspace:**
- `FolderTree` — expandable file tree in left panel, shows path/type/tags, click to view
- `EntryViewer` — renders markdown content, shows metadata (author, source, tags, last updated)
- `EntryEditor` — markdown textarea with preview toggle, save/cancel, tag editing
- `SearchPanel` — search input with results list, opens in a slide-over or replaces the main panel
- `NewEntryDialog` — create new entry with path and content type selection

**Sharing & Team:**
- `MemberList` — table of members with role badges, invite form (email + role), remove button
- `ShareLinkManager` — create link (role + optional expiry), list active links, copy URL, revoke
- `InviteDialog` — email input with role selector

**Activity & History:**
- `ActivityFeed` — chronological list with avatar, action description, timestamp, source badge
- `VersionTimeline` — list of past versions with dates, click to view, restore button
- `DiffView` — side-by-side or unified diff of two content versions

**Account:**
- `ConnectedAccounts` — list of linked auth providers, connect/disconnect buttons
- `ApiKeyCard` — shows masked key, regenerate button, copy on generation

### State Management

- **Auth state:** Supabase Auth client manages sessions, stored in context provider
- **Server state:** TanStack Query for all API data (projects, entries, members, activity)
- **No global client state store needed** — TanStack Query handles caching and invalidation

## Frontend Project Structure

```
frontend/
├── src/
│   ├── main.tsx                    # App entry, router setup
│   ├── App.tsx                     # Route definitions, auth guard
│   ├── lib/
│   │   ├── api.ts                  # API client (fetch wrapper with auth headers)
│   │   ├── supabase.ts             # Supabase client init
│   │   └── auth.tsx                # Auth context provider, useAuth hook
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── SignupPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── ProjectWorkspace.tsx
│   │   ├── ProjectSettings.tsx
│   │   ├── ActivityPage.tsx
│   │   ├── HistoryPage.tsx
│   │   ├── AccountPage.tsx
│   │   └── ShareAcceptPage.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── workspace/
│   │   │   ├── FolderTree.tsx
│   │   │   ├── EntryViewer.tsx
│   │   │   ├── EntryEditor.tsx
│   │   │   ├── SearchPanel.tsx
│   │   │   └── NewEntryDialog.tsx
│   │   ├── sharing/
│   │   │   ├── MemberList.tsx
│   │   │   ├── ShareLinkManager.tsx
│   │   │   └── InviteDialog.tsx
│   │   ├── activity/
│   │   │   ├── ActivityFeed.tsx
│   │   │   ├── VersionTimeline.tsx
│   │   │   └── DiffView.tsx
│   │   └── account/
│   │       ├── ConnectedAccounts.tsx
│   │       └── ApiKeyCard.tsx
│   ├── hooks/
│   │   ├── useProjects.ts          # TanStack Query hooks for projects
│   │   ├── useEntries.ts           # TanStack Query hooks for entries
│   │   ├── useMembers.ts           # TanStack Query hooks for members
│   │   └── useActivity.ts          # TanStack Query hooks for activity
│   └── types/
│       └── index.ts                # Shared TypeScript types
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── .env.example                    # VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

## Backend Changes Summary

### New DB tables
- `share_links` — shareable project access tokens
- `activity_log` — who did what, when

### Modified tables
- `users` — add `supabase_auth_id` column

### New endpoints
- `POST /api/account/regenerate-key`
- `POST /api/projects/:id/share-links`
- `GET /api/projects/:id/share-links`
- `DELETE /api/projects/:id/share-links/:token`
- `POST /api/share/:token/join`
- `GET /api/projects/:id/activity`
- `GET /api/context/:project/history/:path`
- `POST /api/context/:project/history/:path/restore/:historyId`

### Modified middleware
- `authMiddleware` — support JWT verification alongside API key auth

### Modified handlers
- All mutation handlers (entry create/update/delete, member add/remove, settings change) — add activity log insert after success

## Deployment

### Railway Setup

Two services in the same Railway project:

1. **Frontend** — Static site, build command: `cd frontend && npm run build`, output: `frontend/dist`, SPA fallback enabled
2. **Worker API** — Remains on Cloudflare Workers (not on Railway). The frontend calls it via `VITE_API_URL`

### Environment Variables (Frontend)

```
VITE_API_URL=https://synapse.<domain>.workers.dev
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### CORS

The Worker needs CORS headers to accept requests from the Railway frontend domain. Add Hono CORS middleware:
```typescript
import { cors } from "hono/cors";
app.use("*", cors({ origin: ["https://app.synapse.dev", "http://localhost:5173"] }));
```
