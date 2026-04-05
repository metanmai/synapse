# MCP-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cloud-hosted MCP server on Cloudflare Workers that captures, stores, and syncs AI session context across tools and team members.

**Architecture:** Cloudflare Worker (Hono + McpAgent Durable Object) → Supabase Postgres. MCP tools + mirrored REST API. Google Docs bidirectional sync via Drive API.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, `agents` (Cloudflare Agents SDK), `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-mcp-sync-design.md`

---

## File Structure

```
mcp-sync/
├── src/
│   ├── index.ts                    # Hono app + Worker export + McpAgent DO export
│   ├── mcp/
│   │   ├── agent.ts                # McpAgent subclass, tool/prompt/resource registration
│   │   ├── tools/
│   │   │   ├── context-capture.ts  # save_context, save_session_summary, add_file
│   │   │   ├── context-retrieval.ts# get_context, search_context, list_context, load_project_context
│   │   │   ├── project-management.ts# create_project, list_projects, invite/remove member, set_preference
│   │   │   └── google-sync.ts      # sync_to_google_docs, sync_from_google_docs
│   │   ├── prompts.ts              # session_start, session_end prompt templates
│   │   └── resources.ts            # context:// resource templates
│   ├── api/
│   │   ├── context.ts              # REST routes for context capture + retrieval
│   │   ├── projects.ts             # REST routes for project + team management
│   │   ├── auth.ts                 # Signup + Google OAuth routes
│   │   └── sync.ts                 # REST routes for Google sync triggers
│   ├── db/
│   │   ├── client.ts               # Supabase client factory (from env)
│   │   ├── types.ts                # TypeScript types matching DB schema
│   │   └── queries/
│   │       ├── users.ts            # User CRUD + API key lookup
│   │       ├── projects.ts         # Project + member CRUD
│   │       ├── entries.ts          # Entry CRUD + search + history
│   │       └── preferences.ts      # User preference CRUD
│   ├── sync/
│   │   ├── to-google.ts            # DB → Google Docs conversion + push
│   │   └── from-google.ts          # Google Docs → DB pull + conflict resolution
│   └── lib/
│       ├── auth.ts                 # Auth middleware (API key → user resolution)
│       ├── errors.ts               # Error types + handler
│       └── env.ts                  # Env type definition (bindings, secrets)
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # All tables, indexes, RLS policies
├── test/
│   ├── setup.ts                    # Test helpers, mock Supabase client
│   ├── db/
│   │   └── queries.test.ts         # Query function unit tests
│   ├── api/
│   │   ├── auth.test.ts            # Auth route tests
│   │   ├── context.test.ts         # Context route tests
│   │   └── projects.test.ts        # Project route tests
│   └── mcp/
│       └── tools.test.ts           # MCP tool handler tests
├── wrangler.jsonc                  # Cloudflare config (DO bindings, secrets, cron)
├── vitest.config.ts                # Vitest config for Workers
├── package.json
└── tsconfig.json
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/lib/env.ts`

- [ ] **Step 1: Initialize project and install dependencies**

```bash
cd /Users/Tanmai.N/Documents/mcp-sync
npm init -y
npm install hono agents @supabase/supabase-js zod
npm install -D wrangler typescript @cloudflare/vitest-pool-workers vitest @types/node
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/vitest-pool-workers"],
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create Wrangler config**

Create `wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mcp-sync",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      {
        "class_name": "McpSyncAgent",
        "name": "MCP_OBJECT"
      }
    ]
  },
  "migrations": [
    {
      "new_sqlite_classes": ["McpSyncAgent"],
      "tag": "v1"
    }
  ],
  "triggers": {
    "crons": ["*/5 * * * *"]
  },
  "vars": {},
  // Secrets (set via `wrangler secret put`):
  // SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
}
```

- [ ] **Step 4: Create env type definition**

Create `src/lib/env.ts`:
```typescript
export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}
```

- [ ] **Step 5: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

- [ ] **Step 6: Create minimal Worker entry with health endpoint**

Create `src/index.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "./lib/env";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));

export default app;
```

- [ ] **Step 7: Write test for health endpoint**

Create `test/setup.ts`:
```typescript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

export { env, createExecutionContext, waitOnExecutionContext };
```

Create `test/api/health.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";
import app from "../../src/index";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "mcp-sync" });
  });
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/api/health.test.ts`
Expected: PASS

- [ ] **Step 9: Verify Worker runs locally**

Run: `npx wrangler dev --test-scheduled`
Test: `curl http://localhost:8787/health` → `{"status":"ok","service":"mcp-sync"}`
Stop wrangler after verifying.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.jsonc vitest.config.ts src/ test/
git commit -m "feat: scaffold Cloudflare Worker project with Hono and health endpoint"
```

---

### Task 2: Database Schema (Supabase Migration)

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Create the migration file with all tables**

Create `supabase/migrations/001_initial_schema.sql`:
```sql
-- Enable required extensions
create extension if not exists "pgcrypto";

-- Users table
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  api_key_hash text unique not null,
  google_oauth_tokens jsonb,
  created_at timestamptz default now() not null
);

-- Projects table
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  google_drive_folder_id text,
  created_at timestamptz default now() not null
);

-- Project members (join table)
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz default now() not null,
  primary key (project_id, user_id)
);

-- Context entries (virtual filesystem)
create table entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  content text not null,
  content_type text not null default 'markdown' check (content_type in ('markdown', 'json')),
  author_id uuid references users(id) on delete set null,
  source text not null default 'claude' check (source in ('claude', 'chatgpt', 'human', 'google_docs')),
  tags text[] default '{}',
  google_doc_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (project_id, path)
);

-- Full-text search index on entries
alter table entries add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(path, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index entries_search_idx on entries using gin(search_vector);
create index entries_project_path_idx on entries(project_id, path);
create index entries_project_updated_idx on entries(project_id, updated_at desc);
create index entries_project_tags_idx on entries using gin(tags);

-- Entry history (versioning)
create table entry_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  content text not null,
  source text not null,
  changed_at timestamptz default now() not null
);

create index entry_history_entry_idx on entry_history(entry_id, changed_at desc);

-- User preferences per project
create table user_preferences (
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  auto_capture text not null default 'moderate' check (auto_capture in ('aggressive', 'moderate', 'manual_only')),
  context_loading text not null default 'smart' check (context_loading in ('full', 'smart', 'on_demand', 'summary_only')),
  primary key (user_id, project_id)
);

-- Row-Level Security policies
alter table users enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table entries enable row level security;
alter table entry_history enable row level security;
alter table user_preferences enable row level security;

-- Note: RLS policies use the service key from the Worker (bypasses RLS).
-- Application-level authorization is enforced in the Worker code via
-- project membership checks. RLS here is defense-in-depth for direct
-- Supabase client access (e.g., Supabase dashboard, future client SDKs).

-- Users can read their own row
create policy "users_read_own" on users for select
  using (id = auth.uid());

-- Project members can read projects they belong to
create policy "projects_read_member" on projects for select
  using (id in (select project_id from project_members where user_id = auth.uid()));

-- Members can read membership of their projects
create policy "members_read" on project_members for select
  using (project_id in (select project_id from project_members where user_id = auth.uid()));

-- Entries: members can read entries in their projects
create policy "entries_read_member" on entries for select
  using (project_id in (select project_id from project_members where user_id = auth.uid()));

-- Entries: editors and owners can insert/update
create policy "entries_write_editor" on entries for insert
  with check (project_id in (
    select project_id from project_members
    where user_id = auth.uid() and role in ('owner', 'editor')
  ));

create policy "entries_update_editor" on entries for update
  using (project_id in (
    select project_id from project_members
    where user_id = auth.uid() and role in ('owner', 'editor')
  ));

-- Entry history: same as entries read
create policy "entry_history_read" on entry_history for select
  using (entry_id in (
    select e.id from entries e
    join project_members pm on pm.project_id = e.project_id
    where pm.user_id = auth.uid()
  ));

-- User preferences: users can read/write their own
create policy "preferences_read_own" on user_preferences for select
  using (user_id = auth.uid());

create policy "preferences_write_own" on user_preferences for insert
  with check (user_id = auth.uid());

create policy "preferences_update_own" on user_preferences for update
  using (user_id = auth.uid());

-- Updated_at trigger for entries
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger entries_updated_at
  before update on entries
  for each row execute function update_updated_at();
```

- [ ] **Step 2: Verify SQL syntax**

Run: `npx supabase init` (if not already initialized, creates `supabase/config.toml`)
Run: `npx supabase db lint -f supabase/migrations/001_initial_schema.sql`
If supabase CLI not installed: `npm install -D supabase`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: add database schema migration with tables, indexes, and RLS policies"
```

---

### Task 3: TypeScript Types & DB Client

**Files:**
- Create: `src/db/types.ts`
- Create: `src/db/client.ts`
- Create: `src/lib/errors.ts`

- [ ] **Step 1: Create DB types**

Create `src/db/types.ts`:
```typescript
export interface User {
  id: string;
  email: string;
  api_key_hash: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  google_drive_folder_id: string | null;
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
}

export interface Entry {
  id: string;
  project_id: string;
  path: string;
  content: string;
  content_type: "markdown" | "json";
  author_id: string | null;
  source: "claude" | "chatgpt" | "human" | "google_docs";
  tags: string[];
  google_doc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntryHistory {
  id: string;
  entry_id: string;
  content: string;
  source: string;
  changed_at: string;
}

export interface UserPreferences {
  user_id: string;
  project_id: string;
  auto_capture: "aggressive" | "moderate" | "manual_only";
  context_loading: "full" | "smart" | "on_demand" | "summary_only";
}
```

- [ ] **Step 2: Create Supabase client factory**

Create `src/db/client.ts`:
```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";

export function createSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 3: Create error types**

Create `src/lib/errors.ts`:
```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public status: number = 500,
    public code: string = "INTERNAL_ERROR"
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Invalid or missing API key") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(message, 403, "FORBIDDEN");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/types.ts src/db/client.ts src/lib/errors.ts
git commit -m "feat: add TypeScript types, Supabase client factory, and error classes"
```

---

### Task 4: Auth Middleware

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/db/queries/users.ts`
- Create: `test/api/auth.test.ts`

- [ ] **Step 1: Write the user query functions**

Create `src/db/queries/users.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../types";

export async function findUserByApiKeyHash(
  db: SupabaseClient,
  apiKeyHash: string
): Promise<User | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("api_key_hash", apiKeyHash)
    .single();

  if (error && error.code === "PGRST116") return null; // no rows
  if (error) throw error;
  return data as User;
}

export async function createUser(
  db: SupabaseClient,
  email: string,
  apiKeyHash: string
): Promise<User> {
  const { data, error } = await db
    .from("users")
    .insert({ email, api_key_hash: apiKeyHash })
    .select()
    .single();

  if (error) throw error;
  return data as User;
}

export async function findUserByEmail(
  db: SupabaseClient,
  email: string
): Promise<User | null> {
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as User;
}
```

- [ ] **Step 2: Write auth middleware**

Create `src/lib/auth.ts`:
```typescript
import { Context, Next } from "hono";
import type { Env } from "./env";
import { createSupabaseClient } from "../db/client";
import { findUserByApiKeyHash } from "../db/queries/users";
import { UnauthorizedError } from "./errors";
import type { User } from "../db/types";

// Extend Hono context variables
declare module "hono" {
  interface ContextVariableMap {
    user: User;
  }
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { hashApiKey };

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const apiKey = authHeader.slice(7);
  const apiKeyHash = await hashApiKey(apiKey);
  const db = createSupabaseClient(c.env);
  const user = await findUserByApiKeyHash(db, apiKeyHash);

  if (!user) {
    throw new UnauthorizedError();
  }

  c.set("user", user);
  await next();
}
```

- [ ] **Step 3: Add error handler to Hono app**

Modify `src/index.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));

export default app;
```

- [ ] **Step 4: Write test for auth middleware**

Create `test/api/auth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware, hashApiKey } from "../../src/lib/auth";

describe("hashApiKey", () => {
  it("produces consistent SHA-256 hex hash", async () => {
    const hash1 = await hashApiKey("test-key-123");
    const hash2 = await hashApiKey("test-key-123");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it("produces different hashes for different keys", async () => {
    const hash1 = await hashApiKey("key-a");
    const hash2 = await hashApiKey("key-b");
    expect(hash1).not.toBe(hash2);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/api/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/db/queries/users.ts src/index.ts test/api/auth.test.ts
git commit -m "feat: add auth middleware with API key hashing and user lookup"
```

---

### Task 5: Auth Routes (Signup)

**Files:**
- Create: `src/api/auth.ts`
- Modify: `src/index.ts` — mount auth routes

- [ ] **Step 1: Write failing test for signup**

Add to `test/api/auth.test.ts`:
```typescript
import app from "../../src/index";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";

describe("POST /auth/signup", () => {
  it("returns 400 without email", async () => {
    const req = new Request("http://localhost/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api/auth.test.ts`
Expected: FAIL (404 — route doesn't exist yet)

- [ ] **Step 3: Implement auth routes**

Create `src/api/auth.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import { createUser, findUserByEmail } from "../db/queries/users";
import { hashApiKey } from "../lib/auth";
import { AppError, ConflictError } from "../lib/errors";

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

  // Generate API key
  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);

  const user = await createUser(db, body.email, apiKeyHash);

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey, // Only returned once at signup
  }, 201);
});

export { auth };
```

- [ ] **Step 4: Mount auth routes in index**

Modify `src/index.ts` — add after the health endpoint:
```typescript
import { auth } from "./api/auth";

// ... existing code ...

app.route("/auth", auth);
```

Full `src/index.ts` should be:
```typescript
import { Hono } from "hono";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";
import { auth } from "./api/auth";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));
app.route("/auth", auth);

export default app;
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/api/auth.test.ts`
Expected: signup validation test should pass (400 for missing email). DB-dependent tests will need Supabase running — mark as integration tests for later.

- [ ] **Step 6: Commit**

```bash
git add src/api/auth.ts src/index.ts test/api/auth.test.ts
git commit -m "feat: add signup endpoint with API key generation"
```

---

### Task 6: DB Query Functions

**Files:**
- Create: `src/db/queries/projects.ts`
- Create: `src/db/queries/entries.ts`
- Create: `src/db/queries/preferences.ts`

- [ ] **Step 1: Write project query functions**

Create `src/db/queries/projects.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectMember } from "../types";

export async function createProject(
  db: SupabaseClient,
  name: string,
  ownerId: string
): Promise<Project> {
  const { data: project, error } = await db
    .from("projects")
    .insert({ name, owner_id: ownerId })
    .select()
    .single();
  if (error) throw error;

  // Add owner as a member
  const { error: memberError } = await db
    .from("project_members")
    .insert({ project_id: project.id, user_id: ownerId, role: "owner" });
  if (memberError) throw memberError;

  return project as Project;
}

export async function listProjectsForUser(
  db: SupabaseClient,
  userId: string
): Promise<Project[]> {
  const { data, error } = await db
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("project_members.user_id", userId);
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function getProjectByName(
  db: SupabaseClient,
  name: string,
  userId: string
): Promise<Project | null> {
  const { data, error } = await db
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("name", name)
    .eq("project_members.user_id", userId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as Project;
}

export async function getMemberRole(
  db: SupabaseClient,
  projectId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data?.role ?? null;
}

export async function addMember(
  db: SupabaseClient,
  projectId: string,
  userId: string,
  role: "editor" | "viewer"
): Promise<ProjectMember> {
  const { data, error } = await db
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId, role })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectMember;
}

export async function removeMember(
  db: SupabaseClient,
  projectId: string,
  userId: string
): Promise<void> {
  const { error } = await db
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw error;
}
```

- [ ] **Step 2: Write entry query functions**

Create `src/db/queries/entries.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry, EntryHistory } from "../types";

export async function upsertEntry(
  db: SupabaseClient,
  params: {
    project_id: string;
    path: string;
    content: string;
    content_type?: "markdown" | "json";
    author_id?: string | null;
    source?: string;
    tags?: string[];
  }
): Promise<Entry> {
  // Check if entry exists at this path
  const { data: existing } = await db
    .from("entries")
    .select("*")
    .eq("project_id", params.project_id)
    .eq("path", params.path)
    .single();

  if (existing) {
    // Save current version to history
    await db.from("entry_history").insert({
      entry_id: existing.id,
      content: existing.content,
      source: existing.source,
    });

    // Update entry
    const { data, error } = await db
      .from("entries")
      .update({
        content: params.content,
        content_type: params.content_type ?? existing.content_type,
        author_id: params.author_id ?? existing.author_id,
        source: params.source ?? existing.source,
        tags: params.tags ?? existing.tags,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as Entry;
  }

  // Create new entry
  const { data, error } = await db
    .from("entries")
    .insert({
      project_id: params.project_id,
      path: params.path,
      content: params.content,
      content_type: params.content_type ?? "markdown",
      author_id: params.author_id ?? null,
      source: params.source ?? "claude",
      tags: params.tags ?? [],
    })
    .select()
    .single();
  if (error) throw error;
  return data as Entry;
}

export async function getEntry(
  db: SupabaseClient,
  projectId: string,
  path: string
): Promise<Entry | null> {
  const { data, error } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .eq("path", path)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw error;
  return data as Entry;
}

export async function listEntries(
  db: SupabaseClient,
  projectId: string,
  folder?: string
): Promise<Pick<Entry, "path" | "content_type" | "tags" | "updated_at">[]> {
  let query = db
    .from("entries")
    .select("path, content_type, tags, updated_at")
    .eq("project_id", projectId)
    .order("path", { ascending: true });

  if (folder) {
    query = query.like("path", `${folder}/%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function searchEntries(
  db: SupabaseClient,
  projectId: string,
  query: string,
  options?: { tags?: string[]; folder?: string }
): Promise<Entry[]> {
  // Use Postgres full-text search
  let dbQuery = db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .textSearch("search_vector", query, { type: "websearch" });

  if (options?.folder) {
    dbQuery = dbQuery.like("path", `${options.folder}/%`);
  }

  if (options?.tags?.length) {
    dbQuery = dbQuery.overlaps("tags", options.tags);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function getRecentEntries(
  db: SupabaseClient,
  projectId: string,
  limit: number = 20
): Promise<Entry[]> {
  const { data, error } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function getAllEntries(
  db: SupabaseClient,
  projectId: string
): Promise<Entry[]> {
  const { data, error } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .order("path", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Entry[];
}

export async function deleteEntry(
  db: SupabaseClient,
  projectId: string,
  path: string
): Promise<void> {
  const { error } = await db
    .from("entries")
    .delete()
    .eq("project_id", projectId)
    .eq("path", path);
  if (error) throw error;
}
```

- [ ] **Step 3: Write preferences query functions**

Create `src/db/queries/preferences.ts`:
```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserPreferences } from "../types";

export async function getPreferences(
  db: SupabaseClient,
  userId: string,
  projectId: string
): Promise<UserPreferences> {
  const { data, error } = await db
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .single();

  if (error && error.code === "PGRST116") {
    // Return defaults if no preferences set
    return {
      user_id: userId,
      project_id: projectId,
      auto_capture: "moderate",
      context_loading: "smart",
    };
  }
  if (error) throw error;
  return data as UserPreferences;
}

export async function setPreference(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  key: string,
  value: string
): Promise<UserPreferences> {
  const validKeys: Record<string, string[]> = {
    auto_capture: ["aggressive", "moderate", "manual_only"],
    context_loading: ["full", "smart", "on_demand", "summary_only"],
  };

  if (!(key in validKeys)) {
    throw new Error(`Invalid preference key: ${key}. Valid keys: ${Object.keys(validKeys).join(", ")}`);
  }

  if (!validKeys[key].includes(value)) {
    throw new Error(`Invalid value for ${key}: ${value}. Valid values: ${validKeys[key].join(", ")}`);
  }

  const { data, error } = await db
    .from("user_preferences")
    .upsert(
      { user_id: userId, project_id: projectId, [key]: value },
      { onConflict: "user_id,project_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as UserPreferences;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/queries/
git commit -m "feat: add DB query functions for projects, entries, and preferences"
```

---

### Task 7: MCP Server Core + Project Management Tools

**Files:**
- Create: `src/mcp/agent.ts`
- Create: `src/mcp/tools/project-management.ts`
- Modify: `src/index.ts` — export McpSyncAgent DO, mount MCP
- Modify: `src/lib/env.ts` — add MCP agent context type

- [ ] **Step 1: Create the McpAgent subclass**

Create `src/mcp/agent.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Env } from "../lib/env";
import { registerProjectManagementTools } from "./tools/project-management";
import { registerContextCaptureTools } from "./tools/context-capture";
import { registerContextRetrievalTools } from "./tools/context-retrieval";
import { registerGoogleSyncTools } from "./tools/google-sync";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";

export class McpSyncAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "mcp-sync",
    version: "1.0.0",
  });

  async init() {
    registerProjectManagementTools(this.server, this.env);
    registerContextCaptureTools(this.server, this.env);
    registerContextRetrievalTools(this.server, this.env);
    registerGoogleSyncTools(this.server, this.env);
    registerPrompts(this.server, this.env);
    registerResources(this.server, this.env);
  }
}
```

- [ ] **Step 2: Create project management tools**

Create `src/mcp/tools/project-management.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../../lib/env";
import { createSupabaseClient } from "../../db/client";
import {
  createProject,
  listProjectsForUser,
  getProjectByName,
  getMemberRole,
  addMember,
  removeMember,
} from "../../db/queries/projects";
import { findUserByEmail } from "../../db/queries/users";
import { setPreference } from "../../db/queries/preferences";

export function registerProjectManagementTools(server: McpServer, env: Env) {
  server.tool(
    "create_project",
    "Create a new project workspace for organizing context. You become the owner.",
    { name: z.string().describe("Project name") },
    async ({ name }, extra) => {
      const db = createSupabaseClient(env);
      // TODO: extract userId from MCP auth context
      // For now, this will be wired up when auth is integrated with MCP
      const userId = (extra as any).userId;
      const project = await createProject(db, name, userId);
      return {
        content: [{ type: "text", text: `Project "${project.name}" created (id: ${project.id})` }],
      };
    }
  );

  server.tool(
    "list_projects",
    "List all projects you have access to.",
    {},
    async (_args, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;
      const projects = await listProjectsForUser(db, userId);
      const list = projects.map((p) => `- ${p.name} (id: ${p.id})`).join("\n");
      return {
        content: [{ type: "text", text: list || "No projects found." }],
      };
    }
  );

  server.tool(
    "invite_member",
    "Invite a team member to a project by email. They'll be able to access shared context.",
    {
      project: z.string().describe("Project name"),
      email: z.string().email().describe("Email of the person to invite"),
      role: z.enum(["editor", "viewer"]).describe("Role: 'editor' can read/write, 'viewer' can only read"),
    },
    async ({ project, email, role }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const callerRole = await getMemberRole(db, proj.id, userId);
      if (callerRole !== "owner") {
        return { content: [{ type: "text", text: "Only project owners can invite members." }] };
      }

      const invitee = await findUserByEmail(db, email);
      if (!invitee) {
        return { content: [{ type: "text", text: `No user found with email ${email}. They need to sign up first.` }] };
      }

      await addMember(db, proj.id, invitee.id, role);
      return {
        content: [{ type: "text", text: `Invited ${email} as ${role} to "${project}".` }],
      };
    }
  );

  server.tool(
    "remove_member",
    "Remove a team member from a project.",
    {
      project: z.string().describe("Project name"),
      email: z.string().email().describe("Email of the person to remove"),
    },
    async ({ project, email }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const callerRole = await getMemberRole(db, proj.id, userId);
      if (callerRole !== "owner") {
        return { content: [{ type: "text", text: "Only project owners can remove members." }] };
      }

      const target = await findUserByEmail(db, email);
      if (!target) {
        return { content: [{ type: "text", text: `No user found with email ${email}.` }] };
      }

      await removeMember(db, proj.id, target.id);
      return {
        content: [{ type: "text", text: `Removed ${email} from "${project}".` }],
      };
    }
  );

  server.tool(
    "set_preference",
    "Set a user preference for a project. Keys: 'auto_capture' (aggressive|moderate|manual_only), 'context_loading' (full|smart|on_demand|summary_only).",
    {
      project: z.string().describe("Project name"),
      key: z.string().describe("Preference key"),
      value: z.string().describe("Preference value"),
    },
    async ({ project, key, value }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const prefs = await setPreference(db, userId, proj.id, key, value);
      return {
        content: [{ type: "text", text: `Set ${key} = ${value} for project "${project}".` }],
      };
    }
  );
}
```

- [ ] **Step 3: Create stub files for other tool registrations**

Create `src/mcp/tools/context-capture.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../../lib/env";

export function registerContextCaptureTools(server: McpServer, env: Env) {
  // Implemented in Task 8
}
```

Create `src/mcp/tools/context-retrieval.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../../lib/env";

export function registerContextRetrievalTools(server: McpServer, env: Env) {
  // Implemented in Task 9
}
```

Create `src/mcp/tools/google-sync.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../../lib/env";

export function registerGoogleSyncTools(server: McpServer, env: Env) {
  // Implemented in Task 12
}
```

Create `src/mcp/prompts.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../lib/env";

export function registerPrompts(server: McpServer, env: Env) {
  // Implemented in Task 11
}
```

Create `src/mcp/resources.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../lib/env";

export function registerResources(server: McpServer, env: Env) {
  // Implemented in Task 11
}
```

- [ ] **Step 4: Wire McpSyncAgent into index.ts**

Update `src/index.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";
import { auth } from "./api/auth";
import { McpSyncAgent } from "./mcp/agent";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));
app.route("/auth", auth);

// Mount MCP server on /mcp (Streamable HTTP transport)
app.mount("/mcp", McpSyncAgent.serve("/mcp").fetch);

export { McpSyncAgent };
export default app;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only expected type issues from stub files)

- [ ] **Step 6: Commit**

```bash
git add src/mcp/ src/index.ts
git commit -m "feat: add MCP server core with project management tools"
```

---

### Task 8: Context Capture Tools + REST Routes

**Files:**
- Modify: `src/mcp/tools/context-capture.ts`
- Create: `src/api/context.ts`
- Modify: `src/index.ts` — mount context routes
- Create: `test/mcp/tools.test.ts`

- [ ] **Step 1: Implement context capture tools**

Replace `src/mcp/tools/context-capture.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../../lib/env";
import { createSupabaseClient } from "../../db/client";
import { getProjectByName } from "../../db/queries/projects";
import { upsertEntry } from "../../db/queries/entries";

export function registerContextCaptureTools(server: McpServer, env: Env) {
  server.tool(
    "save_context",
    "Save a piece of context (decision, convention, learning, etc.) to a project. Call this when a technical decision is made, an architecture pattern is discussed, or a team convention is established.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("Path within the project, e.g., 'decisions/chose-postgres.md'"),
      content: z.string().describe("The context content (markdown)"),
      tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
    },
    async ({ project, path, content, tags }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const entry = await upsertEntry(db, {
        project_id: proj.id,
        path,
        content,
        tags: tags ?? [],
        author_id: userId,
        source: "claude",
      });

      const action = entry.created_at === entry.updated_at ? "Created" : "Updated";
      return {
        content: [{ type: "text", text: `${action} context at "${path}" in project "${project}".` }],
      };
    }
  );

  server.tool(
    "save_session_summary",
    "Save a summary of the current AI session. Call this at the end of a session to capture what was done, decisions made, and what's pending.",
    {
      project: z.string().describe("Project name"),
      summary: z.string().describe("Session summary text"),
      decisions: z.array(z.string()).optional().describe("Key decisions made during this session"),
      pending: z.array(z.string()).optional().describe("Pending items for follow-up"),
    },
    async ({ project, summary, decisions, pending }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const date = new Date().toISOString().split("T")[0];
      const slug = summary.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const path = `context/session-summaries/${date}-${slug}.md`;

      // Build summary content
      let fullContent = `# Session Summary — ${date}\n\n${summary}`;
      if (pending?.length) {
        fullContent += `\n\n## Pending\n${pending.map((p) => `- ${p}`).join("\n")}`;
      }

      await upsertEntry(db, {
        project_id: proj.id,
        path,
        content: fullContent,
        tags: ["session-summary"],
        author_id: userId,
        source: "claude",
      });

      // Save individual decisions as separate entries
      if (decisions?.length) {
        for (const decision of decisions) {
          const decisionSlug = decision.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
          await upsertEntry(db, {
            project_id: proj.id,
            path: `decisions/${date}-${decisionSlug}.md`,
            content: decision,
            tags: ["decision"],
            author_id: userId,
            source: "claude",
          });
        }
      }

      return {
        content: [{ type: "text", text: `Session summary saved to "${path}". ${decisions?.length ?? 0} decisions also recorded.` }],
      };
    }
  );

  server.tool(
    "add_file",
    "Add a raw file (spec, doc, notes) to a project folder.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("Path within the project"),
      content: z.string().describe("File content"),
      content_type: z.enum(["markdown", "json"]).describe("Content type"),
    },
    async ({ project, path, content, content_type }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      await upsertEntry(db, {
        project_id: proj.id,
        path,
        content,
        content_type,
        author_id: userId,
        source: "human",
      });

      return {
        content: [{ type: "text", text: `File added at "${path}" in project "${project}".` }],
      };
    }
  );
}
```

- [ ] **Step 2: Create REST context routes**

Create `src/api/context.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { authMiddleware } from "../lib/auth";
import { createSupabaseClient } from "../db/client";
import { getProjectByName } from "../db/queries/projects";
import { upsertEntry, getEntry, listEntries, searchEntries, getRecentEntries, getAllEntries } from "../db/queries/entries";
import { getPreferences } from "../db/queries/preferences";
import { NotFoundError, AppError } from "../lib/errors";

const context = new Hono<{ Bindings: Env }>();
context.use("*", authMiddleware);

// POST /api/context/save
context.post("/save", async (c) => {
  const user = c.get("user");
  const { project, path, content, tags } = await c.req.json();
  if (!project || !path || !content) {
    throw new AppError("project, path, and content are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, project, user.id);
  if (!proj) throw new NotFoundError(`Project "${project}" not found`);

  const entry = await upsertEntry(db, {
    project_id: proj.id, path, content, tags, author_id: user.id, source: "human",
  });
  return c.json(entry, 201);
});

// POST /api/context/session-summary
context.post("/session-summary", async (c) => {
  const user = c.get("user");
  const { project, summary, decisions, pending } = await c.req.json();
  if (!project || !summary) {
    throw new AppError("project and summary are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, project, user.id);
  if (!proj) throw new NotFoundError(`Project "${project}" not found`);

  const date = new Date().toISOString().split("T")[0];
  const slug = summary.slice(0, 40).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const path = `context/session-summaries/${date}-${slug}.md`;

  let fullContent = `# Session Summary — ${date}\n\n${summary}`;
  if (pending?.length) {
    fullContent += `\n\n## Pending\n${pending.map((p: string) => `- ${p}`).join("\n")}`;
  }

  const entry = await upsertEntry(db, {
    project_id: proj.id, path, content: fullContent, tags: ["session-summary"],
    author_id: user.id, source: "human",
  });

  return c.json(entry, 201);
});

// POST /api/context/file
context.post("/file", async (c) => {
  const user = c.get("user");
  const { project, path, content, content_type } = await c.req.json();
  if (!project || !path || !content) {
    throw new AppError("project, path, and content are required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, project, user.id);
  if (!proj) throw new NotFoundError(`Project "${project}" not found`);

  const entry = await upsertEntry(db, {
    project_id: proj.id, path, content, content_type: content_type ?? "markdown",
    author_id: user.id, source: "human",
  });
  return c.json(entry, 201);
});

// GET /api/context/:project/search?q=&tags=&folder=
context.get("/:project/search", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const query = c.req.query("q");
  const tags = c.req.query("tags")?.split(",");
  const folder = c.req.query("folder");

  if (!query) throw new AppError("q query parameter is required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const results = await searchEntries(db, proj.id, query, { tags, folder });
  return c.json(results);
});

// GET /api/context/:project/list?folder=
context.get("/:project/list", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const folder = c.req.query("folder");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entries = await listEntries(db, proj.id, folder);
  return c.json(entries);
});

// GET /api/context/:project/load
context.get("/:project/load", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const prefs = await getPreferences(db, user.id, proj.id);

  switch (prefs.context_loading) {
    case "full": {
      const entries = await getAllEntries(db, proj.id);
      return c.json({ mode: "full", entries });
    }
    case "smart": {
      const entries = await getRecentEntries(db, proj.id, 20);
      return c.json({ mode: "smart", entries });
    }
    case "on_demand": {
      const tree = await listEntries(db, proj.id);
      return c.json({ mode: "on_demand", tree });
    }
    case "summary_only": {
      const entries = await getAllEntries(db, proj.id);
      const summary = entries.map((e) => `- **${e.path}**: ${e.content.slice(0, 100)}...`).join("\n");
      return c.json({ mode: "summary_only", summary });
    }
  }
});

// GET /api/context/:project/:path{.+} — must be last (catch-all)
context.get("/:project/:path{.+}", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const path = c.req.param("path");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const entry = await getEntry(db, proj.id, path);
  if (!entry) throw new NotFoundError(`Entry "${path}" not found in project "${projectName}"`);

  return c.json(entry);
});

export { context };
```

- [ ] **Step 3: Mount context routes in index**

Update `src/index.ts` — add:
```typescript
import { context } from "./api/context";

// ... after app.route("/auth", auth);
app.route("/api/context", context);
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/context-capture.ts src/api/context.ts src/index.ts
git commit -m "feat: add context capture/retrieval tools and REST routes"
```

---

### Task 9: Context Retrieval MCP Tools

**Files:**
- Modify: `src/mcp/tools/context-retrieval.ts`

- [ ] **Step 1: Implement context retrieval tools**

Replace `src/mcp/tools/context-retrieval.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../../lib/env";
import { createSupabaseClient } from "../../db/client";
import { getProjectByName } from "../../db/queries/projects";
import { getEntry, listEntries, searchEntries, getRecentEntries, getAllEntries } from "../../db/queries/entries";
import { getPreferences } from "../../db/queries/preferences";

export function registerContextRetrievalTools(server: McpServer, env: Env) {
  server.tool(
    "get_context",
    "Retrieve a specific context entry by its path within a project.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("Path to the entry, e.g., 'decisions/chose-postgres.md'"),
    },
    async ({ project, path }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const entry = await getEntry(db, proj.id, path);
      if (!entry) return { content: [{ type: "text", text: `No entry found at "${path}".` }] };

      return {
        content: [{ type: "text", text: entry.content }],
      };
    }
  );

  server.tool(
    "search_context",
    "Search across all context in a project using keywords. Use this to find relevant decisions, conventions, or documentation.",
    {
      project: z.string().describe("Project name"),
      query: z.string().describe("Search query (keywords)"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      folder: z.string().optional().describe("Limit search to a folder path prefix"),
    },
    async ({ project, query, tags, folder }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const results = await searchEntries(db, proj.id, query, { tags, folder });

      if (!results.length) {
        return { content: [{ type: "text", text: `No results found for "${query}".` }] };
      }

      const formatted = results.map((e) =>
        `### ${e.path}\n*Tags: ${e.tags.join(", ") || "none"}*\n\n${e.content.slice(0, 500)}${e.content.length > 500 ? "..." : ""}`
      ).join("\n\n---\n\n");

      return {
        content: [{ type: "text", text: `Found ${results.length} result(s):\n\n${formatted}` }],
      };
    }
  );

  server.tool(
    "list_context",
    "List all entries in a project or within a specific folder. Returns paths, types, and tags.",
    {
      project: z.string().describe("Project name"),
      folder: z.string().optional().describe("Folder path to list (omit for full project tree)"),
    },
    async ({ project, folder }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const entries = await listEntries(db, proj.id, folder);

      if (!entries.length) {
        return { content: [{ type: "text", text: folder ? `No entries in "${folder}".` : "Project is empty." }] };
      }

      const tree = entries.map((e) =>
        `- ${e.path} (${e.content_type}${e.tags.length ? `, tags: ${e.tags.join(", ")}` : ""})`
      ).join("\n");

      return {
        content: [{ type: "text", text: tree }],
      };
    }
  );

  server.tool(
    "load_project_context",
    "Load project context based on your preference setting. Use at the start of a session to get relevant context.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const prefs = await getPreferences(db, userId, proj.id);

      switch (prefs.context_loading) {
        case "full": {
          const entries = await getAllEntries(db, proj.id);
          const formatted = entries.map((e) => `## ${e.path}\n\n${e.content}`).join("\n\n---\n\n");
          return { content: [{ type: "text", text: formatted || "Project is empty." }] };
        }
        case "smart": {
          const entries = await getRecentEntries(db, proj.id, 20);
          const formatted = entries.map((e) => `## ${e.path}\n\n${e.content}`).join("\n\n---\n\n");
          return { content: [{ type: "text", text: `Recent context (${entries.length} entries):\n\n${formatted}` }] };
        }
        case "on_demand": {
          const tree = await listEntries(db, proj.id);
          const treeText = tree.map((e) => `- ${e.path}`).join("\n");
          return { content: [{ type: "text", text: `Project tree (use get_context to fetch individual entries):\n\n${treeText}` }] };
        }
        case "summary_only": {
          const entries = await getAllEntries(db, proj.id);
          const summary = entries.map((e) => `- **${e.path}**: ${e.content.slice(0, 100)}...`).join("\n");
          return { content: [{ type: "text", text: `Project summary:\n\n${summary}` }] };
        }
      }
    }
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/context-retrieval.ts
git commit -m "feat: add context retrieval MCP tools (get, search, list, load)"
```

---

### Task 10: REST Routes for Projects + Team Management

**Files:**
- Create: `src/api/projects.ts`
- Modify: `src/index.ts` — mount project routes

- [ ] **Step 1: Create project REST routes**

Create `src/api/projects.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { authMiddleware } from "../lib/auth";
import { createSupabaseClient } from "../db/client";
import {
  createProject,
  listProjectsForUser,
  getProjectByName,
  getMemberRole,
  addMember,
  removeMember,
} from "../db/queries/projects";
import { findUserByEmail } from "../db/queries/users";
import { setPreference, getPreferences } from "../db/queries/preferences";
import { AppError, NotFoundError, ForbiddenError } from "../lib/errors";

const projects = new Hono<{ Bindings: Env }>();
projects.use("*", authMiddleware);

// POST /api/projects
projects.post("/", async (c) => {
  const user = c.get("user");
  const { name } = await c.req.json();
  if (!name) throw new AppError("name is required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const project = await createProject(db, name, user.id);
  return c.json(project, 201);
});

// GET /api/projects
projects.get("/", async (c) => {
  const user = c.get("user");
  const db = createSupabaseClient(c.env);
  const list = await listProjectsForUser(db, user.id);
  return c.json(list);
});

// POST /api/projects/:id/members
projects.post("/:id/members", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const { email, role } = await c.req.json();

  if (!email || !role) throw new AppError("email and role are required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (callerRole !== "owner") throw new ForbiddenError("Only project owners can invite members");

  const invitee = await findUserByEmail(db, email);
  if (!invitee) throw new NotFoundError(`No user found with email ${email}`);

  const member = await addMember(db, projectId, invitee.id, role);
  return c.json(member, 201);
});

// DELETE /api/projects/:id/members/:email
projects.delete("/:id/members/:email", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const email = c.req.param("email");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (callerRole !== "owner") throw new ForbiddenError("Only project owners can remove members");

  const target = await findUserByEmail(db, email);
  if (!target) throw new NotFoundError(`No user found with email ${email}`);

  await removeMember(db, projectId, target.id);
  return c.json({ ok: true });
});

// PUT /api/preferences/:project
projects.put("/preferences/:project", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const { key, value } = await c.req.json();

  if (!key || !value) throw new AppError("key and value are required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const prefs = await setPreference(db, user.id, proj.id, key, value);
  return c.json(prefs);
});

export { projects };
```

- [ ] **Step 2: Mount in index.ts**

Update `src/index.ts` — add:
```typescript
import { projects } from "./api/projects";

// ... after context routes
app.route("/api/projects", projects);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/api/projects.ts src/index.ts
git commit -m "feat: add REST routes for project and team management"
```

---

### Task 11: MCP Prompts & Resources

**Files:**
- Modify: `src/mcp/prompts.ts`
- Modify: `src/mcp/resources.ts`

- [ ] **Step 1: Implement MCP prompts**

Replace `src/mcp/prompts.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../lib/env";

export function registerPrompts(server: McpServer, env: Env) {
  server.prompt(
    "session_start",
    "Load relevant project context at the start of a session. Reminds you of capture conventions.",
    { project: z.string().describe("Project name to load context for") },
    async ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You have the mcp-sync context server connected. Project: "${project}".

To load this project's context, call the \`load_project_context\` tool with project="${project}".

**Auto-capture conventions:**
- When a technical decision is made → call \`save_context\` with path like \`decisions/<date>-<topic>.md\`
- When a convention or preference is established → call \`save_context\` with path like \`context/<topic>.md\`
- When architecture is discussed → call \`save_context\` with path like \`architecture/<topic>.md\`
- At the end of the session → call \`save_session_summary\` with a summary of what was done

Use \`search_context\` to find relevant prior context before starting work.`,
          },
        },
      ],
    })
  );

  server.prompt(
    "session_end",
    "Summarize the current session and save context. Use at the end of a working session.",
    {
      project: z.string().describe("Project name"),
      summary: z.string().describe("Brief summary of what was accomplished"),
    },
    async ({ project, summary }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Please save a session summary for project "${project}".

Summary: ${summary}

Call \`save_session_summary\` with:
- project: "${project}"
- summary: A well-structured summary of what was accomplished
- decisions: List any technical decisions that were made
- pending: List any items that still need follow-up

Also check if any individual decisions or conventions should be saved as separate context entries using \`save_context\`.`,
          },
        },
      ],
    })
  );
}
```

- [ ] **Step 2: Implement MCP resources**

Replace `src/mcp/resources.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import { listEntries, getEntry } from "../db/queries/entries";

export function registerResources(server: McpServer, env: Env) {
  // Resource template for project tree
  server.resource(
    "project-tree",
    "context://{project}/tree",
    "Browse the full folder tree of a project",
    async (uri) => {
      const project = uri.pathname.split("/")[1];
      const db = createSupabaseClient(env);

      // Note: resource access doesn't have auth context in MCP protocol.
      // For now, list all entries. Auth is handled at the transport level.
      const { data: proj } = await db
        .from("projects")
        .select("id")
        .eq("name", project)
        .single();

      if (!proj) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: "Project not found" }] };
      }

      const entries = await listEntries(db, proj.id);
      const tree = entries.map((e) => e.path).join("\n");

      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: tree }],
      };
    }
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/mcp/prompts.ts src/mcp/resources.ts
git commit -m "feat: add MCP prompt templates and resource handlers"
```

---

### Task 12: Google Docs Sync

**Files:**
- Create: `src/sync/to-google.ts`
- Create: `src/sync/from-google.ts`
- Modify: `src/mcp/tools/google-sync.ts`
- Create: `src/api/sync.ts`
- Modify: `src/api/auth.ts` — add Google OAuth routes
- Modify: `src/index.ts` — mount sync routes, add cron handler

- [ ] **Step 1: Implement DB → Google Docs sync**

Create `src/sync/to-google.ts`:
```typescript
import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import type { Entry, GoogleOAuthTokens } from "../db/types";

async function getAccessToken(env: Env, tokens: GoogleOAuthTokens): Promise<string> {
  if (Date.now() < tokens.expires_at) {
    return tokens.access_token;
  }

  // Refresh the token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json() as any;
  if (!data.access_token) throw new Error("Failed to refresh Google token");

  // Update stored tokens
  tokens.access_token = data.access_token;
  tokens.expires_at = Date.now() + data.expires_in * 1000;

  return data.access_token;
}

async function ensureDriveFolder(
  accessToken: string,
  parentId: string,
  folderName: string
): Promise<string> {
  // Check if folder exists
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json() as any;

  if (searchData.files?.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const created = await createRes.json() as any;
  return created.id;
}

async function upsertGoogleDoc(
  accessToken: string,
  folderId: string,
  entry: Entry
): Promise<string> {
  const fileName = entry.path.split("/").pop() ?? entry.path;

  if (entry.google_doc_id) {
    // Update existing doc
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${entry.google_doc_id}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
        },
        body: entry.content,
      }
    );
    return entry.google_doc_id;
  }

  // Create new file
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: entry.content_type === "json" ? "application/json" : "text/plain",
  };

  const boundary = "mcp_sync_boundary";
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${entry.content}\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const created = await res.json() as any;
  return created.id;
}

export async function syncProjectToGoogle(env: Env, projectId: string): Promise<{ synced: number }> {
  const db = createSupabaseClient(env);

  const { data: project } = await db
    .from("projects")
    .select("*, users!projects_owner_id_fkey(google_oauth_tokens)")
    .eq("id", projectId)
    .single();

  if (!project?.google_drive_folder_id) {
    throw new Error("Project has no linked Google Drive folder");
  }

  const tokens = (project as any).users?.google_oauth_tokens as GoogleOAuthTokens | null;
  if (!tokens) throw new Error("Project owner has not connected Google");

  const accessToken = await getAccessToken(env, tokens);

  // Update tokens if refreshed
  await db.from("users").update({ google_oauth_tokens: tokens }).eq("id", project.owner_id);

  const { data: entries } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId);

  let synced = 0;
  for (const entry of entries ?? []) {
    // Ensure folder path exists in Drive
    const pathParts = entry.path.split("/");
    let currentFolderId = project.google_drive_folder_id;

    for (let i = 0; i < pathParts.length - 1; i++) {
      currentFolderId = await ensureDriveFolder(accessToken, currentFolderId, pathParts[i]);
    }

    const googleDocId = await upsertGoogleDoc(accessToken, currentFolderId, entry as Entry);

    // Store the Google Doc ID on the entry
    if (!entry.google_doc_id) {
      await db.from("entries").update({ google_doc_id: googleDocId }).eq("id", entry.id);
    }

    synced++;
  }

  return { synced };
}
```

- [ ] **Step 2: Implement Google Docs → DB sync**

Create `src/sync/from-google.ts`:
```typescript
import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import type { GoogleOAuthTokens } from "../db/types";
import { upsertEntry } from "../db/queries/entries";

async function getAccessToken(env: Env, tokens: GoogleOAuthTokens): Promise<string> {
  if (Date.now() < tokens.expires_at) return tokens.access_token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json() as any;
  if (!data.access_token) throw new Error("Failed to refresh Google token");

  tokens.access_token = data.access_token;
  tokens.expires_at = Date.now() + data.expires_in * 1000;
  return data.access_token;
}

async function listDriveFiles(
  accessToken: string,
  folderId: string,
  modifiedAfter?: string
): Promise<any[]> {
  let query = `'${folderId}' in parents and trashed=false`;
  if (modifiedAfter) {
    query += ` and modifiedTime > '${modifiedAfter}'`;
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json() as any;
  return data.files ?? [];
}

async function getFileContent(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.text();
}

async function walkDriveFolder(
  accessToken: string,
  folderId: string,
  basePath: string,
  modifiedAfter?: string
): Promise<{ path: string; content: string; googleDocId: string }[]> {
  const files = await listDriveFiles(accessToken, folderId, modifiedAfter);
  const results: { path: string; content: string; googleDocId: string }[] = [];

  for (const file of files) {
    const filePath = basePath ? `${basePath}/${file.name}` : file.name;

    if (file.mimeType === "application/vnd.google-apps.folder") {
      const nested = await walkDriveFolder(accessToken, file.id, filePath, modifiedAfter);
      results.push(...nested);
    } else {
      const content = await getFileContent(accessToken, file.id);
      results.push({ path: filePath, content, googleDocId: file.id });
    }
  }

  return results;
}

export async function syncProjectFromGoogle(env: Env, projectId: string): Promise<{ synced: number }> {
  const db = createSupabaseClient(env);

  const { data: project } = await db
    .from("projects")
    .select("*, users!projects_owner_id_fkey(google_oauth_tokens)")
    .eq("id", projectId)
    .single();

  if (!project?.google_drive_folder_id) {
    throw new Error("Project has no linked Google Drive folder");
  }

  const tokens = (project as any).users?.google_oauth_tokens as GoogleOAuthTokens | null;
  if (!tokens) throw new Error("Project owner has not connected Google");

  const accessToken = await getAccessToken(env, tokens);

  // Update tokens if refreshed
  await db.from("users").update({ google_oauth_tokens: tokens }).eq("id", project.owner_id);

  // Look for files modified in the last 10 minutes (overlaps with 5-min cron for safety)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const files = await walkDriveFolder(
    accessToken,
    project.google_drive_folder_id,
    "",
    tenMinutesAgo
  );

  let synced = 0;
  for (const file of files) {
    await upsertEntry(db, {
      project_id: projectId,
      path: file.path,
      content: file.content,
      source: "google_docs",
    });

    // Link google_doc_id
    await db
      .from("entries")
      .update({ google_doc_id: file.googleDocId })
      .eq("project_id", projectId)
      .eq("path", file.path);

    synced++;
  }

  return { synced };
}

export async function runScheduledGoogleSync(env: Env): Promise<void> {
  const db = createSupabaseClient(env);

  // Find all projects with Google Drive linked
  const { data: projects } = await db
    .from("projects")
    .select("id")
    .not("google_drive_folder_id", "is", null);

  for (const project of projects ?? []) {
    try {
      await syncProjectFromGoogle(env, project.id);
    } catch (err) {
      console.error(`Google sync failed for project ${project.id}:`, err);
    }
  }
}
```

- [ ] **Step 3: Implement Google sync MCP tools**

Replace `src/mcp/tools/google-sync.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../../lib/env";
import { createSupabaseClient } from "../../db/client";
import { getProjectByName } from "../../db/queries/projects";
import { syncProjectToGoogle } from "../../sync/to-google";
import { syncProjectFromGoogle } from "../../sync/from-google";

export function registerGoogleSyncTools(server: McpServer, env: Env) {
  server.tool(
    "sync_to_google_docs",
    "Push all project context to the linked Google Drive folder. Requires Google Drive to be configured.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      try {
        const result = await syncProjectToGoogle(env, proj.id);
        return {
          content: [{ type: "text", text: `Synced ${result.synced} entries to Google Drive.` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Sync failed: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sync_from_google_docs",
    "Pull changes from the linked Google Drive folder back into the project. Picks up files added or edited in Drive.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }, extra) => {
      const db = createSupabaseClient(env);
      const userId = (extra as any).userId;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      try {
        const result = await syncProjectFromGoogle(env, proj.id);
        return {
          content: [{ type: "text", text: `Pulled ${result.synced} changed entries from Google Drive.` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Sync failed: ${err.message}` }],
        };
      }
    }
  );
}
```

- [ ] **Step 4: Create sync REST routes**

Create `src/api/sync.ts`:
```typescript
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { authMiddleware } from "../lib/auth";
import { createSupabaseClient } from "../db/client";
import { getProjectByName } from "../db/queries/projects";
import { syncProjectToGoogle } from "../sync/to-google";
import { syncProjectFromGoogle } from "../sync/from-google";
import { NotFoundError } from "../lib/errors";

const sync = new Hono<{ Bindings: Env }>();
sync.use("*", authMiddleware);

sync.post("/:project/to-google", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const result = await syncProjectToGoogle(c.env, proj.id);
  return c.json(result);
});

sync.post("/:project/from-google", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  const result = await syncProjectFromGoogle(c.env, proj.id);
  return c.json(result);
});

export { sync };
```

- [ ] **Step 5: Add Google OAuth routes**

Add to `src/api/auth.ts`:
```typescript
// Google OAuth connect flow
auth.get("/google/connect", async (c) => {
  const redirectUri = new URL("/auth/google/callback", c.req.url).href;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) throw new AppError("Missing code parameter", 400, "VALIDATION_ERROR");

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

  const tokens = await tokenRes.json() as any;
  if (!tokens.access_token) {
    throw new AppError("Failed to exchange code for tokens", 400, "OAUTH_ERROR");
  }

  // TODO: associate with the authenticated user
  // For now, return tokens for manual storage
  return c.json({
    message: "Google connected. Store these tokens securely.",
    note: "Use set_preference to link a Google Drive folder to your project.",
  });
});
```

- [ ] **Step 6: Wire everything into index.ts**

Update `src/index.ts` to final form:
```typescript
import { Hono } from "hono";
import type { Env } from "./lib/env";
import { AppError } from "./lib/errors";
import { auth } from "./api/auth";
import { context } from "./api/context";
import { projects } from "./api/projects";
import { sync } from "./api/sync";
import { McpSyncAgent } from "./mcp/agent";
import { runScheduledGoogleSync } from "./sync/from-google";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

app.get("/health", (c) => c.json({ status: "ok", service: "mcp-sync" }));

// Auth routes (no auth middleware)
app.route("/auth", auth);

// Authenticated routes
app.route("/api/context", context);
app.route("/api/projects", projects);
app.route("/api/sync", sync);

// Mount MCP server (Streamable HTTP transport)
app.mount("/mcp", McpSyncAgent.serve("/mcp").fetch);

// Export Durable Object class (required by Wrangler)
export { McpSyncAgent };

// Default export for Cloudflare Workers
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledGoogleSync(env));
  },
};
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/sync/ src/mcp/tools/google-sync.ts src/api/sync.ts src/api/auth.ts src/index.ts
git commit -m "feat: add Google Docs bidirectional sync with OAuth flow and cron trigger"
```

---

### Task 13: Integration Testing & Local Verification

**Files:**
- Create: `test/mcp/tools.test.ts`
- Modify: `test/api/health.test.ts` — verify all routes respond
- Create: `.dev.vars` — local development secrets template

- [ ] **Step 1: Create dev vars template**

Create `.dev.vars.example`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Add to `.gitignore`:
```
.dev.vars
node_modules/
dist/
.superpowers/
```

- [ ] **Step 2: Write route smoke tests**

Update `test/api/health.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";

// Import the default export (full worker)
import worker from "../../src/index";

describe("Route smoke tests", () => {
  it("GET /health returns 200", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("POST /auth/signup without body returns 400", async () => {
    const req = new Request("http://localhost/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });

  it("GET /api/projects without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("GET /api/context/myproject/list without auth returns 401", async () => {
    const req = new Request("http://localhost/api/context/myproject/list");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("unknown route returns 404", async () => {
    const req = new Request("http://localhost/nonexistent");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Run local dev server and verify**

Run: `npx wrangler dev --test-scheduled`
Test manually:
```bash
curl http://localhost:8787/health
# → {"status":"ok","service":"mcp-sync"}
```

- [ ] **Step 5: Commit**

```bash
git add test/ .dev.vars.example .gitignore
git commit -m "feat: add integration tests and dev vars template"
```

---

### Task 14: Final Wiring & Deploy Preparation

**Files:**
- Modify: `package.json` — add scripts
- Verify: all files compile and tests pass

- [ ] **Step 1: Add npm scripts**

Update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "wrangler dev --test-scheduled",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy",
    "db:migrate": "supabase db push"
  }
}
```

- [ ] **Step 2: Run full verification**

```bash
npm run typecheck && npm test
```
Expected: All checks pass

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add npm scripts for dev, test, typecheck, and deploy"
```

- [ ] **Step 4: Final verification — run local dev server**

```bash
npm run dev
```

Verify:
- `GET /health` → 200
- `POST /auth/signup` with body → works (needs Supabase)
- `GET /mcp` → MCP server responds (needs Durable Object)

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final adjustments for deployment readiness"
```
