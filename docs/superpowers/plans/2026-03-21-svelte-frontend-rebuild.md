# Svelte Frontend Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the React frontend with an idiomatic SvelteKit app using server-first architecture and a warm visual redesign.

**Architecture:** SvelteKit with file-based routing, server-side load functions and form actions, httpOnly cookie auth, and Tailwind CSS 4 with a warm color theme. The Hono backend is untouched — the new frontend consumes the same REST API.

**Tech Stack:** SvelteKit (Svelte 5), Tailwind CSS 4, `@supabase/supabase-js` (server-side only), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-21-svelte-frontend-rebuild-design.md`

---

## File Map

### New Files (SvelteKit frontend)

```
frontend-svelte/
├── src/
│   ├── app.html                          # HTML template
│   ├── app.css                           # Tailwind + warm theme custom properties
│   ├── app.d.ts                          # TypeScript ambient types (App.Locals)
│   ├── hooks.server.ts                   # Auth middleware — validate cookie, set locals
│   ├── lib/
│   │   ├── types.ts                      # Ported TypeScript interfaces
│   │   ├── server/
│   │   │   ├── api.ts                    # Server-side API client (fetch wrapper)
│   │   │   └── auth.ts                   # Session cookie helpers, JWT verification
│   │   └── components/
│   │       ├── layout/
│   │       │   ├── AppShell.svelte       # Header with logo, user email, sign out
│   │       │   └── Sidebar.svelte        # Project nav (Workspace, Activity, Settings)
│   │       ├── workspace/
│   │       │   ├── FolderTree.svelte     # Entry tree grouped by folder
│   │       │   ├── EntryViewer.svelte    # Read-only entry display
│   │       │   ├── EntryEditor.svelte    # Create/edit entry form
│   │       │   └── SearchPanel.svelte    # Search form + results
│   │       ├── activity/
│   │       │   ├── ActivityFeed.svelte   # Activity log list
│   │       │   └── VersionTimeline.svelte# History versions with restore
│   │       ├── sharing/
│   │       │   ├── MemberList.svelte     # Project members with remove
│   │       │   ├── InviteDialog.svelte   # Invite member form
│   │       │   └── ShareLinkManager.svelte# Create/copy/revoke share links
│   │       └── account/
│   │           ├── ApiKeyCard.svelte     # API key display + regenerate
│   │           └── ConnectedAccounts.svelte# OAuth connect buttons
│   ├── routes/
│   │   ├── +layout.svelte               # Root layout — html wrapper
│   │   ├── +error.svelte                # Root error page
│   │   ├── login/
│   │   │   ├── +page.server.ts          # Login actions (email, magicLink, oauth)
│   │   │   └── +page.svelte             # Login UI
│   │   ├── signup/
│   │   │   ├── +page.server.ts          # Signup action
│   │   │   └── +page.svelte             # Signup UI
│   │   ├── auth/callback/
│   │   │   └── +server.ts               # OAuth callback GET handler
│   │   ├── share/[token]/
│   │   │   ├── +page.server.ts          # Load token validation, join action
│   │   │   └── +page.svelte             # Join UI (loading/success/error)
│   │   ├── logout/
│   │   │   └── +page.server.ts          # Sign out action
│   │   └── (app)/
│   │       ├── +layout.server.ts        # Auth guard, return user
│   │       ├── +layout.svelte           # AppShell wrapper
│   │       ├── +error.svelte            # Authenticated error page
│   │       ├── +page.server.ts          # Load projects
│   │       ├── +page.svelte             # Dashboard
│   │       ├── account/
│   │       │   ├── +page.server.ts      # Account actions (regenerateKey, connectOAuth)
│   │       │   └── +page.svelte         # Account page
│   │       └── projects/[name]/
│   │           ├── +layout.server.ts    # Load project, verify membership
│   │           ├── +layout.svelte       # Project sidebar layout
│   │           ├── +page.server.ts      # Load entries, entry, search
│   │           ├── +page.svelte         # Workspace
│   │           ├── settings/
│   │           │   ├── +page.server.ts  # Load members/links, mutation actions
│   │           │   └── +page.svelte     # Settings page
│   │           ├── activity/
│   │           │   ├── +page.server.ts  # Load activity
│   │           │   └── +page.svelte     # Activity page
│   │           └── history/[...path]/
│   │               ├── +page.server.ts  # Load history, restore action
│   │               └── +page.svelte     # History page
├── static/
│   └── favicon.png
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── package.json
└── .env.example
```

### Existing Files

- `frontend/` — React frontend. Left in place during development, removed in final task.

---

### Task 1: Scaffold SvelteKit Project

**Files:**
- Create: `frontend-svelte/package.json`
- Create: `frontend-svelte/svelte.config.js`
- Create: `frontend-svelte/vite.config.ts`
- Create: `frontend-svelte/tsconfig.json`
- Create: `frontend-svelte/src/app.html`
- Create: `frontend-svelte/src/app.css`
- Create: `frontend-svelte/src/app.d.ts`
- Create: `frontend-svelte/.env.example`

- [ ] **Step 1: Create the SvelteKit project**

Run from repo root:

```bash
npm create svelte@latest frontend-svelte -- --template skeleton --types typescript
```

Select: Skeleton project, TypeScript, no additional options.

- [ ] **Step 2: Install dependencies**

```bash
cd frontend-svelte
npm install @supabase/supabase-js
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: Configure Vite for Tailwind**

`frontend-svelte/vite.config.ts`:
```ts
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
});
```

- [ ] **Step 4: Create app.css with warm theme**

`frontend-svelte/src/app.css`:
```css
@import "tailwindcss";

:root {
  --color-bg: #faf8f5;
  --color-bg-raised: #ffffff;
  --color-bg-muted: #f5f0ea;
  --color-border: #ebe5dd;
  --color-text: #3d3327;
  --color-text-muted: #8a7e72;
  --color-accent: #e8825e;
  --color-accent-hover: #d6734f;
  --color-success: #4ade80;
  --color-danger: #ef4444;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background-color: var(--color-bg);
  color: var(--color-text);
}

h1, h2, h3 {
  letter-spacing: -0.3px;
}
```

- [ ] **Step 5: Create app.html**

`frontend-svelte/src/app.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Synapse</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 6: Create app.d.ts with typed locals**

`frontend-svelte/src/app.d.ts`:
```ts
declare global {
  namespace App {
    interface Locals {
      user: { id: string; email: string } | null;
      token: string | null;
    }
  }
}

export {};
```

- [ ] **Step 7: Create .env.example**

`frontend-svelte/.env.example`:
```
API_URL=http://localhost:8787
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 8: Verify dev server starts**

```bash
cd frontend-svelte && npm run dev
```

Expected: SvelteKit dev server starts on port 5173, shows skeleton page.

- [ ] **Step 9: Commit**

```bash
git add frontend-svelte/
git commit -m "feat: scaffold SvelteKit project with Tailwind warm theme"
```

---

### Task 2: Types & Server-Side API Client

**Files:**
- Create: `frontend-svelte/src/lib/types.ts`
- Create: `frontend-svelte/src/lib/server/api.ts`

- [ ] **Step 1: Port TypeScript interfaces**

`frontend-svelte/src/lib/types.ts`:
```ts
export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  google_drive_folder_id: string | null;
  created_at: string;
  project_members?: ProjectMember[];
}

export interface Entry {
  id: string;
  project_id: string;
  path: string;
  content: string;
  content_type: "markdown" | "json";
  author_id: string | null;
  source: string;
  tags: string[];
  google_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryListItem {
  path: string;
  content_type: string;
  tags: string[];
  updated_at: string;
}

export interface EntryHistory {
  id: string;
  entry_id: string;
  content: string;
  source: string;
  changed_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
  email?: string;
}

export interface ShareLink {
  id: string;
  project_id: string;
  token: string;
  role: "editor" | "viewer";
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  project_id: string;
  user_id: string | null;
  action: string;
  target_path: string | null;
  target_email: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
```

- [ ] **Step 2: Create server-side API client**

`frontend-svelte/src/lib/server/api.ts`:
```ts
import { API_URL } from "$env/static/private";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export function createApi(token: string | null) {
  return {
    // Projects
    listProjects: () => request<import("$lib/types").Project[]>("/api/projects", token),
    createProject: (name: string) =>
      request<import("$lib/types").Project>("/api/projects", token, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),

    // Members
    addMember: (projectId: string, email: string, role: string) =>
      request<import("$lib/types").ProjectMember>(
        `/api/projects/${projectId}/members`,
        token,
        { method: "POST", body: JSON.stringify({ email, role }) },
      ),
    removeMember: (projectId: string, email: string) =>
      request<void>(
        `/api/projects/${projectId}/members/${encodeURIComponent(email)}`,
        token,
        { method: "DELETE" },
      ),

    // Share links
    createShareLink: (projectId: string, role: string, expiresAt?: string) =>
      request<import("$lib/types").ShareLink>(
        `/api/projects/${projectId}/share-links`,
        token,
        { method: "POST", body: JSON.stringify({ role, expires_at: expiresAt }) },
      ),
    listShareLinks: (projectId: string) =>
      request<import("$lib/types").ShareLink[]>(
        `/api/projects/${projectId}/share-links`,
        token,
      ),
    deleteShareLink: (projectId: string, linkToken: string) =>
      request<void>(
        `/api/projects/${projectId}/share-links/${linkToken}`,
        token,
        { method: "DELETE" },
      ),
    joinShareLink: (linkToken: string) =>
      request<{ message: string; role: string }>(
        `/api/share/${linkToken}/join`,
        token,
        { method: "POST" },
      ),

    // Entries
    listEntries: (project: string, folder?: string) =>
      request<import("$lib/types").EntryListItem[]>(
        `/api/context/${encodeURIComponent(project)}/list${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
        token,
      ),
    getEntry: (project: string, path: string) =>
      request<import("$lib/types").Entry>(
        `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`,
        token,
      ),
    saveEntry: (project: string, path: string, content: string, tags?: string[]) =>
      request<import("$lib/types").Entry>("/api/context/save", token, {
        method: "POST",
        body: JSON.stringify({ project, path, content, tags }),
      }),
    searchEntries: (project: string, query: string) =>
      request<import("$lib/types").Entry[]>(
        `/api/context/${encodeURIComponent(project)}/search?q=${encodeURIComponent(query)}`,
        token,
      ),

    // History
    getEntryHistory: (project: string, path: string) =>
      request<import("$lib/types").EntryHistory[]>(
        `/api/context/${encodeURIComponent(project)}/history/${encodeURIComponent(path)}`,
        token,
      ),
    restoreEntry: (project: string, path: string, historyId: string) =>
      request<import("$lib/types").Entry>(
        `/api/context/${encodeURIComponent(project)}/restore`,
        token,
        { method: "POST", body: JSON.stringify({ path, historyId }) },
      ),

    // Activity
    getActivity: (projectId: string, limit = 50, offset = 0) =>
      request<import("$lib/types").ActivityLogEntry[]>(
        `/api/projects/${projectId}/activity?limit=${limit}&offset=${offset}`,
        token,
      ),

    // Account
    regenerateApiKey: () =>
      request<{ api_key: string }>("/api/account/regenerate-key", token, {
        method: "POST",
      }),

    // Preferences
    setPreference: (project: string, key: string, value: string) =>
      request<Record<string, string>>(
        `/api/projects/preferences/${encodeURIComponent(project)}`,
        token,
        { method: "PUT", body: JSON.stringify({ key, value }) },
      ),
  };
}
```

- [ ] **Step 3: Verify types compile**

```bash
cd frontend-svelte && npx svelte-check --tsconfig ./tsconfig.json
```

Expected: No type errors in `types.ts` and `api.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/lib/
git commit -m "feat: add TypeScript types and server-side API client"
```

---

### Task 3: Authentication System

**Files:**
- Create: `frontend-svelte/src/lib/server/auth.ts`
- Create: `frontend-svelte/src/hooks.server.ts`

- [ ] **Step 1: Create auth helpers**

`frontend-svelte/src/lib/server/auth.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "$env/static/private";
import type { Cookies } from "@sveltejs/kit";

const COOKIE_NAME = "synapse_session";

interface SessionData {
  access_token: string;
  refresh_token: string;
}

export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function setSessionCookie(cookies: Cookies, session: SessionData) {
  cookies.set(COOKIE_NAME, JSON.stringify(session), {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export function getSessionCookie(cookies: Cookies): SessionData | null {
  const raw = cookies.get(COOKIE_NAME);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSessionCookie(cookies: Cookies) {
  cookies.delete(COOKIE_NAME, { path: "/" });
}
```

- [ ] **Step 2: Create hooks.server.ts**

`frontend-svelte/src/hooks.server.ts`:
```ts
import type { Handle } from "@sveltejs/kit";
import { getSessionCookie, getSupabase, setSessionCookie } from "$lib/server/auth";

export const handle: Handle = async ({ event, resolve }) => {
  const sessionData = getSessionCookie(event.cookies);

  if (!sessionData) {
    event.locals.user = null;
    event.locals.token = null;
    return resolve(event);
  }

  // Verify the token by getting user from Supabase
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(sessionData.access_token);

  if (error || !data.user) {
    // Try refreshing the token
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession({
        refresh_token: sessionData.refresh_token,
      });

    if (refreshError || !refreshData.session) {
      event.locals.user = null;
      event.locals.token = null;
      return resolve(event);
    }

    // Update cookie with new tokens
    setSessionCookie(event.cookies, {
      access_token: refreshData.session.access_token,
      refresh_token: refreshData.session.refresh_token,
    });

    event.locals.user = {
      id: refreshData.session.user.id,
      email: refreshData.session.user.email!,
    };
    event.locals.token = refreshData.session.access_token;
  } else {
    event.locals.user = { id: data.user.id, email: data.user.email! };
    event.locals.token = sessionData.access_token;
  }

  return resolve(event);
};
```

- [ ] **Step 3: Verify it compiles**

```bash
cd frontend-svelte && npx svelte-check --tsconfig ./tsconfig.json
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/lib/server/auth.ts frontend-svelte/src/hooks.server.ts
git commit -m "feat: add server-side auth with httpOnly cookie sessions"
```

---

### Task 4: Root Layout & Error Pages

**Files:**
- Create: `frontend-svelte/src/routes/+layout.svelte`
- Create: `frontend-svelte/src/routes/+error.svelte`

- [ ] **Step 1: Create root layout**

`frontend-svelte/src/routes/+layout.svelte`:
```svelte
<script>
  import "../app.css";

  let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 2: Create root error page**

`frontend-svelte/src/routes/+error.svelte`:
```svelte
<script>
  import { page } from "$app/stores";
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="text-center">
    <h1 class="text-4xl font-semibold mb-2" style="color: var(--color-text);">
      {$page.status}
    </h1>
    <p style="color: var(--color-text-muted);">{$page.error?.message}</p>
    <a href="/" class="inline-block mt-4 text-sm" style="color: var(--color-accent);">
      Go home
    </a>
  </div>
</div>
```

- [ ] **Step 3: Verify dev server shows root layout**

```bash
cd frontend-svelte && npm run dev
```

Navigate to `http://localhost:5173/`. Expected: blank warm-toned page (no content yet).

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/routes/
git commit -m "feat: add root layout and error page"
```

---

### Task 5: Login Page

**Files:**
- Create: `frontend-svelte/src/routes/login/+page.server.ts`
- Create: `frontend-svelte/src/routes/login/+page.svelte`

- [ ] **Step 1: Create login server actions**

`frontend-svelte/src/routes/login/+page.server.ts`:
```ts
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getSupabase, setSessionCookie } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/");
};

export const actions: Actions = {
  login: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase();
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return fail(400, { error: error.message, email });
    if (!authData.session) return fail(400, { error: "No session returned", email });

    setSessionCookie(cookies, {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    });

    const redirectTo = url.searchParams.get("redirect") || "/";
    redirect(303, redirectTo);
  },

  magicLink: async ({ request }) => {
    const data = await request.formData();
    const email = data.get("email") as string;

    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOtp({ email });

    if (error) return fail(400, { error: error.message, email });

    return { magicLinkSent: true, email };
  },

  oauth: async ({ request, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";
    const redirectTo = url.searchParams.get("redirect") || "/";

    const supabase = getSupabase();
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },
};
```

- [ ] **Step 2: Create login page UI**

`frontend-svelte/src/routes/login/+page.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
  let mode = $state<"password" | "magic">("password");
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="w-full max-w-sm p-8 rounded-xl" style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">

    {#if form?.magicLinkSent}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          We sent a login link to {form.email}
        </p>
      </div>
    {:else}
      <h1 class="text-xl font-semibold mb-6">Sign in to Synapse</h1>

      <div class="space-y-3 mb-6">
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="google" />
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm cursor-pointer"
            style="border: 1px solid var(--color-border); background: var(--color-bg-raised);"
          >
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm cursor-pointer"
            style="border: 1px solid var(--color-border); background: var(--color-bg-raised);"
          >
            Continue with GitHub
          </button>
        </form>
      </div>

      <div class="relative mb-6">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full" style="border-top: 1px solid var(--color-border);"></div>
        </div>
        <div class="relative flex justify-center text-xs">
          <span class="px-2" style="background-color: var(--color-bg-raised); color: var(--color-text-muted);">or</span>
        </div>
      </div>

      {#if mode === "password"}
        <form method="POST" action="?/login" use:enhance class="space-y-4">
          <input type="email" name="email" placeholder="Email" required
            value={form?.email ?? ""}
            class="w-full rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          <input type="password" name="password" placeholder="Password" required
            class="w-full rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
            style="background-color: var(--color-accent);"
          >
            Sign in
          </button>
        </form>
      {:else}
        <form method="POST" action="?/magicLink" use:enhance class="space-y-4">
          <input type="email" name="email" placeholder="Email" required
            value={form?.email ?? ""}
            class="w-full rounded-lg px-3 py-2.5 text-sm"
            style="border: 1px solid var(--color-border);"
          />
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
            style="background-color: var(--color-accent);"
          >
            Send magic link
          </button>
        </form>
      {/if}

      <div class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        <button onclick={() => mode = mode === "password" ? "magic" : "password"}
          class="cursor-pointer" style="color: var(--color-accent);">
          {mode === "password" ? "Use magic link instead" : "Use password instead"}
        </button>
      </div>

      <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        Don't have an account?
        <a href="/signup" style="color: var(--color-accent);">Sign up</a>
      </p>
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Verify login page renders**

Navigate to `http://localhost:5173/login`. Expected: warm-themed login form with Google/GitHub OAuth buttons, email input, password toggle.

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/routes/login/
git commit -m "feat: add login page with email, magic link, and OAuth"
```

---

### Task 6: Signup Page & OAuth Callback

**Files:**
- Create: `frontend-svelte/src/routes/signup/+page.server.ts`
- Create: `frontend-svelte/src/routes/signup/+page.svelte`
- Create: `frontend-svelte/src/routes/auth/callback/+server.ts`

- [ ] **Step 1: Create signup server actions**

`frontend-svelte/src/routes/signup/+page.server.ts`:
```ts
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getSupabase } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/");
};

export const actions: Actions = {
  signup: async ({ request }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase();
    const { error } = await supabase.auth.signUp({ email, password });

    if (error) return fail(400, { error: error.message, email });

    return { success: true, email };
  },

  oauth: async ({ request, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";

    const supabase = getSupabase();
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${url.origin}/auth/callback` },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },
};
```

- [ ] **Step 2: Create signup page UI**

`frontend-svelte/src/routes/signup/+page.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="w-full max-w-sm p-8 rounded-xl" style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">

    {#if form?.success}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          We sent a confirmation link to {form.email}
        </p>
      </div>
    {:else}
      <h1 class="text-xl font-semibold mb-6">Create your account</h1>

      <div class="space-y-3 mb-6">
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="google" />
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm cursor-pointer"
            style="border: 1px solid var(--color-border); background: var(--color-bg-raised);"
          >
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <button type="submit"
            class="w-full rounded-lg px-4 py-2.5 text-sm cursor-pointer"
            style="border: 1px solid var(--color-border); background: var(--color-bg-raised);"
          >
            Continue with GitHub
          </button>
        </form>
      </div>

      <div class="relative mb-6">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full" style="border-top: 1px solid var(--color-border);"></div>
        </div>
        <div class="relative flex justify-center text-xs">
          <span class="px-2" style="background-color: var(--color-bg-raised); color: var(--color-text-muted);">or</span>
        </div>
      </div>

      <form method="POST" action="?/signup" use:enhance class="space-y-4">
        <input type="email" name="email" placeholder="Email" required
          value={form?.email ?? ""}
          class="w-full rounded-lg px-3 py-2.5 text-sm"
          style="border: 1px solid var(--color-border);"
        />
        <input type="password" name="password" placeholder="Password (min 6 characters)"
          required minlength={6}
          class="w-full rounded-lg px-3 py-2.5 text-sm"
          style="border: 1px solid var(--color-border);"
        />
        {#if form?.error}
          <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
        {/if}
        <button type="submit"
          class="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
          style="background-color: var(--color-accent);"
        >
          Create account
        </button>
      </form>

      <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
        Already have an account?
        <a href="/login" style="color: var(--color-accent);">Sign in</a>
      </p>
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Create OAuth callback handler**

`frontend-svelte/src/routes/auth/callback/+server.ts`:
```ts
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSupabase, setSessionCookie } from "$lib/server/auth";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirect") || "/";

  if (!code) redirect(303, "/login?error=missing_code");

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) redirect(303, "/login?error=auth_failed");

  setSessionCookie(cookies, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  redirect(303, redirectTo);
};
```

- [ ] **Step 4: Verify pages render**

Navigate to `http://localhost:5173/signup`. Expected: warm-themed signup form.
Navigate to `http://localhost:5173/login`. Expected: login form still works.

- [ ] **Step 5: Commit**

```bash
git add frontend-svelte/src/routes/signup/ frontend-svelte/src/routes/auth/
git commit -m "feat: add signup page and OAuth callback handler"
```

---

### Task 7: Authenticated Layout (AppShell)

**Files:**
- Create: `frontend-svelte/src/routes/(app)/+layout.server.ts`
- Create: `frontend-svelte/src/routes/(app)/+layout.svelte`
- Create: `frontend-svelte/src/routes/(app)/+error.svelte`
- Create: `frontend-svelte/src/lib/components/layout/AppShell.svelte`

- [ ] **Step 1: Create auth guard layout**

`frontend-svelte/src/routes/(app)/+layout.server.ts`:
```ts
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }
  return { user: locals.user };
};
```

- [ ] **Step 2: Create AppShell component**

`frontend-svelte/src/lib/components/layout/AppShell.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { user, children } = $props<{
    user: { id: string; email: string };
    children: import("svelte").Snippet;
  }>();
</script>

<div class="min-h-screen" style="background-color: var(--color-bg);">
  <header class="px-6 py-3 flex items-center justify-between"
    style="background-color: var(--color-bg-raised); border-bottom: 1px solid var(--color-border);">
    <a href="/" class="text-lg font-semibold" style="color: var(--color-text);">
      synapse
    </a>
    <div class="flex items-center gap-4">
      <span class="text-sm" style="color: var(--color-text-muted);">{user.email}</span>
      <a href="/account" class="text-sm" style="color: var(--color-accent);">Account</a>
      <form method="POST" action="/logout" use:enhance>
        <button type="submit" class="text-sm cursor-pointer"
          style="color: var(--color-text-muted);">
          Sign out
        </button>
      </form>
    </div>
  </header>
  <main>
    {@render children()}
  </main>
</div>
```

- [ ] **Step 3: Create app layout that uses AppShell**

`frontend-svelte/src/routes/(app)/+layout.svelte`:
```svelte
<script>
  import AppShell from "$lib/components/layout/AppShell.svelte";

  let { data, children } = $props();
</script>

<AppShell user={data.user}>
  {@render children()}
</AppShell>
```

- [ ] **Step 4: Create authenticated error page**

`frontend-svelte/src/routes/(app)/+error.svelte`:
```svelte
<script>
  import { page } from "$app/stores";
</script>

<div class="max-w-3xl mx-auto p-8 text-center">
  <h1 class="text-4xl font-semibold mb-2">{$page.status}</h1>
  <p style="color: var(--color-text-muted);">{$page.error?.message}</p>
  <a href="/" class="inline-block mt-4 text-sm" style="color: var(--color-accent);">
    Back to dashboard
  </a>
</div>
```

- [ ] **Step 5: Create logout action**

Create `frontend-svelte/src/routes/logout/+page.server.ts`:
```ts
import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { clearSessionCookie, getSupabase } from "$lib/server/auth";

export const actions: Actions = {
  default: async ({ cookies }) => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    clearSessionCookie(cookies);
    redirect(303, "/login");
  },
};
```

- [ ] **Step 6: Verify layout renders**

Navigate to `http://localhost:5173/`. Expected: redirects to `/login` (no session).

- [ ] **Step 7: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/ frontend-svelte/src/lib/components/layout/AppShell.svelte frontend-svelte/src/routes/logout/
git commit -m "feat: add authenticated layout with AppShell and sign out"
```

---

### Task 8: Dashboard Page

**Files:**
- Create: `frontend-svelte/src/routes/(app)/+page.server.ts`
- Create: `frontend-svelte/src/routes/(app)/+page.svelte`

- [ ] **Step 1: Create dashboard server load + actions**

`frontend-svelte/src/routes/(app)/+page.server.ts`:
```ts
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();
  return { projects };
};

export const actions: Actions = {
  createProject: async ({ request, locals }) => {
    const data = await request.formData();
    const name = (data.get("name") as string)?.trim();

    if (!name) return fail(400, { error: "Project name is required" });

    const api = createApi(locals.token);
    try {
      await api.createProject(name);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to create project" });
    }

    return { success: true };
  },
};
```

- [ ] **Step 2: Create dashboard page UI**

`frontend-svelte/src/routes/(app)/+page.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
  let showCreate = $state(false);
</script>

<div class="max-w-3xl mx-auto p-8">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-semibold">Projects</h1>
      <p class="text-sm mt-1" style="color: var(--color-text-muted);">
        {data.projects.length} project{data.projects.length !== 1 ? "s" : ""}
      </p>
    </div>
    <button onclick={() => showCreate = true}
      class="rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
      style="background-color: var(--color-accent);">
      New Project
    </button>
  </div>

  {#if showCreate}
    <form method="POST" action="?/createProject" use:enhance={() => {
      return async ({ update }) => {
        await update();
        showCreate = false;
      };
    }} class="mb-6 flex gap-2">
      <input type="text" name="name" placeholder="Project name" required autofocus
        class="flex-1 rounded-lg px-3 py-2.5 text-sm"
        style="border: 1px solid var(--color-border);"
      />
      <button type="submit"
        class="rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
        style="background-color: var(--color-accent);">
        Create
      </button>
      <button type="button" onclick={() => showCreate = false}
        class="text-sm cursor-pointer" style="color: var(--color-text-muted);">
        Cancel
      </button>
    </form>
    {#if form?.error}
      <p class="text-sm mb-4" style="color: var(--color-danger);">{form.error}</p>
    {/if}
  {/if}

  {#if data.projects.length === 0}
    <p style="color: var(--color-text-muted);">No projects yet. Create one to get started.</p>
  {:else}
    <div class="space-y-2">
      {#each data.projects as project}
        <a href="/projects/{encodeURIComponent(project.name)}"
          class="block p-4 rounded-xl transition-colors"
          style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
          <div class="font-medium">{project.name}</div>
          <div class="text-sm mt-1" style="color: var(--color-text-muted);">
            Created {new Date(project.created_at).toLocaleDateString()}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Verify (requires auth — just check compile)**

```bash
cd frontend-svelte && npx svelte-check --tsconfig ./tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/+page.server.ts frontend-svelte/src/routes/\(app\)/+page.svelte
git commit -m "feat: add dashboard page with project list and create form"
```

---

### Task 9: Project Layout & Sidebar

**Files:**
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/+layout.server.ts`
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/+layout.svelte`
- Create: `frontend-svelte/src/lib/components/layout/Sidebar.svelte`

- [ ] **Step 1: Create project layout server load**

`frontend-svelte/src/routes/(app)/projects/[name]/+layout.server.ts`:
```ts
import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();
  const project = projects.find((p) => p.name === params.name);

  if (!project) error(404, "Project not found");

  return { project };
};
```

- [ ] **Step 2: Create Sidebar component**

`frontend-svelte/src/lib/components/layout/Sidebar.svelte`:
```svelte
<script lang="ts">
  import { page } from "$app/stores";

  let { projectName } = $props<{ projectName: string }>();

  const links = $derived([
    { href: `/projects/${encodeURIComponent(projectName)}`, label: "Workspace", exact: true },
    { href: `/projects/${encodeURIComponent(projectName)}/settings`, label: "Settings" },
    { href: `/projects/${encodeURIComponent(projectName)}/activity`, label: "Activity" },
  ]);
</script>

<nav class="w-48 p-4 space-y-1"
  style="background-color: var(--color-bg-raised); border-right: 1px solid var(--color-border);">
  {#each links as link}
    {@const isActive = link.exact
      ? $page.url.pathname === link.href
      : $page.url.pathname.startsWith(link.href)}
    <a href={link.href}
      class="block px-3 py-2 rounded-lg text-sm"
      style={isActive
        ? `background-color: var(--color-bg-muted); color: var(--color-accent); font-weight: 500;`
        : `color: var(--color-text); `}
    >
      {link.label}
    </a>
  {/each}
</nav>
```

- [ ] **Step 3: Create project layout**

`frontend-svelte/src/routes/(app)/projects/[name]/+layout.svelte`:
```svelte
<script>
  import Sidebar from "$lib/components/layout/Sidebar.svelte";

  let { data, children } = $props();
</script>

<div class="flex" style="height: calc(100vh - 49px);">
  <Sidebar projectName={data.project.name} />
  <div class="flex-1 overflow-y-auto">
    {@render children()}
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/projects/ frontend-svelte/src/lib/components/layout/Sidebar.svelte
git commit -m "feat: add project layout with sidebar navigation"
```

---

### Task 10: Workspace Page

**Files:**
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/+page.server.ts`
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/+page.svelte`
- Create: `frontend-svelte/src/lib/components/workspace/FolderTree.svelte`
- Create: `frontend-svelte/src/lib/components/workspace/EntryViewer.svelte`
- Create: `frontend-svelte/src/lib/components/workspace/EntryEditor.svelte`
- Create: `frontend-svelte/src/lib/components/workspace/SearchPanel.svelte`

- [ ] **Step 1: Create workspace server load + actions**

`frontend-svelte/src/routes/(app)/projects/[name]/+page.server.ts`:
```ts
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const api = createApi(locals.token);
  const path = url.searchParams.get("path");
  const query = url.searchParams.get("q");
  const edit = url.searchParams.has("edit");
  const isNew = url.searchParams.has("new");

  const entries = await api.listEntries(params.name);

  let entry = null;
  if (path) {
    try {
      entry = await api.getEntry(params.name, path);
    } catch {
      // Entry not found — will show empty state
    }
  }

  let searchResults = null;
  if (query && query.length > 1) {
    searchResults = await api.searchEntries(params.name, query);
  }

  return { entries, entry, searchResults, selectedPath: path, query, edit, isNew };
};

export const actions: Actions = {
  saveEntry: async ({ request, params, locals }) => {
    const data = await request.formData();
    const path = (data.get("path") as string)?.trim();
    const content = data.get("content") as string;
    const tagsRaw = data.get("tags") as string;
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

    if (!path) return fail(400, { error: "Path is required" });

    const api = createApi(locals.token);
    try {
      await api.saveEntry(params.name, path, content, tags);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to save" });
    }

    return { saved: true, savedPath: path };
  },

  setPreference: async ({ request, params, locals }) => {
    const data = await request.formData();
    const key = data.get("key") as string;
    const value = data.get("value") as string;

    const api = createApi(locals.token);
    try {
      await api.setPreference(params.name, key, value);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to save preference" });
    }
    return { preferenceSet: true };
  },
};
```

- [ ] **Step 2: Create FolderTree component**

`frontend-svelte/src/lib/components/workspace/FolderTree.svelte`:
```svelte
<script lang="ts">
  import type { EntryListItem } from "$lib/types";

  let { entries, selectedPath, projectName } = $props<{
    entries: EntryListItem[];
    selectedPath: string | null;
    projectName: string;
  }>();

  function buildTree(items: EntryListItem[]) {
    const tree: Record<string, string[]> = {};
    for (const item of items) {
      const parts = item.path.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
      if (!tree[folder]) tree[folder] = [];
      tree[folder].push(item.path);
    }
    return tree;
  }

  let tree = $derived(buildTree(entries));
  let folders = $derived(Object.keys(tree).sort());
</script>

<div class="text-sm">
  {#each folders as folder}
    <div class="mb-3">
      <div class="font-medium text-xs uppercase tracking-wide px-2 mb-1"
        style="color: var(--color-text-muted);">
        {folder}
      </div>
      {#each tree[folder] as path}
        {@const filename = path.split("/").pop()}
        <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(path)}"
          class="block w-full text-left px-2 py-1.5 rounded-lg text-sm truncate"
          style={selectedPath === path
            ? `background-color: var(--color-bg-muted); color: var(--color-accent); font-weight: 500;`
            : `color: var(--color-text);`}
        >
          {filename}
        </a>
      {/each}
    </div>
  {/each}
  {#if entries.length === 0}
    <p class="text-xs px-2" style="color: var(--color-text-muted);">No entries yet</p>
  {/if}
</div>
```

- [ ] **Step 3: Create EntryViewer component**

`frontend-svelte/src/lib/components/workspace/EntryViewer.svelte`:
```svelte
<script lang="ts">
  import type { Entry } from "$lib/types";

  let { entry, projectName } = $props<{
    entry: Entry;
    projectName: string;
  }>();
</script>

<div>
  <div class="flex items-center justify-between mb-4">
    <div>
      <h2 class="text-lg font-medium">{entry.path}</h2>
      <div class="text-xs mt-1" style="color: var(--color-text-muted);">
        <span class="inline-block rounded-full px-2 py-0.5 text-xs"
          style="background-color: var(--color-bg-muted);">
          {entry.source}
        </span>
        <span class="ml-2">{new Date(entry.updated_at).toLocaleString()}</span>
        {#each entry.tags as tag}
          <span class="ml-1 inline-block rounded-full px-2 py-0.5"
            style="background-color: var(--color-bg-muted);">
            {tag}
          </span>
        {/each}
      </div>
    </div>
    <div class="flex gap-3">
      <a href="/projects/{encodeURIComponent(projectName)}/history/{encodeURIComponent(entry.path)}"
        class="text-sm" style="color: var(--color-text-muted);">
        History
      </a>
      <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(entry.path)}&edit"
        class="text-sm" style="color: var(--color-accent);">
        Edit
      </a>
    </div>
  </div>
  <div class="rounded-xl p-4 whitespace-pre-wrap font-mono text-sm"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border); line-height: 1.6;">
    {entry.content}
  </div>
</div>
```

- [ ] **Step 4: Create EntryEditor component**

`frontend-svelte/src/lib/components/workspace/EntryEditor.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { Entry } from "$lib/types";

  let { entry, projectName, isNew = false } = $props<{
    entry?: Entry | null;
    projectName: string;
    isNew?: boolean;
  }>();
</script>

<form method="POST" action="?/saveEntry" use:enhance={() => {
  return async ({ result, update }) => {
    if (result.type === "success" && result.data?.savedPath) {
      window.location.href = `/projects/${encodeURIComponent(projectName)}?path=${encodeURIComponent(result.data.savedPath)}`;
    } else {
      await update();
    }
  };
}} class="space-y-4">
  {#if isNew}
    <input type="text" name="path" placeholder="Path (e.g., decisions/chose-svelte.md)"
      required autofocus
      class="w-full rounded-lg px-3 py-2.5 text-sm"
      style="border: 1px solid var(--color-border);"
    />
  {:else}
    <input type="hidden" name="path" value={entry?.path ?? ""} />
    <div class="text-sm font-medium" style="color: var(--color-text-muted);">
      Editing: {entry?.path}
    </div>
  {/if}
  <textarea name="content" placeholder="Content (markdown)"
    class="w-full rounded-lg px-3 py-2.5 text-sm font-mono"
    style="border: 1px solid var(--color-border); min-height: 400px; line-height: 1.6;"
  >{entry?.content ?? ""}</textarea>
  <input type="text" name="tags" placeholder="Tags (comma-separated)"
    value={entry?.tags?.join(", ") ?? ""}
    class="w-full rounded-lg px-3 py-2.5 text-sm"
    style="border: 1px solid var(--color-border);"
  />
  <div class="flex gap-2">
    <button type="submit"
      class="rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
      style="background-color: var(--color-accent);">
      Save
    </button>
    <a href="/projects/{encodeURIComponent(projectName)}{entry ? `?path=${encodeURIComponent(entry.path)}` : ''}"
      class="rounded-lg px-4 py-2.5 text-sm cursor-pointer"
      style="color: var(--color-text-muted);">
      Cancel
    </a>
  </div>
</form>
```

- [ ] **Step 5: Create SearchPanel component**

`frontend-svelte/src/lib/components/workspace/SearchPanel.svelte`:
```svelte
<script lang="ts">
  import type { Entry } from "$lib/types";

  let { results, query, projectName } = $props<{
    results: Entry[] | null;
    query: string | null;
    projectName: string;
  }>();
</script>

<div class="space-y-3">
  <form method="GET" class="flex gap-2">
    <input type="text" name="q" placeholder="Search context..." autofocus
      value={query ?? ""}
      class="flex-1 rounded-lg px-3 py-2.5 text-sm"
      style="border: 1px solid var(--color-border);"
    />
    <button type="submit"
      class="rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
      style="background-color: var(--color-accent);">
      Search
    </button>
  </form>

  {#if results}
    {#each results as entry}
      <a href="/projects/{encodeURIComponent(projectName)}?path={encodeURIComponent(entry.path)}"
        class="block rounded-xl p-3 text-sm transition-colors"
        style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
        <div class="font-medium">{entry.path}</div>
        <div class="text-xs mt-1 line-clamp-2" style="color: var(--color-text-muted);">
          {entry.content.slice(0, 150)}
        </div>
      </a>
    {/each}
    {#if results.length === 0}
      <p class="text-sm" style="color: var(--color-text-muted);">No results found</p>
    {/if}
  {/if}
</div>
```

- [ ] **Step 6: Create workspace page**

`frontend-svelte/src/routes/(app)/projects/[name]/+page.svelte`:
```svelte
<script lang="ts">
  import FolderTree from "$lib/components/workspace/FolderTree.svelte";
  import EntryViewer from "$lib/components/workspace/EntryViewer.svelte";
  import EntryEditor from "$lib/components/workspace/EntryEditor.svelte";
  import SearchPanel from "$lib/components/workspace/SearchPanel.svelte";

  let { data, form } = $props();

  let mode = $derived(
    data.query ? "search"
    : data.isNew ? "new"
    : data.edit && data.entry ? "edit"
    : data.entry ? "view"
    : "empty"
  );
</script>

<div class="flex h-full">
  <!-- File tree sidebar -->
  <div class="w-64 p-3 overflow-y-auto"
    style="border-right: 1px solid var(--color-border); background-color: var(--color-bg-raised);">
    <div class="flex items-center justify-between mb-3">
      <span class="text-xs font-medium uppercase tracking-wide"
        style="color: var(--color-text-muted);">Files</span>
      <div class="flex gap-2">
        <a href="/projects/{encodeURIComponent(data.project.name)}?q="
          class="text-xs" style="color: var(--color-text-muted);">Search</a>
        <a href="/projects/{encodeURIComponent(data.project.name)}?new"
          class="text-xs" style="color: var(--color-accent);">+ New</a>
      </div>
    </div>
    <FolderTree entries={data.entries} selectedPath={data.selectedPath}
      projectName={data.project.name} />
  </div>

  <!-- Main content -->
  <div class="flex-1 p-6 overflow-y-auto">
    {#if mode === "search"}
      <SearchPanel results={data.searchResults} query={data.query}
        projectName={data.project.name} />
    {:else if mode === "new"}
      <EntryEditor projectName={data.project.name} isNew />
    {:else if mode === "edit" && data.entry}
      <EntryEditor entry={data.entry} projectName={data.project.name} />
    {:else if mode === "view" && data.entry}
      <EntryViewer entry={data.entry} projectName={data.project.name} />
    {:else}
      <div class="text-center mt-20" style="color: var(--color-text-muted);">
        Select a file or create a new one
      </div>
    {/if}

    {#if form?.error}
      <p class="mt-4 text-sm" style="color: var(--color-danger);">{form.error}</p>
    {/if}
  </div>
</div>
```

- [ ] **Step 7: Verify compile**

```bash
cd frontend-svelte && npx svelte-check --tsconfig ./tsconfig.json
```

- [ ] **Step 8: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/projects/\[name\]/+page.server.ts frontend-svelte/src/routes/\(app\)/projects/\[name\]/+page.svelte frontend-svelte/src/lib/components/workspace/
git commit -m "feat: add workspace page with folder tree, viewer, editor, and search"
```

---

### Task 11: Settings Page

**Files:**
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/settings/+page.server.ts`
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/settings/+page.svelte`
- Create: `frontend-svelte/src/lib/components/sharing/MemberList.svelte`
- Create: `frontend-svelte/src/lib/components/sharing/InviteDialog.svelte`
- Create: `frontend-svelte/src/lib/components/sharing/ShareLinkManager.svelte`

- [ ] **Step 1: Create settings server load + actions**

`frontend-svelte/src/routes/(app)/projects/[name]/settings/+page.server.ts`:
```ts
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const shareLinks = await api.listShareLinks(project.id);
  return { shareLinks };
};

export const actions: Actions = {
  addMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = (data.get("email") as string)?.trim();
    const role = data.get("role") as string;

    if (!email) return fail(400, { inviteError: "Email is required" });

    const api = createApi(locals.token);
    try {
      await api.addMember(projectId, email, role);
    } catch (err) {
      return fail(400, { inviteError: err instanceof Error ? err.message : "Failed to invite" });
    }
    return { invited: true };
  },

  removeMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = data.get("email") as string;

    const api = createApi(locals.token);
    await api.removeMember(projectId, email);
  },

  createLink: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const role = data.get("role") as string;

    const api = createApi(locals.token);
    await api.createShareLink(projectId, role);
  },

  revokeLink: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const token = data.get("token") as string;

    const api = createApi(locals.token);
    await api.deleteShareLink(projectId, token);
  },
};
```

- [ ] **Step 2: Create MemberList component**

`frontend-svelte/src/lib/components/sharing/MemberList.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ProjectMember } from "$lib/types";

  let { members, projectId } = $props<{ members: ProjectMember[]; projectId: string }>();
</script>

<div class="space-y-2">
  {#each members as member}
    <div class="flex items-center justify-between p-3 rounded-xl"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div>
        <span class="text-sm">{member.email ?? member.user_id}</span>
        <span class="ml-2 text-xs rounded-full px-2 py-0.5"
          style="background-color: var(--color-bg-muted);">
          {member.role}
        </span>
      </div>
      {#if member.role !== "owner"}
        <form method="POST" action="?/removeMember" use:enhance>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="email" value={member.email ?? ""} />
          <button type="submit" class="text-xs cursor-pointer"
            style="color: var(--color-danger);">
            Remove
          </button>
        </form>
      {/if}
    </div>
  {/each}
</div>
```

- [ ] **Step 3: Create InviteDialog component**

`frontend-svelte/src/lib/components/sharing/InviteDialog.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { error, projectId } = $props<{ error?: string | null; projectId: string }>();
</script>

<form method="POST" action="?/addMember" use:enhance class="flex gap-2 items-end">
  <input type="hidden" name="projectId" value={projectId} />
  <input type="email" name="email" placeholder="Email address" required
    class="flex-1 rounded-lg px-3 py-2.5 text-sm"
    style="border: 1px solid var(--color-border);"
  />
  <select name="role"
    class="rounded-lg px-3 py-2.5 text-sm"
    style="border: 1px solid var(--color-border);">
    <option value="editor">Editor</option>
    <option value="viewer">Viewer</option>
  </select>
  <button type="submit"
    class="rounded-lg px-4 py-2.5 text-sm font-medium text-white cursor-pointer"
    style="background-color: var(--color-accent);">
    Invite
  </button>
</form>
{#if error}
  <p class="mt-2 text-sm" style="color: var(--color-danger);">{error}</p>
{/if}
```

- [ ] **Step 4: Create ShareLinkManager component**

`frontend-svelte/src/lib/components/sharing/ShareLinkManager.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ShareLink } from "$lib/types";

  let { links, projectId } = $props<{ links: ShareLink[]; projectId: string }>();
  let copied = $state<string | null>(null);

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    copied = token;
    setTimeout(() => (copied = null), 2000);
  }
</script>

<div>
  <div class="flex gap-2 mb-4">
    <form method="POST" action="?/createLink" use:enhance>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="role" value="viewer" />
      <button type="submit" class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Create viewer link
      </button>
    </form>
    <form method="POST" action="?/createLink" use:enhance>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="role" value="editor" />
      <button type="submit" class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Create editor link
      </button>
    </form>
  </div>

  <div class="space-y-2">
    {#each links as link}
      <div class="flex items-center justify-between p-3 rounded-xl text-sm"
        style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
        <div>
          <span class="font-mono text-xs">{link.token.slice(0, 12)}...</span>
          <span class="ml-2 text-xs rounded-full px-2 py-0.5"
            style="background-color: var(--color-bg-muted);">
            {link.role}
          </span>
        </div>
        <div class="flex gap-3">
          <button onclick={() => copyLink(link.token)}
            class="text-xs cursor-pointer" style="color: var(--color-accent);">
            {copied === link.token ? "Copied!" : "Copy"}
          </button>
          <form method="POST" action="?/revokeLink" use:enhance class="inline">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="token" value={link.token} />
            <button type="submit" class="text-xs cursor-pointer"
              style="color: var(--color-danger);">
              Revoke
            </button>
          </form>
        </div>
      </div>
    {/each}
    {#if links.length === 0}
      <p class="text-sm" style="color: var(--color-text-muted);">No share links yet</p>
    {/if}
  </div>
</div>
```

- [ ] **Step 5: Create settings page**

`frontend-svelte/src/routes/(app)/projects/[name]/settings/+page.svelte`:
```svelte
<script>
  import MemberList from "$lib/components/sharing/MemberList.svelte";
  import InviteDialog from "$lib/components/sharing/InviteDialog.svelte";
  import ShareLinkManager from "$lib/components/sharing/ShareLinkManager.svelte";

  let { data, form } = $props();
</script>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-6">Settings — {data.project.name}</h1>

  <section class="mb-8">
    <h2 class="text-lg font-medium mb-3">Members</h2>
    <InviteDialog error={form?.inviteError} projectId={data.project.id} />
    <div class="mt-4">
      <MemberList members={data.project.project_members ?? []} projectId={data.project.id} />
    </div>
  </section>

  <section class="mb-8">
    <h2 class="text-lg font-medium mb-3">Share Links</h2>
    <ShareLinkManager links={data.shareLinks} projectId={data.project.id} />
  </section>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/projects/\[name\]/settings/ frontend-svelte/src/lib/components/sharing/
git commit -m "feat: add settings page with members, invites, and share links"
```

---

### Task 12: Activity Page

**Files:**
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/activity/+page.server.ts`
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/activity/+page.svelte`
- Create: `frontend-svelte/src/lib/components/activity/ActivityFeed.svelte`

- [ ] **Step 1: Create activity server load**

`frontend-svelte/src/routes/(app)/projects/[name]/activity/+page.server.ts`:
```ts
import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ parent, url, locals }) => {
  const { project } = await parent();
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = 50;
  const offset = (page - 1) * limit;

  const api = createApi(locals.token);
  const activity = await api.getActivity(project.id, limit, offset);

  return { activity, page };
};
```

- [ ] **Step 2: Create ActivityFeed component**

`frontend-svelte/src/lib/components/activity/ActivityFeed.svelte`:
```svelte
<script lang="ts">
  import type { ActivityLogEntry } from "$lib/types";

  let { entries } = $props<{ entries: ActivityLogEntry[] }>();

  const actionLabels: Record<string, string> = {
    entry_created: "created",
    entry_updated: "updated",
    entry_deleted: "deleted",
    member_added: "added member",
    member_removed: "removed member",
    settings_changed: "changed settings",
    share_link_created: "created share link",
    share_link_revoked: "revoked share link",
  };
</script>

<div class="space-y-3">
  {#each entries as entry}
    <div class="p-3 rounded-xl text-sm"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div class="flex items-center gap-2">
        <span class="font-medium">{actionLabels[entry.action] ?? entry.action}</span>
        <span class="text-xs rounded-full px-2 py-0.5"
          style="background-color: var(--color-bg-muted);">
          {entry.source}
        </span>
        <span class="text-xs ml-auto" style="color: var(--color-text-muted);">
          {new Date(entry.created_at).toLocaleString()}
        </span>
      </div>
      {#if entry.target_path}
        <div class="text-xs mt-1 font-mono" style="color: var(--color-text-muted);">
          {entry.target_path}
        </div>
      {/if}
      {#if entry.target_email}
        <div class="text-xs mt-1" style="color: var(--color-text-muted);">
          {entry.target_email}
        </div>
      {/if}
    </div>
  {/each}
  {#if entries.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">No activity yet</p>
  {/if}
</div>
```

- [ ] **Step 3: Create activity page**

`frontend-svelte/src/routes/(app)/projects/[name]/activity/+page.svelte`:
```svelte
<script>
  import ActivityFeed from "$lib/components/activity/ActivityFeed.svelte";

  let { data } = $props();
</script>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-6">Activity — {data.project.name}</h1>
  <ActivityFeed entries={data.activity} />

  {#if data.activity.length >= 50}
    <div class="mt-6 flex gap-2 justify-center">
      {#if data.page > 1}
        <a href="?page={data.page - 1}" class="text-sm px-3 py-1.5 rounded-lg"
          style="border: 1px solid var(--color-border);">
          Previous
        </a>
      {/if}
      <a href="?page={data.page + 1}" class="text-sm px-3 py-1.5 rounded-lg"
        style="border: 1px solid var(--color-border);">
        Next
      </a>
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/projects/\[name\]/activity/ frontend-svelte/src/lib/components/activity/ActivityFeed.svelte
git commit -m "feat: add activity page with paginated feed"
```

---

### Task 13: History Page

**Files:**
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/history/[...path]/+page.server.ts`
- Create: `frontend-svelte/src/routes/(app)/projects/[name]/history/[...path]/+page.svelte`
- Create: `frontend-svelte/src/lib/components/activity/VersionTimeline.svelte`

- [ ] **Step 1: Create history server load + actions**

`frontend-svelte/src/routes/(app)/projects/[name]/history/[...path]/+page.server.ts`:
```ts
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ params, locals }) => {
  const api = createApi(locals.token);
  const history = await api.getEntryHistory(params.name, params.path);
  return { history, entryPath: params.path };
};

export const actions: Actions = {
  restore: async ({ request, params, locals }) => {
    const data = await request.formData();
    const historyId = data.get("historyId") as string;

    const api = createApi(locals.token);
    try {
      await api.restoreEntry(params.name, params.path, historyId);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to restore" });
    }

    return { restored: true };
  },
};
```

- [ ] **Step 2: Create VersionTimeline component**

`frontend-svelte/src/lib/components/activity/VersionTimeline.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import type { EntryHistory } from "$lib/types";

  let { versions } = $props<{ versions: EntryHistory[] }>();
</script>

<div class="space-y-3">
  {#each versions as version}
    <div class="p-4 rounded-xl"
      style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs" style="color: var(--color-text-muted);">
          {new Date(version.changed_at).toLocaleString()} ·
          <span class="rounded-full px-2 py-0.5"
            style="background-color: var(--color-bg-muted);">
            {version.source}
          </span>
        </div>
        <form method="POST" action="?/restore" use:enhance>
          <input type="hidden" name="historyId" value={version.id} />
          <button type="submit" class="text-xs cursor-pointer"
            style="color: var(--color-accent);">
            Restore this version
          </button>
        </form>
      </div>
      <pre class="text-xs font-mono rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto"
        style="background-color: var(--color-bg-muted); line-height: 1.6;"
      >{version.content}</pre>
    </div>
  {/each}
  {#if versions.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">No version history</p>
  {/if}
</div>
```

- [ ] **Step 3: Create history page**

`frontend-svelte/src/routes/(app)/projects/[name]/history/[...path]/+page.svelte`:
```svelte
<script>
  import VersionTimeline from "$lib/components/activity/VersionTimeline.svelte";

  let { data } = $props();
</script>

<div class="max-w-3xl p-6">
  <h1 class="text-xl font-semibold mb-2">Version History</h1>
  <p class="text-sm font-mono mb-6" style="color: var(--color-text-muted);">
    {data.entryPath}
  </p>
  <VersionTimeline versions={data.history} />
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/projects/\[name\]/history/ frontend-svelte/src/lib/components/activity/VersionTimeline.svelte
git commit -m "feat: add history page with version timeline and restore"
```

---

### Task 14: Account Page

**Files:**
- Create: `frontend-svelte/src/routes/(app)/account/+page.server.ts`
- Create: `frontend-svelte/src/routes/(app)/account/+page.svelte`
- Create: `frontend-svelte/src/lib/components/account/ApiKeyCard.svelte`
- Create: `frontend-svelte/src/lib/components/account/ConnectedAccounts.svelte`

- [ ] **Step 1: Create account server actions**

`frontend-svelte/src/routes/(app)/account/+page.server.ts`:
```ts
import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { createApi } from "$lib/server/api";
import { getSupabase } from "$lib/server/auth";

export const actions: Actions = {
  regenerateKey: async ({ locals }) => {
    const api = createApi(locals.token);
    try {
      const result = await api.regenerateApiKey();
      return { apiKey: result.api_key };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to generate key" });
    }
  },

  connectOAuth: async ({ request, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";

    const supabase = getSupabase();
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${url.origin}/auth/callback?redirect=/account` },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },
};
```

- [ ] **Step 2: Create ApiKeyCard component**

`frontend-svelte/src/lib/components/account/ApiKeyCard.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { apiKey, error } = $props<{ apiKey?: string | null; error?: string | null }>();
</script>

<div class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
  <h3 class="font-medium mb-2">API Key</h3>
  <p class="text-sm mb-3" style="color: var(--color-text-muted);">
    Use this key to connect Claude, ChatGPT, or other AI tools.
  </p>
  {#if apiKey}
    <div class="rounded-lg p-3 font-mono text-sm break-all mb-3"
      style="background-color: var(--color-bg-muted);">
      {apiKey}
    </div>
  {:else}
    <div class="rounded-lg p-3 font-mono text-sm mb-3"
      style="background-color: var(--color-bg-muted); color: var(--color-text-muted);">
      ••••••••••••••••
    </div>
  {/if}
  <form method="POST" action="?/regenerateKey" use:enhance>
    <button type="submit" class="rounded-lg px-3 py-2 text-sm cursor-pointer"
      style="border: 1px solid var(--color-border);">
      {apiKey ? "Regenerate" : "Generate API Key"}
    </button>
  </form>
  {#if apiKey}
    <p class="text-xs mt-2" style="color: var(--color-accent);">
      Save this key now — it won't be shown again.
    </p>
  {/if}
  {#if error}
    <p class="text-xs mt-2" style="color: var(--color-danger);">{error}</p>
  {/if}
</div>
```

- [ ] **Step 3: Create ConnectedAccounts component**

`frontend-svelte/src/lib/components/account/ConnectedAccounts.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
</script>

<div class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
  <h3 class="font-medium mb-3">Connected Accounts</h3>
  <div class="space-y-2">
    <form method="POST" action="?/connectOAuth" use:enhance>
      <input type="hidden" name="provider" value="google" />
      <button type="submit" class="w-full text-left rounded-lg px-4 py-2.5 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Link Google Account
      </button>
    </form>
    <form method="POST" action="?/connectOAuth" use:enhance>
      <input type="hidden" name="provider" value="github" />
      <button type="submit" class="w-full text-left rounded-lg px-4 py-2.5 text-sm cursor-pointer"
        style="border: 1px solid var(--color-border);">
        Link GitHub Account
      </button>
    </form>
  </div>
</div>
```

- [ ] **Step 4: Create account page**

`frontend-svelte/src/routes/(app)/account/+page.svelte`:
```svelte
<script>
  import ApiKeyCard from "$lib/components/account/ApiKeyCard.svelte";
  import ConnectedAccounts from "$lib/components/account/ConnectedAccounts.svelte";

  let { data, form } = $props();
</script>

<div class="max-w-2xl mx-auto p-8">
  <h1 class="text-2xl font-semibold mb-6">Account</h1>
  <div class="mb-4 text-sm" style="color: var(--color-text-muted);">
    Signed in as {data.user.email}
  </div>
  <div class="space-y-6">
    <ApiKeyCard apiKey={form?.apiKey} error={form?.error} />
    <ConnectedAccounts />
  </div>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add frontend-svelte/src/routes/\(app\)/account/ frontend-svelte/src/lib/components/account/
git commit -m "feat: add account page with API key and OAuth connections"
```

---

### Task 15: Share Accept Page

**Files:**
- Create: `frontend-svelte/src/routes/share/[token]/+page.server.ts`
- Create: `frontend-svelte/src/routes/share/[token]/+page.svelte`

- [ ] **Step 1: Create share accept server load + action**

`frontend-svelte/src/routes/share/[token]/+page.server.ts`:
```ts
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(303, `/login?redirect=/share/${params.token}`);
  }
  return { token: params.token };
};

export const actions: Actions = {
  join: async ({ params, locals }) => {
    const api = createApi(locals.token);
    try {
      const result = await api.joinShareLink(params.token);
      return { success: true, role: result.role };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to join" });
    }
  },
};
```

- [ ] **Step 2: Create share accept page UI**

`frontend-svelte/src/routes/share/[token]/+page.svelte`:
```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";

  let { form } = $props();

  $effect(() => {
    if (form?.success) {
      setTimeout(() => goto("/"), 2000);
    }
  });
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div class="max-w-sm w-full p-8 rounded-xl text-center"
    style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);">
    {#if form?.success}
      <p style="color: var(--color-success);">Joined! Redirecting to dashboard...</p>
    {:else if form?.error}
      <p style="color: var(--color-danger);">{form.error}</p>
      <a href="/" class="inline-block mt-4 text-sm" style="color: var(--color-accent);">
        Go to dashboard
      </a>
    {:else}
      <p class="mb-4" style="color: var(--color-text-muted);">
        You've been invited to join a project.
      </p>
      <form method="POST" action="?/join" use:enhance>
        <button type="submit"
          class="rounded-lg px-6 py-2.5 text-sm font-medium text-white cursor-pointer"
          style="background-color: var(--color-accent);">
          Accept Invite
        </button>
      </form>
    {/if}
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend-svelte/src/routes/share/
git commit -m "feat: add share accept page with join flow"
```

---

### Task 16: Final Verification & Cleanup

**Files:**
- Delete: `frontend/` (old React app)
- Rename: `frontend-svelte/` → `frontend/`

- [ ] **Step 1: Run type check on entire project**

```bash
cd frontend-svelte && npx svelte-check --tsconfig ./tsconfig.json
```

Expected: No type errors.

- [ ] **Step 2: Run dev server and manually verify each page**

```bash
cd frontend-svelte && npm run dev
```

Verify in browser:
- `/login` — renders login form with OAuth, email/password, magic link toggle
- `/signup` — renders signup form
- `/` — redirects to `/login` (no session)
- All routes have warm color theme applied

- [ ] **Step 3: Run production build**

```bash
cd frontend-svelte && npm run build
```

Expected: Build completes without errors.

- [ ] **Step 4: Remove old React frontend and rename**

```bash
rm -rf frontend
mv frontend-svelte frontend
```

- [ ] **Step 5: Verify renamed project still works**

```bash
cd frontend && npm run dev
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: replace React frontend with SvelteKit

Complete rewrite of the Synapse frontend from React 19 to SvelteKit (Svelte 5)
with server-first architecture:

- File-based routing replacing React Router
- Server-side load functions replacing React Query
- Form actions replacing client-side mutations
- httpOnly cookie auth replacing client-side Supabase tokens
- Warm & approachable visual redesign with Tailwind CSS 4
- All 9 original pages ported with feature parity"
```
