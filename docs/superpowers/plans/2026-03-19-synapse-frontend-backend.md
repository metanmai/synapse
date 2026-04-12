# Synapse Frontend Backend Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JWT auth, share links, activity logging, version history, CORS, and API key management to the existing Synapse backend — preparing it for the frontend SPA.

**Architecture:** Extend the existing Cloudflare Worker with dual auth (JWT + API key), two new DB tables (share_links, activity_log), new REST endpoints, and activity logging in all mutation handlers. CORS middleware for frontend access.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Supabase (Postgres + Auth), existing stack

**Spec:** `docs/superpowers/specs/2026-03-19-synapse-frontend-design.md`

---

## File Structure

```
src/
├── lib/
│   ├── auth.ts                     # MODIFY: add JWT verification path alongside API key
│   └── env.ts                      # MODIFY: add SUPABASE_JWT_SECRET
├── api/
│   ├── auth.ts                     # MODIFY: add /account/regenerate-key endpoint
│   ├── context.ts                  # MODIFY: add history + restore endpoints, activity logging
│   ├── projects.ts                 # MODIFY: add share link endpoints, activity logging
│   └── share.ts                    # CREATE: share link acceptance endpoint
├── db/
│   ├── types.ts                    # MODIFY: add ShareLink, ActivityLogEntry types
│   ├── queries/
│   │   ├── users.ts                # MODIFY: add findUserBySupabaseAuthId
│   │   ├── share-links.ts          # CREATE: share link CRUD
│   │   ├── activity.ts             # CREATE: activity log queries
│   │   └── entries.ts              # MODIFY: add getEntryHistory, restoreEntry
│   └── activity-logger.ts          # CREATE: helper to insert activity log entries
├── mcp/tools/
│   ├── context-capture.ts          # MODIFY: add activity logging
│   └── project-management.ts       # MODIFY: add activity logging
├── index.ts                        # MODIFY: add CORS, mount share routes
supabase/
└── migrations/
    └── 002_frontend_support.sql    # CREATE: share_links, activity_log, users.supabase_auth_id
```

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/002_frontend_support.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/002_frontend_support.sql`:
```sql
-- Add supabase_auth_id to users for JWT auth
alter table users add column supabase_auth_id uuid unique;
create index users_supabase_auth_id_idx on users(supabase_auth_id);

-- Share links table
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

-- RLS for share_links
alter table share_links enable row level security;

create policy "share_links_read_member" on share_links for select
  using (project_id in (
    select project_id from project_members where user_id = auth.uid()
  ));

-- Activity log table
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

-- RLS for activity_log
alter table activity_log enable row level security;

create policy "activity_log_read_member" on activity_log for select
  using (project_id in (
    select project_id from project_members where user_id = auth.uid()
  ));

-- Trigger: auto-create users row when Supabase Auth user signs up
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

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/002_frontend_support.sql
git commit -m "feat: add migration for share_links, activity_log, and supabase_auth_id"
```

---

### Task 2: New Types & Query Functions

**Files:**
- Modify: `src/db/types.ts`
- Create: `src/db/queries/share-links.ts`
- Create: `src/db/queries/activity.ts`
- Create: `src/db/activity-logger.ts`
- Modify: `src/db/queries/users.ts`
- Modify: `src/db/queries/entries.ts`

- [ ] **Step 1: Add new types to `src/db/types.ts`**

Append to the existing file:
```typescript
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
  source: "claude" | "chatgpt" | "human" | "google_docs";
  metadata: Record<string, unknown> | null;
  created_at: string;
}
```

- [ ] **Step 2: Add `findUserBySupabaseAuthId` to `src/db/queries/users.ts`**

Append to the existing file:
```typescript
export async function findUserBySupabaseAuthId(
  db: SupabaseClient,
  supabaseAuthId: string
): Promise<User | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("supabase_auth_id", supabaseAuthId)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as User;
}
```

- [ ] **Step 3: Create share link queries**

Create `src/db/queries/share-links.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareLink } from "../types";

export async function createShareLink(
  db: SupabaseClient,
  projectId: string,
  role: "editor" | "viewer",
  createdBy: string,
  expiresAt?: string
): Promise<ShareLink> {
  const { data, error } = await db
    .from("share_links")
    .insert({
      project_id: projectId,
      role,
      created_by: createdBy,
      expires_at: expiresAt ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ShareLink;
}

export async function listShareLinks(
  db: SupabaseClient,
  projectId: string
): Promise<ShareLink[]> {
  const { data, error } = await db
    .from("share_links")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShareLink[];
}

export async function getShareLinkByToken(
  db: SupabaseClient,
  token: string
): Promise<ShareLink | null> {
  const { data, error } = await db
    .from("share_links")
    .select("*")
    .eq("token", token)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as ShareLink;
}

export async function deleteShareLink(
  db: SupabaseClient,
  projectId: string,
  token: string
): Promise<void> {
  const { error } = await db
    .from("share_links")
    .delete()
    .eq("project_id", projectId)
    .eq("token", token);
  if (error) throw error;
}
```

- [ ] **Step 4: Create activity log queries**

Create `src/db/queries/activity.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityLogEntry } from "../types";

export async function getActivityLog(
  db: SupabaseClient,
  projectId: string,
  limit: number = 50,
  offset: number = 0
): Promise<ActivityLogEntry[]> {
  const { data, error } = await db
    .from("activity_log")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as ActivityLogEntry[];
}
```

- [ ] **Step 5: Create activity logger helper**

Create `src/db/activity-logger.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

export async function logActivity(
  db: SupabaseClient,
  params: {
    project_id: string;
    user_id?: string | null;
    action: string;
    target_path?: string;
    target_email?: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.from("activity_log").insert({
    project_id: params.project_id,
    user_id: params.user_id ?? null,
    action: params.action,
    target_path: params.target_path ?? null,
    target_email: params.target_email ?? null,
    source: params.source ?? "human",
    metadata: params.metadata ?? null,
  });
}
```

- [ ] **Step 6: Add history queries to `src/db/queries/entries.ts`**

Append to the existing file:
```typescript
export async function getEntryHistory(
  db: SupabaseClient,
  projectId: string,
  path: string
): Promise<EntryHistory[]> {
  // First get the entry ID
  const { data: entry } = await db
    .from("entries")
    .select("id")
    .eq("project_id", projectId)
    .eq("path", path)
    .single();

  if (!entry) return [];

  const { data, error } = await db
    .from("entry_history")
    .select("*")
    .eq("entry_id", entry.id)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EntryHistory[];
}

export async function restoreEntry(
  db: SupabaseClient,
  projectId: string,
  path: string,
  historyId: string
): Promise<Entry | null> {
  // Get the history record
  const { data: historyRecord, error: histError } = await db
    .from("entry_history")
    .select("*")
    .eq("id", historyId)
    .single();
  if (histError) throw histError;
  if (!historyRecord) return null;

  // Upsert restores the content (upsertEntry handles versioning)
  const { data: existing } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .eq("path", path)
    .single();

  if (!existing) return null;

  // Save current to history
  await db.from("entry_history").insert({
    entry_id: existing.id,
    content: existing.content,
    source: existing.source,
  });

  // Restore old content
  const { data, error } = await db
    .from("entries")
    .update({ content: historyRecord.content, source: "human" })
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw error;
  return data as Entry;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/db/types.ts src/db/queries/share-links.ts src/db/queries/activity.ts src/db/activity-logger.ts src/db/queries/users.ts src/db/queries/entries.ts
git commit -m "feat: add types and queries for share links, activity log, and history"
```

---

### Task 3: JWT Auth Middleware

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Add SUPABASE_JWT_SECRET to env**

Replace `src/lib/env.ts`:
```typescript
export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
```

- [ ] **Step 2: Update auth middleware to support JWT + API key**

Replace `src/lib/auth.ts`:
```typescript
import { Context, Next } from "hono";
import type { Env } from "./env";
import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash, findUserBySupabaseAuthId } from "../db/queries/users";
import { UnauthorizedError } from "./errors";
import type { User } from "../db/types";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
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

async function verifyJwt(
  token: string,
  secret: string
): Promise<{ sub: string } | null> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
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

  // Try JWT first if it looks like one
  if (isJwt(token)) {
    const payload = await verifyJwt(token, c.env.SUPABASE_JWT_SECRET);
    if (payload?.sub) {
      user = await findUserBySupabaseAuthId(db, payload.sub);
    }
  }

  // Fall back to API key
  if (!user) {
    const apiKeyHash = await hashApiKey(token);
    user = await findUserByApiKeyHash(db, apiKeyHash);
  }

  if (!user) {
    throw new UnauthorizedError();
  }

  c.set("user", user);
  await next();
}
```

- [ ] **Step 3: Verify existing tests still pass (hashApiKey tests already exist)**

Note: `test/api/auth.test.ts` already contains hashApiKey tests — no changes needed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/env.ts test/api/auth.test.ts
git commit -m "feat: add JWT auth support alongside API key auth"
```

---

### Task 4: CORS Middleware & Share Routes

**Files:**
- Modify: `src/index.ts`
- Create: `src/api/share.ts`

- [ ] **Step 1: Create share acceptance route**

Create `src/api/share.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { authMiddleware } from "../lib/auth";
import { createSupabaseClient } from "../db/client";
import { getShareLinkByToken } from "../db/queries/share-links";
import { addMember, getMemberRole } from "../db/queries/projects";
import { logActivity } from "../db/activity-logger";
import { AppError, NotFoundError } from "../lib/errors";

const share = new Hono<{ Bindings: Env }>();

// POST /api/share/:token/join — accept a share link
share.post("/:token/join", authMiddleware, async (c) => {
  const user = c.get("user");
  const token = c.req.param("token");

  const db = createSupabaseClient(c.env);
  const link = await getShareLinkByToken(db, token);

  if (!link) throw new NotFoundError("Share link not found or expired");

  // Check expiry
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    throw new AppError("Share link has expired", 410, "LINK_EXPIRED");
  }

  // Check if already a member
  const existingRole = await getMemberRole(db, link.project_id, user.id);
  if (existingRole) {
    return c.json({ message: "You are already a member of this project", role: existingRole });
  }

  await addMember(db, link.project_id, user.id, link.role as "editor" | "viewer");
  await logActivity(db, {
    project_id: link.project_id,
    user_id: user.id,
    action: "member_added",
    target_email: user.email,
    source: "human",
    metadata: { via: "share_link", role: link.role },
  });

  return c.json({ message: "Joined project", role: link.role }, 201);
});

export { share };
```

- [ ] **Step 2: Add share link CRUD to projects routes**

Append to `src/api/projects.ts` (before the `export { projects }` line):
```typescript
import { createShareLink, listShareLinks, deleteShareLink } from "../db/queries/share-links";
import { logActivity } from "../db/activity-logger";

// POST /api/projects/:id/share-links
projects.post("/:id/share-links", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const { role, expires_at } = await c.req.json();

  if (!role || !["editor", "viewer"].includes(role)) {
    throw new AppError("role must be 'editor' or 'viewer'", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole || callerRole === "viewer") {
    throw new ForbiddenError("Only owners and editors can create share links");
  }

  const link = await createShareLink(db, projectId, role, user.id, expires_at);
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "share_link_created",
    source: "human",
    metadata: { role, token: link.token },
  });

  return c.json(link, 201);
});

// GET /api/projects/:id/share-links
projects.get("/:id/share-links", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole || callerRole === "viewer") {
    throw new ForbiddenError("Only owners and editors can view share links");
  }

  const links = await listShareLinks(db, projectId);
  return c.json(links);
});

// DELETE /api/projects/:id/share-links/:token
projects.delete("/:id/share-links/:token", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const token = c.req.param("token");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (callerRole !== "owner") {
    throw new ForbiddenError("Only owners can revoke share links");
  }

  await deleteShareLink(db, projectId, token);
  await logActivity(db, {
    project_id: projectId,
    user_id: user.id,
    action: "share_link_revoked",
    source: "human",
    metadata: { token },
  });

  return c.json({ ok: true });
});
```

- [ ] **Step 3: Add CORS, share routes, activity + history endpoints to index.ts**

Replace `src/index.ts`:
```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";
import { auth, account } from "./api/auth";
import { context } from "./api/context";
import { projects } from "./api/projects";
import { sync } from "./api/sync";
import { share } from "./api/share";
import { SynapseAgent } from "./mcp/agent";
import { runScheduledGoogleSync } from "./sync/from-google";

const app = new Hono<{ Bindings: Env }>();

// CORS for frontend
app.use("*", cors({
  origin: ["http://localhost:5173", "https://app.synapse.dev"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "synapse" }));

// Auth routes (no auth middleware)
app.route("/auth", auth);

// Authenticated routes
app.route("/api/context", context);
app.route("/api/projects", projects);
app.route("/api/sync", sync);
app.route("/api/share", share);
app.route("/api/account", account);

// Mount MCP server (Streamable HTTP transport)
app.mount("/mcp", SynapseAgent.serve("/mcp").fetch);

// Export Durable Object class (required by Wrangler)
export { SynapseAgent };

// Default export for Cloudflare Workers
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledGoogleSync(env));
  },
};
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/api/share.ts src/api/projects.ts
git commit -m "feat: add CORS, share link routes, and share acceptance endpoint"
```

---

### Task 5: Activity + History Endpoints in Context Routes

**Files:**
- Modify: `src/api/context.ts`

- [ ] **Step 1: Add history and restore endpoints to context routes**

Add these routes to `src/api/context.ts` BEFORE the catch-all `/:project/:path{.+}` route:
```typescript
import { getEntryHistory, restoreEntry } from "../db/queries/entries";
import { logActivity } from "../db/activity-logger";

// GET /api/context/:project/history/:path{.+}
context.get("/:project/history/:path{.+}", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const path = c.req.param("path");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const history = await getEntryHistory(db, proj.id, path);
  return c.json(history);
});

// POST /api/context/:project/restore — body: { path, historyId }
context.post("/:project/restore", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const { path, historyId } = await c.req.json();
  if (!path || !historyId) {
    throw new AppError("path and historyId are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entry = await restoreEntry(db, proj.id, path, historyId);
  if (!entry) throw new NotFoundError("Entry or history record not found");

  await logActivity(db, {
    project_id: proj.id,
    user_id: user.id,
    action: "entry_updated",
    target_path: path,
    source: "human",
    metadata: { restored_from: historyId },
  });

  return c.json(entry);
});
```

- [ ] **Step 2: Add activity logging to existing context mutation handlers**

Add activity log calls after each successful mutation in the existing `/save`, `/session-summary`, and `/file` routes. After each `upsertEntry` call, add:
```typescript
await logActivity(db, {
  project_id: proj.id,
  user_id: user.id,
  action: entry.created_at === entry.updated_at ? "entry_created" : "entry_updated",
  target_path: path,
  source: "human",
});
```

- [ ] **Step 3: Add activity feed endpoint to projects routes**

Add to `src/api/projects.ts`:
```typescript
import { getActivityLog } from "../db/queries/activity";

// GET /api/projects/:id/activity
projects.get("/:id/activity", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const limit = parseInt(c.req.query("limit") ?? "50");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole) throw new NotFoundError("Project not found");

  const activity = await getActivityLog(db, projectId, limit, offset);
  return c.json(activity);
});
```

- [ ] **Step 4: Commit**

```bash
git add src/api/context.ts src/api/projects.ts
git commit -m "feat: add history, restore, and activity feed endpoints"
```

---

### Task 6: Activity Logging in MCP Tools

**Files:**
- Modify: `src/mcp/tools/context-capture.ts`
- Modify: `src/mcp/tools/project-management.ts`

- [ ] **Step 1: Add activity logging to context capture MCP tools**

Add `import { logActivity } from "../../db/activity-logger";` to context-capture.ts.

After each `upsertEntry` call in the `save_context`, `save_session_summary`, and `add_file` tools, add:
```typescript
await logActivity(db, {
  project_id: proj.id,
  user_id: userId,
  action: "entry_created",
  target_path: path,
  source: "claude",
});
```

- [ ] **Step 2: Add activity logging to project management MCP tools**

Add `import { logActivity } from "../../db/activity-logger";` to project-management.ts.

After `addMember` in `invite_member`:
```typescript
await logActivity(db, {
  project_id: proj.id, user_id: userId, action: "member_added",
  target_email: email, source: "claude",
});
```

After `removeMember` in `remove_member`:
```typescript
await logActivity(db, {
  project_id: proj.id, user_id: userId, action: "member_removed",
  target_email: email, source: "claude",
});
```

After `setPreference` in `set_preference`:
```typescript
await logActivity(db, {
  project_id: proj.id, user_id: userId, action: "settings_changed",
  source: "claude", metadata: { key, value },
});
```

- [ ] **Step 3: Verify TypeScript compiles and tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/context-capture.ts src/mcp/tools/project-management.ts
git commit -m "feat: add activity logging to MCP tools"
```

---

### Task 7: API Key Regeneration Endpoint

**Files:**
- Modify: `src/api/auth.ts`

- [ ] **Step 1: Add regenerate-key endpoint**

Add to `src/api/auth.ts`:
```typescript
// POST /api/account/regenerate-key — mounted separately in index.ts, not under /auth
// Add this as a standalone Hono app exported from auth.ts
export const account = new Hono<{ Bindings: Env }>();
account.use("*", authMiddleware);

account.post("/regenerate-key", async (c) => {
  const user = c.get("user");

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);

  const db = createSupabaseClient(c.env);
  const { error } = await db
    .from("users")
    .update({ api_key_hash: apiKeyHash })
    .eq("id", user.id);
  if (error) throw error;

  return c.json({ api_key: apiKey });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/api/auth.ts
git commit -m "feat: add API key regeneration endpoint"
```

---

### Task 8: Update Tests & Final Verification

**Files:**
- Modify: `test/api/health.test.ts`

- [ ] **Step 1: Update smoke tests for new routes**

Add to `test/api/health.test.ts`:
```typescript
it("POST /api/share/invalid-token/join without auth returns 401", async () => {
  const req = new Request("http://localhost/api/share/invalid-token/join", {
    method: "POST",
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run full verification**

```bash
npm run typecheck && npm test
```
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add test/
git commit -m "feat: add smoke tests for share and activity endpoints"
```
