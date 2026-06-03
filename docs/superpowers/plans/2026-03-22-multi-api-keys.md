# Multi API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `api_key_hash` column on users with a dedicated `api_keys` table supporting up to 10 keys per user, with labels, optional expiry, last-used tracking, and individual revocation.

**Architecture:** A new `api_keys` table stores key hashes with metadata. Auth middleware queries this table instead of users. The account page gets a new `ApiKeysCard` component showing all keys with create/revoke controls.

**Tech Stack:** Hono (backend), Supabase PostgreSQL, SvelteKit 5 (frontend)

**Spec:** `docs/superpowers/specs/2026-03-22-multi-api-keys-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/004_multi_api_keys.sql` | New: api_keys table, migrate existing hashes, drop api_key_hash |
| `backend/src/db/types.ts` | Modify: remove `api_key_hash` from User, add `ApiKey` interface |
| `backend/src/db/queries/api-keys.ts` | New: CRUD for api_keys table |
| `backend/src/db/queries/users.ts` | Modify: remove `findUserByApiKeyHash`, update `createUser` signature |
| `backend/src/db/queries/index.ts` | Modify: re-export api-keys |
| `backend/src/lib/auth.ts` | Modify: API key lookup queries api_keys, checks expiry, updates last_used_at |
| `backend/src/api/auth.ts` | Modify: update signup, replace regenerate-key with key management endpoints |
| `backend/src/mcp/agent.ts` | Modify: update `findUserByApiKeyHash` call for new return signature |
| `frontend/src/lib/server/api.ts` | Modify: replace regenerateApiKey with listApiKeys, createApiKey, revokeApiKey |
| `frontend/src/lib/components/account/ApiKeysCard.svelte` | New: replaces ApiKeyCard.svelte |
| `frontend/src/lib/components/account/ApiKeyCard.svelte` | Delete |
| `frontend/src/routes/(app)/account/+page.svelte` | Modify: import ApiKeysCard |
| `frontend/src/routes/(app)/account/+page.server.ts` | Modify: load keys, add createKey/revokeKey actions |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/004_multi_api_keys.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- New api_keys table
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key_hash text unique not null,
  label text not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

create index idx_api_keys_user_id on api_keys(user_id);
create index idx_api_keys_key_hash on api_keys(key_hash);

-- RLS (defense-in-depth; Worker uses service key which bypasses RLS)
alter table api_keys enable row level security;

create policy "api_keys_read_own" on api_keys for select
  using (user_id = auth.uid());

create policy "api_keys_delete_own" on api_keys for delete
  using (user_id = auth.uid());

-- Migrate existing keys from users table
insert into api_keys (user_id, key_hash, label)
select id, api_key_hash, 'default'
from users
where api_key_hash is not null;

-- Drop the old column
alter table users drop column api_key_hash;
```

- [ ] **Step 2: Verify migration file**

Run: `cat supabase/migrations/004_multi_api_keys.sql`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/004_multi_api_keys.sql
git commit -m "feat: add api_keys table migration, migrate existing hashes"
```

---

### Task 2: Types and Query Layer

**Files:**
- Modify: `backend/src/db/types.ts`
- Create: `backend/src/db/queries/api-keys.ts`
- Modify: `backend/src/db/queries/users.ts`
- Modify: `backend/src/db/queries/index.ts`

- [ ] **Step 1: Update `backend/src/db/types.ts`**

Remove `api_key_hash` from the `User` interface:

```typescript
export interface User {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}
```

Add after `Subscription`:

```typescript
export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Create `backend/src/db/queries/api-keys.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User, ApiKey } from "../types";

export class ApiKeyExpiredError extends Error {
  constructor() {
    super("API key has expired");
    this.name = "ApiKeyExpiredError";
  }
}

export async function findUserByApiKeyHash(
  db: SupabaseClient,
  keyHash: string
): Promise<{ user: User; apiKeyId: string } | null> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, expires_at, users(*)")
    .eq("key_hash", keyHash)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.users) return null;

  // Check expiry — throw specific error so auth middleware can surface it
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new ApiKeyExpiredError();
  }

  return { user: data.users as unknown as User, apiKeyId: data.id };
}

export async function createApiKey(
  db: SupabaseClient,
  userId: string,
  keyHash: string,
  label: string,
  expiresAt?: string | null
): Promise<ApiKey> {
  const { data, error } = await db
    .from("api_keys")
    .insert({
      user_id: userId,
      key_hash: keyHash,
      label,
      expires_at: expiresAt ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as ApiKey;
}

export async function listApiKeys(
  db: SupabaseClient,
  userId: string
): Promise<Omit<ApiKey, "key_hash">[]> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, label, expires_at, last_used_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Omit<ApiKey, "key_hash">[];
}

export async function deleteApiKey(
  db: SupabaseClient,
  keyId: string,
  userId: string
): Promise<boolean> {
  const { error, count } = await db
    .from("api_keys")
    .delete({ count: "exact" })
    .eq("id", keyId)
    .eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function countApiKeys(
  db: SupabaseClient,
  userId: string
): Promise<number> {
  const { count, error } = await db
    .from("api_keys")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) throw error;
  return count ?? 0;
}

export async function updateApiKeyLastUsed(
  db: SupabaseClient,
  keyId: string
): Promise<void> {
  await db
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyId);
  // Fire-and-forget — don't throw on error
}
```

- [ ] **Step 3: Update `backend/src/db/queries/users.ts`**

Remove the `findUserByApiKeyHash` function entirely (it's now in `api-keys.ts`).

Update `createUser` to remove the `apiKeyHash` parameter:

```typescript
export async function createUser(
  db: SupabaseClient,
  email: string
): Promise<User> {
  const { data, error } = await db
    .from("users")
    .insert({ email })
    .select()
    .single();

  if (error) throw error;
  return data as User;
}
```

Keep `findUserByEmail`, `findUserBySupabaseAuthId`, and `updateStripeCustomerId` unchanged.

Remove the `singleOrNull` import if it's no longer used in this file (check — `findUserByEmail` and `findUserBySupabaseAuthId` still use it, so keep it).

- [ ] **Step 4: Add re-export to `backend/src/db/queries/index.ts`**

Add:

```typescript
export * from "./api-keys";
```

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

Expect errors in `auth.ts` (API) and `auth.ts` (lib) since they still reference old patterns. Fixed in Tasks 3-4.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/types.ts backend/src/db/queries/api-keys.ts backend/src/db/queries/users.ts backend/src/db/queries/index.ts
git commit -m "feat: add ApiKey type and api-keys query module"
```

---

### Task 3: Auth Middleware Update

**Files:**
- Modify: `backend/src/lib/auth.ts`

- [ ] **Step 1: Update `backend/src/lib/auth.ts`**

The import changes: `findUserByApiKeyHash` now comes from `api-keys.ts` (re-exported via index) and returns `{ user, apiKeyId }` instead of just `User`. Add `updateApiKeyLastUsed` import.

Replace the full file:

```typescript
import { Context, Next } from "hono";

import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash, updateApiKeyLastUsed, ApiKeyExpiredError } from "../db/queries";
import { findUserBySupabaseAuthId, getActiveSubscription } from "../db/queries";
import { UnauthorizedError } from "./errors";

import type { Env } from "./env";
import type { User } from "../db/types";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    tier: import("../db/types").Tier;
  }
}

export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = authHeader.slice(7);
  const db = createSupabaseClient(c.env);
  let user: User | null = null;

  // Try JWT by verifying with Supabase auth
  if (isJwt(token)) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      console.error("[auth] Supabase getUser failed:", authError.message);
    } else if (data?.user) {
      user = await findUserBySupabaseAuthId(db, data.user.id);
      if (!user) {
        console.error(`[auth] Auth user found (${data.user.id}, ${data.user.email}) but no matching row in public.users. Run the migration or insert manually.`);
      }
    } else {
      console.warn("[auth] JWT provided but Supabase returned no user");
    }
  }

  // Fall back to API key
  if (!user) {
    const apiKeyHash = await hashApiKey(token);
    try {
      const result = await findUserByApiKeyHash(db, apiKeyHash);
      if (result) {
        user = result.user;
        // Update last_used_at (fire-and-forget)
        updateApiKeyLastUsed(db, result.apiKeyId);
      } else if (!isJwt(token)) {
        console.warn("[auth] API key provided but no matching key found");
      }
    } catch (err) {
      if (err instanceof ApiKeyExpiredError) {
        throw new UnauthorizedError("API key has expired");
      }
      throw err;
    }
  }

  if (!user) {
    throw new UnauthorizedError();
  }

  c.set("user", user);

  // Resolve tier from subscription status
  const sub = await getActiveSubscription(db, user.id);
  const tier = (sub?.status === "active" || sub?.status === "past_due") ? "pro" : "free";
  c.set("tier", tier);

  await next();
}
```

- [ ] **Step 2: Update `backend/src/mcp/agent.ts`**

The MCP agent also calls `findUserByApiKeyHash` with the old signature. Update lines 40-43:

Change:
```typescript
const user = await findUserByApiKeyHash(db, apiKeyHash);
if (user) {
  this.userId = user.id;
}
```

To:
```typescript
const result = await findUserByApiKeyHash(db, apiKeyHash);
if (result) {
  this.userId = result.user.id;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

Expect errors only in `backend/src/api/auth.ts` (still references old createUser signature and regenerate-key). Fixed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/auth.ts backend/src/mcp/agent.ts
git commit -m "refactor: auth middleware and MCP agent query api_keys table, track last_used_at"
```

---

### Task 4: Backend API — Signup and Key Management Endpoints

**Files:**
- Modify: `backend/src/api/auth.ts`

- [ ] **Step 1: Replace `backend/src/api/auth.ts`**

Replace the full file. Key changes:
- Signup uses `createUser(db, email)` then `createApiKey(db, userId, keyHash, "default")`
- Remove `regenerate-key` endpoint
- Add `POST /keys`, `GET /keys`, `DELETE /keys/:id` on the `account` router

```typescript
import { Hono } from "hono";

import { createSupabaseClient } from "../db/client";
import { createUser, findUserByEmail, createApiKey, listApiKeys, deleteApiKey, countApiKeys } from "../db/queries";
import { hashApiKey, authMiddleware } from "../lib/auth";
import { AppError, ConflictError } from "../lib/errors";

import type { Env } from "../lib/env";

const auth = new Hono<{ Bindings: Env }>();

auth.post("/signup", async (c) => {
  const body = await c.req.json<{ email?: string }>();

  if (!body.email || typeof body.email !== "string") {
    throw new AppError("Email is required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const existing = await findUserByEmail(db, body.email);
  if (existing) {
    throw new ConflictError("User with this email already exists");
  }

  const user = await createUser(db, body.email);

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "default");

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey,
  }, 201);
});

// Google OAuth connect flow — requires auth so we know which user to link
auth.get("/google/connect", authMiddleware, async (c) => {
  const user = c.get("user");
  const redirectUri = new URL("/auth/google/callback", c.req.url).href;
  const state = btoa(JSON.stringify({ userId: user.id }));
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  if (!code) throw new AppError("Missing code parameter", 400, "VALIDATION_ERROR");
  if (!stateParam) throw new AppError("Missing state parameter", 400, "VALIDATION_ERROR");

  const { userId } = JSON.parse(atob(stateParam));
  const redirectUri = new URL("/auth/google/callback", c.req.url).href;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  interface GoogleTokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  }
  const tokens = await tokenRes.json() as GoogleTokenResponse;
  if (!tokens.access_token) {
    throw new AppError("Failed to exchange code for tokens", 400, "OAUTH_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const { error } = await db
    .from("users")
    .update({
      google_oauth_tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      },
    })
    .eq("id", userId);

  if (error) throw error;

  return c.json({
    message: "Google account connected successfully.",
    note: "Use set_preference to link a Google Drive folder to your project.",
  });
});

export { auth };

// Account routes — mounted at /api/account in index.ts
export const account = new Hono<{ Bindings: Env }>();
account.use("*", authMiddleware);

// POST /api/account/keys — create a new API key
account.post("/keys", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ label?: string; expires_at?: string | null }>();

  if (!body.label || typeof body.label !== "string" || !body.label.trim()) {
    throw new AppError("label is required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);

  const keyCount = await countApiKeys(db, user.id);
  if (keyCount >= 10) {
    throw new AppError("API key limit reached (10). Revoke an existing key first.", 400, "KEY_LIMIT");
  }

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);

  const created = await createApiKey(db, user.id, apiKeyHash, body.label.trim(), body.expires_at);

  return c.json({
    id: created.id,
    label: created.label,
    api_key: apiKey,
    expires_at: created.expires_at,
    created_at: created.created_at,
  }, 201);
});

// GET /api/account/keys — list all keys
account.get("/keys", async (c) => {
  const user = c.get("user");
  const db = createSupabaseClient(c.env);
  const keys = await listApiKeys(db, user.id);
  return c.json(keys);
});

// DELETE /api/account/keys/:id — revoke a key
account.delete("/keys/:id", async (c) => {
  const user = c.get("user");
  const keyId = c.req.param("id");
  const db = createSupabaseClient(c.env);

  const deleted = await deleteApiKey(db, keyId, user.id);
  if (!deleted) {
    throw new AppError("API key not found", 404, "NOT_FOUND");
  }

  return c.json({ ok: true });
});
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

Should be clean in src/ files.

- [ ] **Step 3: Run tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

Some existing tests may need updates if they mock `findUserByApiKeyHash` or `createUser` with the old signatures. Fix any failures.

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/auth.ts
git commit -m "feat: replace regenerate-key with multi-key management endpoints"
```

---

### Task 5: Frontend — API Methods and Server Actions

**Files:**
- Modify: `frontend/src/lib/server/api.ts`
- Modify: `frontend/src/routes/(app)/account/+page.server.ts`

- [ ] **Step 1: Update `frontend/src/lib/server/api.ts`**

Replace the `regenerateApiKey` method with three new methods. Find the `// Account` section and replace:

```typescript
    // Account — API Keys
    listApiKeys: () =>
      request<{
        id: string;
        label: string;
        expires_at: string | null;
        last_used_at: string | null;
        created_at: string;
      }[]>("/api/account/keys", token),
    createApiKey: (label: string, expiresAt?: string | null) =>
      request<{
        id: string;
        label: string;
        api_key: string;
        expires_at: string | null;
        created_at: string;
      }>("/api/account/keys", token, {
        method: "POST",
        body: JSON.stringify({ label, expires_at: expiresAt }),
      }),
    revokeApiKey: (keyId: string) =>
      request<{ ok: true }>(`/api/account/keys/${keyId}`, token, {
        method: "DELETE",
      }),
```

- [ ] **Step 2: Replace `frontend/src/routes/(app)/account/+page.server.ts`**

```typescript
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";
import { getSupabase } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  let billing = { tier: "free" as const, subscription: null };
  let keys: { id: string; label: string; expires_at: string | null; last_used_at: string | null; created_at: string }[] = [];

  try {
    billing = await api.getBillingStatus();
  } catch {}

  try {
    keys = await api.listApiKeys();
  } catch {}

  return { billing, keys };
};

export const actions: Actions = {
  createKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const formData = await request.formData();
    const label = formData.get("label") as string;
    const expiresAt = formData.get("expires_at") as string | null;

    if (!label?.trim()) {
      return fail(400, { keyError: "Label is required" });
    }

    // Convert datetime-local value to ISO 8601 with timezone
    const expiresAtIso = expiresAt ? new Date(expiresAt).toISOString() : null;

    try {
      const result = await api.createApiKey(label.trim(), expiresAtIso);
      return { newKey: result };
    } catch (err) {
      return fail(400, { keyError: err instanceof Error ? err.message : "Failed to create key" });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const formData = await request.formData();
    const keyId = formData.get("keyId") as string;

    try {
      await api.revokeApiKey(keyId);
    } catch (err) {
      return fail(400, { keyError: err instanceof Error ? err.message : "Failed to revoke key" });
    }
  },

  connectOAuth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${url.origin}/auth/callback?redirect=/account` },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },

  checkout: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createCheckout();
    redirect(303, url);
  },

  portal: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createPortalSession();
    redirect(303, url);
  },
};
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/server/api.ts "frontend/src/routes/(app)/account/+page.server.ts"
git commit -m "feat: add API key management methods and server actions"
```

---

### Task 6: Frontend — ApiKeysCard Component

**Files:**
- Create: `frontend/src/lib/components/account/ApiKeysCard.svelte`
- Delete: `frontend/src/lib/components/account/ApiKeyCard.svelte`
- Modify: `frontend/src/routes/(app)/account/+page.svelte`

- [ ] **Step 1: Create `frontend/src/lib/components/account/ApiKeysCard.svelte`**

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";

  let { keys, newKey, keyError } = $props<{
    keys: {
      id: string;
      label: string;
      expires_at: string | null;
      last_used_at: string | null;
      created_at: string;
    }[];
    newKey?: { id: string; label: string; api_key: string } | null;
    keyError?: string | null;
  }>();

  let showCreateForm = $state(false);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  }
</script>

<div
  class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);"
>
  <div class="flex items-center justify-between mb-2">
    <h3 class="font-medium" style="color: var(--color-accent);">API Keys</h3>
    <button
      type="button"
      class="rounded-lg px-3 py-1.5 text-sm cursor-pointer"
      style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);"
      onclick={() => (showCreateForm = !showCreateForm)}
    >
      {showCreateForm ? "Cancel" : "Create Key"}
    </button>
  </div>

  <p class="text-sm mb-3" style="color: var(--color-text-muted);">
    Use API keys to connect Claude, ChatGPT, or other AI tools.
  </p>

  {#if keyError}
    <div class="rounded-lg p-3 text-sm mb-3" style="color: var(--color-danger);">
      {keyError}
    </div>
  {/if}

  {#if newKey}
    <div
      class="rounded-lg p-3 mb-3"
      style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);"
    >
      <p class="text-sm font-medium mb-1" style="color: var(--color-accent);">
        Key created: {newKey.label}
      </p>
      <div class="font-mono text-sm break-all mb-2">{newKey.api_key}</div>
      <p class="text-xs" style="color: var(--color-link);">
        Save this key now — it won't be shown again.
      </p>
    </div>
  {/if}

  {#if showCreateForm}
    <form
      method="POST"
      action="?/createKey"
      use:enhance={() => {
        return async ({ update }) => {
          await update();
          showCreateForm = false;
        };
      }}
      class="rounded-lg p-3 mb-3"
      style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);"
    >
      <div class="mb-2">
        <label for="key-label" class="block text-sm mb-1" style="color: var(--color-text-muted);"
          >Label</label
        >
        <input
          id="key-label"
          name="label"
          type="text"
          required
          placeholder="e.g. MacBook Pro, CI server"
          class="w-full rounded-lg px-3 py-2 text-sm"
          style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
        />
      </div>
      <div class="mb-3">
        <label for="key-expires" class="block text-sm mb-1" style="color: var(--color-text-muted);"
          >Expires (optional)</label
        >
        <input
          id="key-expires"
          name="expires_at"
          type="datetime-local"
          class="w-full rounded-lg px-3 py-2 text-sm"
          style="background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text);"
        />
      </div>
      <button
        type="submit"
        class="rounded-lg px-4 py-2 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-pink); color: white; border: none;"
      >
        Create Key
      </button>
    </form>
  {/if}

  {#if keys.length === 0}
    <p class="text-sm" style="color: var(--color-text-muted);">
      No API keys yet. Create one to connect your tools.
    </p>
  {:else}
    <div class="space-y-2">
      {#each keys as key (key.id)}
        <div
          class="flex items-center justify-between rounded-lg p-3 text-sm"
          style="background-color: var(--color-bg-muted); {isExpired(key.expires_at)
            ? 'opacity: 0.5;'
            : ''}"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium" style={isExpired(key.expires_at) ? 'text-decoration: line-through;' : ''}>
              {key.label}
            </div>
            <div class="text-xs mt-0.5" style="color: var(--color-text-muted);">
              Created {formatDate(key.created_at)} · Last used {formatDate(key.last_used_at)}
              {#if key.expires_at}
                · {isExpired(key.expires_at) ? "Expired" : `Expires ${formatDate(key.expires_at)}`}
              {/if}
            </div>
          </div>
          <form method="POST" action="?/revokeKey" use:enhance>
            <input type="hidden" name="keyId" value={key.id} />
            <button
              type="submit"
              class="rounded px-2 py-1 text-xs cursor-pointer ml-3"
              style="border: 1px solid var(--color-danger); color: var(--color-danger);"
            >
              Revoke
            </button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Delete `frontend/src/lib/components/account/ApiKeyCard.svelte`**

```bash
rm frontend/src/lib/components/account/ApiKeyCard.svelte
```

- [ ] **Step 3: Update `frontend/src/routes/(app)/account/+page.svelte`**

```svelte
<script>
  import ApiKeysCard from "$lib/components/account/ApiKeysCard.svelte";
  import ConnectedAccounts from "$lib/components/account/ConnectedAccounts.svelte";
  import BillingCard from "$lib/components/account/BillingCard.svelte";

  let { data, form } = $props();
</script>

<div class="max-w-2xl mx-auto p-8">
  <h1 class="text-2xl font-semibold mb-6" style="color: var(--color-accent);">Account</h1>
  <div class="mb-4 text-sm" style="color: var(--color-text-muted);">
    Signed in as {data.user.email}
  </div>
  <div class="space-y-6">
    <BillingCard billing={data.billing} />
    <ApiKeysCard keys={data.keys} newKey={form?.newKey} keyError={form?.keyError} />
    <ConnectedAccounts />
  </div>
</div>
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/components/account/ApiKeysCard.svelte "frontend/src/routes/(app)/account/+page.svelte"
git rm frontend/src/lib/components/account/ApiKeyCard.svelte
git commit -m "feat: replace ApiKeyCard with multi-key ApiKeysCard component"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full backend type check**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 2: Run full backend tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

Fix any test failures caused by the `findUserByApiKeyHash` signature change or `createUser` signature change. Tests that mock these functions need to be updated.

- [ ] **Step 3: Run full frontend check**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -40`

- [ ] **Step 4: Verify clean working tree**

Run: `git status`

Only untracked files should be non-source files (lock files, .DS_Store, etc.)
