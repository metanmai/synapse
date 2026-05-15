# Svelte Frontend Rebuild — Design Spec

**Date**: 2026-03-21
**Status**: Approved
**Goal**: Rebuild the Synapse React frontend as a SvelteKit app with a server-first architecture, warm visual design, and idiomatic Svelte patterns. Primary motivation is learning Svelte/SvelteKit.

## Context

Synapse is a knowledge/context management tool with projects, entries (markdown/JSON), collaboration (members, share links), activity logging, and version history. The backend is a Hono API on Cloudflare Workers with Supabase for auth and database. The backend is untouched — only the frontend is being rebuilt.

### Current Frontend (React)

- React 19, Vite 8, Tailwind CSS 4, React Router 7, TanStack React Query, Supabase JS client
- 9 routes, ~15 components, 4 custom hooks
- Client-side auth via Supabase JS
- All data fetching via client-side fetch with React Query

### What Changes

- React → SvelteKit (Svelte 5)
- Client-side routing → file-based routing
- Client-side data fetching → server-side load functions
- Client-side auth → server-side auth via httpOnly cookies
- React Query → SvelteKit's built-in load/invalidation
- Existing Tailwind styling → warm & approachable redesign

## Architecture

### Framework: SvelteKit (Server-First)

- **Routing**: SvelteKit file-based routes
- **Data loading**: `+page.server.ts` load functions fetch from Hono API server-side
- **Mutations**: SvelteKit form actions with `use:enhance`
- **Auth**: Server-side via `hooks.server.ts`, httpOnly cookies
- **Reactivity**: Svelte 5 runes (`$state`, `$derived`, `$effect`) for UI state
- **Styling**: Tailwind CSS 4

### Project Structure

```
frontend/
├── src/
│   ├── routes/
│   │   ├── +layout.server.ts        # Root layout — redirect to login if no session
│   │   ├── +layout.svelte            # Root HTML wrapper
│   │   ├── login/
│   │   │   ├── +page.server.ts       # Login form action (email/password, OAuth)
│   │   │   └── +page.svelte          # Login UI
│   │   ├── signup/
│   │   │   ├── +page.server.ts       # Signup form action
│   │   │   └── +page.svelte          # Signup UI
│   │   ├── auth/callback/
│   │   │   └── +server.ts            # OAuth callback handler
│   │   ├── share/[token]/
│   │   │   ├── +page.server.ts       # Load: verify token. Action: POST /api/share/:token/join
│   │   │   └── +page.svelte          # Shows loading → success (auto-redirect) → error states
│   │   ├── (app)/                    # Route group: authenticated layout
│   │   │   ├── +layout.server.ts     # Guard auth, load user
│   │   │   ├── +layout.svelte        # AppShell (header, nav)
│   │   │   ├── +page.server.ts       # Load projects list
│   │   │   ├── +page.svelte          # Dashboard
│   │   │   ├── account/
│   │   │   │   ├── +page.server.ts   # Load API key, OAuth status
│   │   │   │   └── +page.svelte      # Account management
│   │   │   └── projects/[name]/
│   │   │       ├── +layout.server.ts  # Load project, verify membership
│   │   │       ├── +layout.svelte     # Project sidebar
│   │   │       ├── +page.server.ts    # Load entries, selected entry, search
│   │   │       ├── +page.svelte       # Workspace
│   │   │       ├── settings/
│   │   │       │   ├── +page.server.ts
│   │   │       │   └── +page.svelte
│   │   │       ├── activity/
│   │   │       │   ├── +page.server.ts
│   │   │       │   └── +page.svelte
│   │   │       └── history/[...path]/
│   │   │           ├── +page.server.ts
│   │   │           └── +page.svelte
│   ├── lib/
│   │   ├── server/
│   │   │   ├── api.ts               # Server-side fetch wrapper for Hono API
│   │   │   └── auth.ts              # JWT verification, session cookie helpers
│   │   └── components/
│   │       ├── layout/
│   │       │   ├── AppShell.svelte
│   │       │   └── Sidebar.svelte
│   │       ├── workspace/
│   │       │   ├── FolderTree.svelte
│   │       │   ├── EntryViewer.svelte
│   │       │   ├── EntryEditor.svelte
│   │       │   └── SearchPanel.svelte
│   │       ├── activity/
│   │       │   ├── ActivityFeed.svelte
│   │       │   └── VersionTimeline.svelte
│   │       ├── sharing/
│   │       │   ├── MemberList.svelte
│   │       │   ├── InviteDialog.svelte
│   │       │   └── ShareLinkManager.svelte
│   │       └── account/
│   │           ├── ApiKeyCard.svelte
│   │           └── ConnectedAccounts.svelte
│   ├── hooks.server.ts              # Auth middleware
│   ├── app.css                      # Tailwind + warm theme CSS custom properties
│   └── app.html                     # HTML template
├── static/
├── svelte.config.js
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Authentication

### Flow

1. **`hooks.server.ts`** runs on every request:
   - Reads `synapse_session` httpOnly cookie (contains Supabase access + refresh tokens)
   - Verifies JWT
   - Sets `event.locals.user` and `event.locals.token`
   - If expired, attempts token refresh via Supabase, updates cookie

2. **Login/Signup** via SvelteKit form actions:
   - **Email/password**: `<form method="POST" action="?/login">` submits credentials
   - **Magic link**: `<form method="POST" action="?/magicLink">` sends OTP email via Supabase, redirects to a "check your email" message
   - Action calls Supabase auth server-side
   - On success: sets httpOnly cookie, `redirect(303, '/')` (or to `?redirect=` URL if present)
   - On failure: `fail(400, { error: '...' })`

3. **OAuth (Google/GitHub)**:
   - Form action generates Supabase OAuth URL, redirects user
   - `/auth/callback/+server.ts` handles the return, sets cookie, redirects to `/`

4. **Route protection** via `(app)/+layout.server.ts`:
   - Checks `event.locals.user`, redirects to `/login?redirect={current_path}` if absent
   - Login action reads `?redirect=` param and redirects there on success (defaults to `/`)

5. **Sign out**: Form action clears cookie, calls Supabase signOut server-side, redirects to `/login`

### Security Properties

- No Supabase JS client in browser
- Auth tokens are httpOnly, secure, SameSite cookies (XSS-proof)
- All API calls happen server-side — tokens never exposed to client

## Data Loading

### Load Functions

Each page fetches data server-side via `+page.server.ts`:

| Route | Load function fetches |
|---|---|
| `/` (Dashboard) | `GET /api/projects` → `{ projects }` |
| `/projects/[name]` (Workspace) | `GET /api/context/:project/list?folder=` (optional folder filter) + optionally `GET /api/context/:project/:path` (if `?path=` param) + optionally `GET /api/context/:project/search?q=` (if `?q=` param) |
| `/projects/[name]/settings` | project data from parent layout + `GET /api/projects/:id/share-links` |
| `/projects/[name]/activity` | `GET /api/projects/:id/activity?limit=50&offset=0` (pagination via `?page=` URL param, mapped to offset) |
| `/projects/[name]/history/[...path]` | `GET /api/context/:project/history/:path` |
| `/account` | No load function — page is form-actions only (regenerate key, connect OAuth) |

### Server-side API Client (`$lib/server/api.ts`)

Thin wrapper around `fetch`:
- Takes `token` from `event.locals.token`
- Reads API base URL from `$env/static/private` (`API_URL`)
- Sets `Authorization: Bearer ${token}` and `Content-Type: application/json`
- Throws typed errors on non-ok responses

### Mutations via Form Actions

All writes use SvelteKit form actions with `use:enhance` for progressive enhancement:

| Page | Action | API Call |
|---|---|---|
| Dashboard | `?/createProject` | `POST /api/projects` |
| Workspace | `?/saveEntry` | `POST /api/context/save` |
| Settings | `?/addMember` | `POST /api/projects/:id/members` |
| Settings | `?/removeMember` | `DELETE /api/projects/:id/members/:email` |
| Settings | `?/createLink` | `POST /api/projects/:id/share-links` |
| Settings | `?/revokeLink` | `DELETE /api/projects/:id/share-links/:token` |
| Account | `?/regenerateKey` | `POST /api/account/regenerate-key` |
| History | `?/restore` | `POST /api/context/:project/restore` |
| Share accept | `?/join` | `POST /api/share/:token/join` |
| Workspace | `?/setPreference` | `PUT /api/projects/preferences/:project` |

After each action, SvelteKit automatically re-runs load functions — no manual cache invalidation.

### Workspace Entry Selection & Search

- Selected entry: `?path=architecture/overview.md` URL param. Clicking an entry in the folder tree is an `<a>` link that sets this param.
- Search: `?q=search+term` URL param. Search form uses GET method to set this param.
- Both are read by the load function and conditionally fetch data server-side.

## Component Architecture

### Svelte 5 Patterns

| Concept | Implementation |
|---|---|
| Component props | `let { prop } = $props()` |
| Local state | `$state()` |
| Computed values | `$derived()` |
| Side effects | `$effect()` |
| List rendering | `{#each items as item}` |
| Conditional rendering | `{#if condition}` |
| Form enhancement | `use:enhance` |
| Active route | `$page.url.pathname` from `$app/stores` |

### Components

**Layout:**
- `AppShell.svelte` — header (logo, user email, sign out form), renders child content via `{@render children()}` (Svelte 5 snippet pattern)
- `Sidebar.svelte` — project navigation links (Workspace, Activity, Settings), highlights active via `$page`

**Workspace:**
- `FolderTree.svelte` — groups entries by folder path, renders `<a>` links setting `?path=` param
- `EntryViewer.svelte` — displays entry content, source badge, tags, timestamps. Edit button toggles editor
- `EntryEditor.svelte` — `<form method="POST" action="?/saveEntry">` with path, content textarea, tags input. Uses `use:enhance`. Handles both new entry creation and editing existing entries (path field is editable for new, read-only for edit)
- `SearchPanel.svelte` — GET form setting `?q=` param. Results rendered from load data

**Workspace interaction model**: The workspace has four modes controlled by URL state:
- **View mode** (default): `?path=some/entry.md` — shows `EntryViewer` in detail panel
- **Edit mode**: `?path=some/entry.md&edit=1` — shows `EntryEditor` pre-filled with entry data
- **New mode**: `?new=1` — shows `EntryEditor` with empty fields for creating a new entry
- **Search mode**: `?q=search+term` — shows `SearchPanel` with results
- **Empty state**: no params — shows a prompt to select or create an entry

Mode transitions are all navigation (links and form redirects), keeping state in the URL.

**Activity:**
- `ActivityFeed.svelte` — `{#each}` over activity entries with action label, source badge, relative timestamp
- `VersionTimeline.svelte` — history versions with content preview, restore `<form>` per entry

**Sharing:**
- `MemberList.svelte` — member rows with role badge, remove `<form>` (hidden for owner role)
- `InviteDialog.svelte` — email input, role `<select>`, invite `<form>`
- `ShareLinkManager.svelte` — create/revoke `<form>`s, copy-to-clipboard button (client-side JS)

**Account:**
- `ApiKeyCard.svelte` — masked/revealed API key, regenerate `<form>` with confirmation
- `ConnectedAccounts.svelte` — OAuth connect buttons (link to OAuth flow)

### Minimal Client-Side JS

Most interactivity is links and forms. Client JS only for:
- Copy-to-clipboard (share links, API key)
- Entry editor toggle (show/hide)
- Textarea auto-resize

## Error Handling & Loading States

### Error handling

- **Load function errors**: Throw `error(status, message)` from `+page.server.ts`. SvelteKit renders `+error.svelte` pages (one at root level for generic errors, one in `(app)` for authenticated error pages).
- **Form action errors**: Return `fail(status, { error: '...' })`. Components render `form?.error` inline next to the relevant form.
- **API client errors**: `$lib/server/api.ts` throws typed errors. Load functions and actions catch and translate to SvelteKit error/fail responses.

### Loading states

- **Initial page loads**: Server-side rendering means pages arrive with data — no loading spinners needed for navigation.
- **Form submissions with `use:enhance`**: Use the `submitting` state from enhance callbacks to show inline loading indicators (e.g., "Saving..." on buttons, "Generating..." on API key regeneration).
- **Navigation between pages**: SvelteKit's built-in `$navigating` store can drive a subtle top-of-page progress bar if desired.

## Visual Design

### Warm & Approachable Theme

Soft palette, rounded corners, generous spacing, friendly personality.

### CSS Custom Properties (in `app.css`)

```css
:root {
  --color-bg:           #faf8f5;
  --color-bg-raised:    #ffffff;
  --color-bg-muted:     #f5f0ea;
  --color-border:       #ebe5dd;
  --color-text:         #3d3327;
  --color-text-muted:   #8a7e72;
  --color-accent:       #e8825e;
  --color-accent-hover: #d6734f;
  --color-success:      #4ade80;
  --color-danger:       #ef4444;
}
```

### Design Tokens

- **Typography**: System font stack, `-0.3px` letter-spacing on headings, `line-height: 1.6` for content
- **Border radius**: 8–10px on cards/containers, 6px on buttons/inputs, 10px on badges/pills
- **Spacing**: 32px page padding, 16px card padding, 24px between sections
- **Borders**: 1px solid `var(--color-border)` — warm, not gray

### Styling Approach

- Tailwind CSS 4 utility classes for most styling
- CSS custom properties for theme consistency
- Svelte scoped `<style>` blocks for component-specific needs (e.g., markdown rendering in entry viewer)
- No component library — just Tailwind + custom properties

## Dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.99.3"
  },
  "devDependencies": {
    "@sveltejs/adapter-auto": "latest",
    "@sveltejs/kit": "latest",
    "@tailwindcss/vite": "^4.2.2",
    "svelte": "^5",
    "tailwindcss": "^4.2.2",
    "typescript": "^5.9.3",
    "vite": "^8.0.1"
  }
}
```

Note: `@supabase/supabase-js` is a runtime dependency used server-side only (in `$lib/server/auth.ts` and form actions) for auth operations. It is never shipped to the browser.

## Environment Variables

```
# Private (server-side only via $env/static/private)
API_URL=http://localhost:8787
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Public (if needed, via $env/static/public)
# None — all API calls are server-side
```

## What's NOT Changing

- Backend (Hono API on Cloudflare Workers) — untouched
- Database schema (Supabase) — untouched
- API contract — frontend consumes the same REST endpoints
- TypeScript types — ported as-is to the Svelte project
