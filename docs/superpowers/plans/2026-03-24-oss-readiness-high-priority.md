# OSS Readiness — High Priority Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 high-priority issues blocking open-source readiness: incomplete .gitignore, no monorepo tooling, duplicated types, plain-JS MCP server, no linter, and thin test coverage.

**Architecture:** Add npm workspaces at the root to unify the three packages (backend, frontend, mcp). Extract shared types into a `packages/shared` workspace. Convert the MCP server to TypeScript. Add Biome as the linter/formatter. Add unit tests for untested middleware.

**Tech Stack:** npm workspaces, TypeScript, Biome 1.x, Vitest

---

## File Map

### New files
- `package.json` — workspace root with unified scripts
- `biome.json` — Biome linter/formatter config
- `packages/shared/package.json` — shared types package
- `packages/shared/tsconfig.json` — TypeScript config for shared
- `packages/shared/src/types.ts` — canonical API/domain types
- `mcp/src/index.ts` — MCP server rewritten in TypeScript
- `mcp/tsconfig.json` — TypeScript config for MCP
- `backend/test/lib/rate-limit.test.ts` — rate limiter tests
- `backend/test/lib/tier.test.ts` — tier enforcement tests
- `backend/test/lib/idempotency.test.ts` — idempotency middleware tests

### Modified files
- `.gitignore` — add missing entries
- `backend/package.json` — add shared dep, rename to @synapse/backend
- `backend/src/db/types.ts` — re-export from shared + backend-only types
- `backend/src/lib/auth.ts` — import UserRow instead of User
- `backend/src/db/queries/users.ts` — return UserRow instead of User
- `backend/src/db/queries/api-keys.ts` — return UserRow instead of User
- `frontend/package.json` — add shared dep, rename to @synapse/frontend
- `frontend/src/lib/types.ts` — re-export from shared + frontend-only types
- `mcp/package.json` — convert to TypeScript build setup

### Deleted files
- `mcp/index.js` — replaced by `mcp/src/index.ts`
- `frontend/dist/` — build artifact that shouldn't be tracked
- `backend/test/api/auth.test.ts` — duplicate of `backend/test/lib/auth.test.ts`

---

### Task 1: Fix .gitignore and clean tracked artifacts

**Files:**
- Modify: `.gitignore`
- Delete (from tracking): `frontend/dist/`, `.DS_Store`

- [ ] **Step 1: Update .gitignore**

Replace the contents of `.gitignore` with:

```gitignore
# Dependencies
node_modules/
package-lock.json

# Build output
dist/
build/
.svelte-kit/

# Environment / secrets
.env
.env.*
!.env.example
.dev.vars
!.dev.vars.example

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Cloudflare
.wrangler/

# Project-specific
.superpowers/
.worktrees/
.mcp.json
```

- [ ] **Step 2: Remove tracked build artifacts**

```bash
git rm -r --cached frontend/dist/ 2>/dev/null || true
git rm --cached .DS_Store 2>/dev/null || true
```

- [ ] **Step 3: Commit**

```bash
git add -u
git add .gitignore
git commit -m "chore: fix .gitignore — add missing entries, remove tracked artifacts"
```

---

### Task 2: Add monorepo workspace root

**Files:**
- Create: `package.json` (root)
- Modify: `backend/package.json`
- Modify: `frontend/package.json`
- Modify: `mcp/package.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "synapse",
  "private": true,
  "workspaces": [
    "packages/*",
    "backend",
    "frontend",
    "mcp"
  ],
  "scripts": {
    "dev:backend": "npm run dev -w backend",
    "dev:frontend": "npm run dev -w frontend",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0"
  }
}
```

- [ ] **Step 2: Rename workspace packages to avoid name conflicts**

In `backend/package.json`, change `"name": "synapse"` to `"name": "@synapse/backend"`.

In `frontend/package.json`, change `"name": "synapse-frontend"` to `"name": "@synapse/frontend"`.

In `mcp/package.json`, keep `"name": "synapsesync-mcp"` (it's the npm publish name). Set `author` / `repository` to match the GitHub org (e.g. `metanmai`).

- [ ] **Step 3: Install from root**

```bash
npm install
```

- [ ] **Step 4: Verify workspace resolution**

```bash
npm run test -w @synapse/backend
```

Expected: existing backend tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json backend/package.json frontend/package.json mcp/package.json
git commit -m "chore: add npm workspaces monorepo root"
```

---

### Task 3: Create shared types package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@synapse/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/types.ts",
  "types": "./src/types.ts",
  "exports": {
    ".": "./src/types.ts"
  }
}
```

Note: Both consumers (backend and frontend) use bundlers (wrangler and vite) that can resolve `.ts` files directly — no build step needed for this package.

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create packages/shared/src/types.ts**

These are the API contract types — the shapes that cross the wire between backend, frontend, and MCP. The `source` field uses `string` (not a union literal) because the set of valid sources is configurable via env vars and may grow — the backend validates at runtime.

```typescript
// --- Core domain types shared by backend, frontend, and MCP ---

export type Tier = "free" | "pro";

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

- [ ] **Step 4: Install and commit**

```bash
npm install
git add packages/
git commit -m "feat: add @synapse/shared types package"
```

---

### Task 4: Wire shared types into backend and frontend

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/db/types.ts`
- Modify: `backend/src/lib/auth.ts`
- Modify: `backend/src/db/queries/users.ts`
- Modify: `backend/src/db/queries/api-keys.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Add shared dependency to backend**

In `backend/package.json`, add to `dependencies`:

```json
"@synapse/shared": "*"
```

- [ ] **Step 2: Refactor backend types**

Replace `backend/src/db/types.ts` with:

```typescript
// Re-export shared API contract types
export type {
  Tier,
  User,
  Project,
  Entry,
  EntryListItem,
  EntryHistory,
  ProjectMember,
  ShareLink,
  ActivityLogEntry,
} from "@synapse/shared";

// --- Backend-only types (not part of the API contract) ---

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Full database row for users — includes fields not sent to API clients.
 * Use this for anything that touches the DB directly (queries, auth middleware).
 * Use `User` (from shared) for API response types.
 */
export interface UserRow {
  id: string;
  email: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}

export interface UserPreferences {
  user_id: string;
  project_id: string;
  auto_capture: "aggressive" | "moderate" | "manual_only";
  context_loading: "full" | "smart" | "on_demand" | "summary_only";
}

export interface Subscription {
  id: string;
  user_id: string;
  provider: string;
  provider_subscription_id: string;
  provider_customer_id: string | null;
  status: "active" | "canceled" | "past_due" | "inactive";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

// Default tier limits — can be overridden by env vars
export function getTierLimitsFromEnv(env?: Record<string, string>) {
  return {
    free: {
      maxFiles: parseInt(env?.TIER_FREE_MAX_FILES ?? "50"),
      maxConnections: parseInt(env?.TIER_FREE_MAX_CONNECTIONS ?? "3"),
      maxHistoryVersions: parseInt(env?.TIER_FREE_MAX_HISTORY ?? "3"),
      maxMembers: parseInt(env?.TIER_FREE_MAX_MEMBERS ?? "2"),
    },
    pro: {
      maxFiles: parseInt(env?.TIER_PRO_MAX_FILES ?? "500"),
      maxConnections: parseInt(env?.TIER_PRO_MAX_CONNECTIONS ?? "0"),
      maxHistoryVersions: -1,
      maxMembers: 0,
    },
  };
}
```

- [ ] **Step 3: Update backend/src/lib/auth.ts**

Three changes:

1. Change import: `import type { User } from "../db/types"` → `import type { UserRow } from "../db/types"`
2. Change the Hono `ContextVariableMap`:

```typescript
declare module "hono" {
  interface ContextVariableMap {
    user: UserRow;
    tier: import("../db/types").Tier;
  }
}
```

3. Change the variable declaration inside `authMiddleware`:

```typescript
let user: UserRow | null = null;
```

- [ ] **Step 4: Update backend/src/db/queries/users.ts**

Change import and return types from `User` to `UserRow`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRow } from "../types";
import { singleOrNull } from "../query-helpers";

export async function createUser(
  db: SupabaseClient,
  email: string
): Promise<UserRow> {
  const { data, error } = await db
    .from("users")
    .insert({ email })
    .select()
    .single();

  if (error) throw error;
  return data as UserRow;
}

export async function findUserByEmail(
  db: SupabaseClient,
  email: string
): Promise<UserRow | null> {
  return singleOrNull<UserRow>(
    await db.from("users").select("*").eq("email", email).single()
  );
}

export async function findUserBySupabaseAuthId(
  db: SupabaseClient,
  supabaseAuthId: string
): Promise<UserRow | null> {
  return singleOrNull<UserRow>(
    await db.from("users").select("*").eq("supabase_auth_id", supabaseAuthId).single()
  );
}
```

- [ ] **Step 5: Update backend/src/db/queries/api-keys.ts**

Change the `User` import to `UserRow`:

```typescript
import type { UserRow, ApiKey } from "../types";
```

Update `findUserByApiKeyHash` return type:

```typescript
export async function findUserByApiKeyHash(
  db: SupabaseClient,
  keyHash: string
): Promise<{ user: UserRow; apiKeyId: string } | null> {
  // ... (body unchanged)
  return { user: data.users as unknown as UserRow, apiKeyId: data.id };
}
```

- [ ] **Step 6: Verify backend compiles**

```bash
npm run typecheck -w @synapse/backend
```

Expected: no type errors.

- [ ] **Step 7: Add shared dependency to frontend**

In `frontend/package.json`, add to `dependencies`:

```json
"@synapse/shared": "*"
```

- [ ] **Step 8: Refactor frontend types**

Replace `frontend/src/lib/types.ts` with:

```typescript
// Re-export shared types used directly by the frontend
export type {
  User,
  Entry,
  EntryListItem,
  EntryHistory,
  ShareLink,
  ActivityLogEntry,
} from "@synapse/shared";

// --- Frontend-specific types ---
// These extend the shared base with optional fields populated by API joins.
// We define them locally rather than re-exporting from shared because
// the frontend shapes include join fields (owner_email, role, email, etc.)
// that don't exist in the base API contract.

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  owner_email?: string;
  role?: string;
  google_drive_folder_id: string | null;
  created_at: string;
  project_members?: ProjectMember[];
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  joined_at: string;
  email?: string;
}
```

- [ ] **Step 9: Verify frontend compiles**

```bash
npm install
npm run check -w @synapse/frontend
```

Expected: no type errors.

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/src/db/types.ts backend/src/lib/auth.ts backend/src/db/queries/users.ts backend/src/db/queries/api-keys.ts frontend/package.json frontend/src/lib/types.ts
git commit -m "refactor: deduplicate types into @synapse/shared package"
```

---

### Task 5: Convert MCP server to TypeScript

**Files:**
- Modify: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/index.ts`
- Delete: `mcp/index.js`

- [ ] **Step 1: Update mcp/package.json**

```json
{
  "name": "synapsesync-mcp",
  "version": "0.2.0",
  "description": "MCP server for Synapse — shared AI context across tools and devices",
  "main": "dist/index.js",
  "bin": {
    "synapsesync-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc && node -e \"const fs=require('fs');const f='dist/index.js';fs.writeFileSync(f,'#!/usr/bin/env node\\n'+fs.readFileSync(f));fs.chmodSync(f,0o755)\"",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js"
  },
  "keywords": ["mcp", "synapse", "ai", "context", "claude", "chatgpt", "cursor"],
  "author": "tanmai",
  "license": "MIT",
  "type": "module",
  "files": ["dist/"],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.3"
  }
}
```

Key changes vs old:
- `"type": "module"` (was `"commonjs"`)
- `"main"` and `"bin"` point to `dist/` (was root `index.js`)
- `"files": ["dist/"]` (was `["index.js"]`)
- `build` script: runs `tsc` then prepends shebang (`tsc` strips shebangs)
- Version bumped to `0.2.0` (breaking: CJS → ESM)

- [ ] **Step 2: Create mcp/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create mcp/src/index.ts**

Full TypeScript conversion of `mcp/index.js`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";

const API_URL = process.env.SYNAPSE_API_URL || "https://synapse.tanmai.workers.dev";

// --- CLI commands (run before MCP server starts, no SDK needed) ---

interface LoginResponse {
  email: string;
  api_key: string;
  label: string;
}

interface SignupResponse {
  email: string;
  api_key: string;
}

interface ErrorResponse {
  error?: string;
}

const args = process.argv.slice(2);

if (args[0] === "login") {
  const emailIdx = args.indexOf("--email");
  const passIdx = args.indexOf("--password");
  const labelIdx = args.indexOf("--label");

  const email = emailIdx !== -1 ? args[emailIdx + 1] : null;
  const password = passIdx !== -1 ? args[passIdx + 1] : null;
  const label = labelIdx !== -1 ? args[labelIdx + 1] : "cli";

  if (!email || !password) {
    console.error("Usage: synapsesync-mcp login --email <email> --password <password> [--label <label>]");
    process.exit(1);
  }

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, label }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ErrorResponse;
      console.error(`Login failed: ${body.error || res.statusText}`);
      process.exit(1);
    }

    const data = (await res.json()) as LoginResponse;
    console.log(`\nLogged in as ${data.email}`);
    console.log(`API Key: ${data.api_key}`);
    console.log(`Label: ${data.label}`);
    console.log(`\nAdd this to your .mcp.json:`);
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            synapse: {
              command: "npx",
              args: ["synapsesync-mcp"],
              env: { SYNAPSE_API_KEY: data.api_key },
            },
          },
        },
        null,
        2,
      ),
    );
    console.log(`\nOr run: claude mcp add synapse npx synapsesync-mcp --env SYNAPSE_API_KEY=${data.api_key}`);
  } catch (err) {
    console.error(`Login failed: ${(err as Error).message}`);
    process.exit(1);
  }

  process.exit(0);
} else if (args[0] === "signup") {
  const emailIdx = args.indexOf("--email");
  const email = emailIdx !== -1 ? args[emailIdx + 1] : null;

  if (!email) {
    console.error("Usage: synapsesync-mcp signup --email <email>");
    process.exit(1);
  }

  try {
    const res = await fetch(`${API_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ErrorResponse;
      console.error(`Signup failed: ${body.error || res.statusText}`);
      process.exit(1);
    }

    const data = (await res.json()) as SignupResponse;
    console.log(`\nAccount created for ${data.email}`);
    console.log(`API Key: ${data.api_key}`);
    console.log(`\nAdd this to your .mcp.json:`);
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            synapse: {
              command: "npx",
              args: ["synapsesync-mcp"],
              env: { SYNAPSE_API_KEY: data.api_key },
            },
          },
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(`Signup failed: ${(err as Error).message}`);
    process.exit(1);
  }

  process.exit(0);
}

// --- MCP Server ---

const API_KEY = process.env.SYNAPSE_API_KEY;
const PASSPHRASE = process.env.SYNAPSE_PASSPHRASE;
const USER_EMAIL = process.env.SYNAPSE_USER_EMAIL;
const SOURCE = process.env.SYNAPSE_SOURCE || "claude";
const DEFAULT_PROJECT_NAME = process.env.SYNAPSE_PROJECT || "My Workspace";

if (!API_KEY) {
  console.error(
    "SYNAPSE_API_KEY is required. Run 'npx synapsesync-mcp login --email <email> --password <password>' to get one.",
  );
  process.exit(1);
}

// Auto-detect or create the user's project
let PROJECT: string | null = null;

interface ProjectResponse {
  name: string;
}

interface EntryListResponse {
  path: string;
  content_type: string;
  tags: string[];
  updated_at: string;
}

interface EntryResponse {
  path: string;
  content: string;
  source: string;
  tags: string[];
  updated_at: string;
}

interface HistoryResponse {
  id: string;
  content: string;
  source: string;
  changed_at: string;
}

async function getProject(): Promise<string> {
  if (PROJECT) return PROJECT;

  const projects = (await api("GET", "/api/projects")) as ProjectResponse[];
  if (projects.length > 0) {
    PROJECT = projects[0].name;
    return PROJECT;
  }

  const created = (await api("POST", "/api/projects", { name: DEFAULT_PROJECT_NAME })) as ProjectResponse;
  PROJECT = created.name;
  return PROJECT;
}

// --- E2E Encryption (matches frontend crypto.ts) ---

const ENC_PREFIX = "enc:v1:";
const PBKDF2_ITERATIONS = 100_000;

let derivedKey: Buffer | null = null;

async function deriveKeyNode(passphrase: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, PBKDF2_ITERATIONS, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function getEncKey(): Promise<Buffer | null> {
  if (derivedKey) return derivedKey;
  if (!PASSPHRASE || !USER_EMAIL) return null;
  derivedKey = await deriveKeyNode(PASSPHRASE, USER_EMAIL);
  return derivedKey;
}

async function encryptContent(plaintext: string): Promise<string> {
  const key = await getEncKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, authTag]);
  return `${ENC_PREFIX}${iv.toString("hex")}:${combined.toString("base64")}`;
}

async function decryptContent(text: string): Promise<string> {
  if (!text.startsWith(ENC_PREFIX)) return text;
  const key = await getEncKey();
  if (!key) return text;
  const payload = text.slice(ENC_PREFIX.length);
  const colonIdx = payload.indexOf(":");
  const ivHex = payload.slice(0, colonIdx);
  const ctBase64 = payload.slice(colonIdx + 1);
  const iv = Buffer.from(ivHex, "hex");
  const combined = Buffer.from(ctBase64, "base64");
  const authTag = combined.slice(-16);
  const ciphertext = combined.slice(0, -16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

// --- API client ---

const headers: Record<string, string> = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

// --- MCP Server definition ---

const server = new McpServer({
  name: "synapse",
  version: "0.2.0",
});

// --- ls: list files and folders ---
server.tool(
  "ls",
  "List files and folders. Like `ls` on a local filesystem. Returns directory contents with types and modification dates.",
  { path: z.string().optional().describe("Directory path to list. Omit for root.") },
  async ({ path }) => {
    const folder = path || "";
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
    const project = await getProject();
    const entries = (await api(
      "GET",
      `/api/context/${encodeURIComponent(project)}/list${qs}`,
    )) as EntryListResponse[];

    if (entries.length === 0) {
      return { content: [{ type: "text" as const, text: folder ? `${folder}/ is empty` : "(empty)" }] };
    }

    const lines = entries.map((e) => {
      const name = e.path.split("/").pop();
      const date = new Date(e.updated_at).toLocaleDateString();
      const tagStr = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
      return `  ${name}  (${date})${tagStr}`;
    });

    const header = folder || ".";
    return { content: [{ type: "text" as const, text: `${header}\n${lines.join("\n")}` }] };
  },
);

// --- read: read a file ---
server.tool(
  "read",
  "Read a file's content. Like `cat` on a local filesystem. Returns the full markdown/text content of the file at the given path.",
  { path: z.string().describe("File path to read (e.g. 'notes/meeting.md')") },
  async ({ path }) => {
    const project = await getProject();
    const entry = (await api(
      "GET",
      `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`,
    )) as EntryResponse;
    const meta = [
      `path: ${entry.path}`,
      `updated: ${new Date(entry.updated_at).toLocaleString()}`,
      `source: ${entry.source}`,
      entry.tags.length ? `tags: ${entry.tags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const content = await decryptContent(entry.content);
    return { content: [{ type: "text" as const, text: `${meta}\n---\n${content}` }] };
  },
);

// --- write: create or update a file ---
server.tool(
  "write",
  "Write content to a file. Creates the file if it doesn't exist, updates it if it does. IMPORTANT: Always use the correct directory prefix: decisions/ for decisions, notes/ for meeting notes, bugs/ for bug diagnoses, architecture/ for architecture docs, retrospectives/ for retrospectives, projects/<name>/ for project-specific context, settings/ for settings. Never write to the root — always use a directory.",
  {
    path: z
      .string()
      .describe(
        "File path with directory prefix (e.g. 'decisions/chose-redis.md', 'notes/standup-2026-03-22.md', 'bugs/auth-race.md', 'projects/myapp/overview.md'). Directories are created automatically.",
      ),
    content: z.string().describe("The full file content to write"),
    tags: z.array(z.string()).optional().describe("Optional tags for the file"),
  },
  async ({ path, content, tags }) => {
    const project = await getProject();
    const encrypted = await encryptContent(content);
    await api("POST", "/api/context/save", {
      project,
      path,
      content: encrypted,
      source: SOURCE,
      tags: tags || [],
    });
    return { content: [{ type: "text" as const, text: `Wrote ${path} (${content.length} chars)` }] };
  },
);

// --- rm: delete a file ---
server.tool(
  "rm",
  "Delete a file. Like `rm` on a local filesystem. Permanently removes the file (history is preserved).",
  { path: z.string().describe("File path to delete") },
  async ({ path }) => {
    const project = await getProject();
    await api("DELETE", `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`);
    return { content: [{ type: "text" as const, text: `Deleted ${path}` }] };
  },
);

// --- search: search file contents ---
server.tool(
  "search",
  "Search across all files by content. Like `grep -r` on a local filesystem. Returns matching files with their content.",
  {
    query: z.string().describe("Search query (searches file contents)"),
    folder: z.string().optional().describe("Limit search to a specific directory"),
    tags: z.string().optional().describe("Comma-separated tags to filter by"),
  },
  async ({ query, folder, tags }) => {
    const params = new URLSearchParams({ q: query });
    if (folder) params.set("folder", folder);
    if (tags) params.set("tags", tags);

    let results: EntryResponse[];
    try {
      results = (await api(
        "GET",
        `/api/context/${encodeURIComponent(await getProject())}/search?${params}`,
      )) as EntryResponse[];
    } catch {
      return { content: [{ type: "text" as const, text: `No results for "${query}"` }] };
    }

    if (results.length === 0) {
      return { content: [{ type: "text" as const, text: `No results for "${query}"` }] };
    }

    const decrypted = await Promise.all(
      results.map(async (e) => ({ ...e, content: await decryptContent(e.content) })),
    );
    const text = decrypted
      .map((e, i) => {
        const dir = e.path.includes("/") ? e.path.split("/").slice(0, -1).join("/") + "/" : "(root)";
        const tagStr = e.tags && e.tags.length ? `  tags: ${e.tags.join(", ")}` : "";
        const updated = new Date(e.updated_at).toLocaleDateString();
        const preview = e.content.slice(0, 300).replace(/\n/g, " ");
        return `[${i + 1}] ${e.path}\n  dir: ${dir} | updated: ${updated}${tagStr}\n  ${preview}${e.content.length > 300 ? "..." : ""}`;
      })
      .join("\n\n");

    return {
      content: [{ type: "text" as const, text: `${results.length} result${results.length === 1 ? "" : "s"}:\n\n${text}` }],
    };
  },
);

// --- history: view file version history ---
server.tool(
  "history",
  "View version history for a file. Shows past versions with timestamps and who made each change.",
  { path: z.string().describe("File path to get history for") },
  async ({ path }) => {
    const versions = (await api(
      "GET",
      `/api/context/${encodeURIComponent(await getProject())}/history/${encodeURIComponent(path)}`,
    )) as HistoryResponse[];

    if (versions.length === 0) {
      return { content: [{ type: "text" as const, text: `No history for ${path}` }] };
    }

    const decryptedVersions = await Promise.all(
      versions.map(async (v) => ({ ...v, content: await decryptContent(v.content) })),
    );
    const text = decryptedVersions
      .map((v, i) => {
        const date = new Date(v.changed_at).toLocaleString();
        const preview = v.content.slice(0, 100).replace(/\n/g, " ");
        return `[${i + 1}] ${date} (${v.source})\n    ${preview}...`;
      })
      .join("\n\n");

    return {
      content: [{ type: "text" as const, text: `${versions.length} versions of ${path}:\n\n${text}` }],
    };
  },
);

// --- tree: show full directory tree ---
server.tool(
  "tree",
  "Show the full directory tree. Like the `tree` command on a local filesystem.",
  {},
  async () => {
    const project = await getProject();
    const entries = (await api(
      "GET",
      `/api/context/${encodeURIComponent(project)}/list`,
    )) as EntryListResponse[];

    if (entries.length === 0) {
      return { content: [{ type: "text" as const, text: "(empty workspace)" }] };
    }

    const paths = entries.map((e) => e.path).sort();
    const lines = ["."];

    for (const p of paths) {
      const depth = p.split("/").length - 1;
      const indent = "  ".repeat(depth);
      const name = p.split("/").pop();
      lines.push(`${indent}${name}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// --- Start server ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 4: Delete old index.js**

```bash
git rm mcp/index.js
```

- [ ] **Step 5: Install, build, and verify**

```bash
cd mcp && npm install && npm run build
ls -la dist/index.js  # Should exist
head -1 dist/index.js  # Should show #!/usr/bin/env node
```

- [ ] **Step 6: Verify it runs**

```bash
cd mcp && node dist/index.js signup 2>&1 | head -1
```

Expected: prints usage message (since no --email provided), not a crash.

- [ ] **Step 7: Commit**

```bash
git add mcp/
git commit -m "refactor: convert MCP server to TypeScript (0.2.0)"
```

---

### Task 6: Add Biome linter and formatter

**Files:**
- Create: `biome.json` (root)

The root `package.json` already has `@biomejs/biome` as a devDep (added in Task 2) and lint/format scripts.

- [ ] **Step 1: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "style": {
        "noNonNullAssertion": "warn",
        "useConst": "error"
      },
      "correctness": {
        "noUnusedVariables": "warn",
        "noUnusedImports": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "files": {
    "ignore": [
      "node_modules",
      "dist",
      "build",
      ".svelte-kit",
      ".wrangler",
      "*.min.js"
    ]
  },
  "overrides": [
    {
      "include": ["*.svelte"],
      "linter": {
        "enabled": false
      }
    }
  ]
}
```

Notes:
- Biome 1.x (not 2.x) — stable, well-documented config format.
- Svelte files excluded from Biome linting (svelte-check handles those).
- Rules start lenient (`warn` for `noExplicitAny`) to avoid blocking contributors on day one.

- [ ] **Step 2: Install and run initial lint**

```bash
npm install
npx biome check .
```

Review the output. There will be lint errors.

- [ ] **Step 3: Auto-fix what Biome can**

```bash
npx biome check --write .
```

- [ ] **Step 4: Manually fix remaining issues**

Review any remaining errors that `--write` couldn't fix. Common ones:
- Unused imports (remove them)
- `var` that should be `const`

- [ ] **Step 5: Verify tests still pass**

```bash
npm run test -w @synapse/backend
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add biome.json
git add -u
git commit -m "chore: add Biome linter/formatter, fix lint errors"
```

---

### Task 7: Add middleware unit tests

**Files:**
- Create: `backend/test/lib/rate-limit.test.ts`
- Create: `backend/test/lib/tier.test.ts`
- Create: `backend/test/lib/idempotency.test.ts`
- Delete: `backend/test/api/auth.test.ts` (duplicate of `backend/test/lib/auth.test.ts`)

These three middleware modules have zero test coverage and are critical for correctness.

- [ ] **Step 1: Delete the duplicate auth test**

`backend/test/api/auth.test.ts` only tests `hashApiKey` (2 tests). `backend/test/lib/auth.test.ts` tests the same `hashApiKey` function with the same assertions. Delete the duplicate:

```bash
git rm backend/test/api/auth.test.ts
```

- [ ] **Step 2: Write rate-limit tests**

Create `backend/test/lib/rate-limit.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "../setup";
import worker from "../../src/index";

describe("Rate limiting", () => {
  it("returns rate limit headers on every response", async () => {
    const req = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("decrements remaining count across requests from the same IP", async () => {
    const ip = `rate-test-${Date.now()}`;

    const req1 = new Request("http://localhost/health", {
      headers: { "cf-connecting-ip": ip },
    });
    const ctx1 = createExecutionContext();
    const res1 = await worker.fetch(req1, env, ctx1);
    await waitOnExecutionContext(ctx1);

    const req2 = new Request("http://localhost/health", {
      headers: { "cf-connecting-ip": ip },
    });
    const ctx2 = createExecutionContext();
    const res2 = await worker.fetch(req2, env, ctx2);
    await waitOnExecutionContext(ctx2);

    const remaining1 = parseInt(res1.headers.get("X-RateLimit-Remaining") ?? "0");
    const remaining2 = parseInt(res2.headers.get("X-RateLimit-Remaining") ?? "0");
    expect(remaining2).toBeLessThan(remaining1);
  });
});
```

- [ ] **Step 3: Run rate-limit tests**

```bash
npm run test -w @synapse/backend
```

Expected: PASS

- [ ] **Step 4: Write tier enforcement tests**

Create `backend/test/lib/tier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getTierLimitsFromEnv } from "../../src/db/types";

describe("getTierLimitsFromEnv", () => {
  it("returns default free tier limits", () => {
    const limits = getTierLimitsFromEnv();
    expect(limits.free.maxFiles).toBe(50);
    expect(limits.free.maxConnections).toBe(3);
    expect(limits.free.maxHistoryVersions).toBe(3);
    expect(limits.free.maxMembers).toBe(2);
  });

  it("returns default pro tier limits", () => {
    const limits = getTierLimitsFromEnv();
    expect(limits.pro.maxFiles).toBe(500);
    expect(limits.pro.maxConnections).toBe(0);
    expect(limits.pro.maxHistoryVersions).toBe(-1);
    expect(limits.pro.maxMembers).toBe(0);
  });

  it("respects env var overrides", () => {
    const limits = getTierLimitsFromEnv({
      TIER_FREE_MAX_FILES: "100",
      TIER_PRO_MAX_FILES: "1000",
    });
    expect(limits.free.maxFiles).toBe(100);
    expect(limits.pro.maxFiles).toBe(1000);
    // Non-overridden values keep defaults
    expect(limits.free.maxConnections).toBe(3);
  });

  it("uses defaults when env vars are undefined", () => {
    const limits = getTierLimitsFromEnv({});
    expect(limits.free.maxFiles).toBe(50);
  });

  it("handles NaN env vars gracefully", () => {
    const limits = getTierLimitsFromEnv({
      TIER_FREE_MAX_FILES: "not-a-number",
    });
    expect(limits.free.maxFiles).toBeNaN();
  });
});
```

- [ ] **Step 5: Run tier tests**

```bash
npm run test -w @synapse/backend
```

Expected: PASS

- [ ] **Step 6: Write idempotency tests**

The idempotency middleware is only mounted on `/api/context` and `/api/projects` (both require auth), not globally. To test it without requiring a real database, we test the middleware function directly with a standalone Hono app:

Create `backend/test/lib/idempotency.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { idempotency } from "../../src/lib/idempotency";

// Create a minimal Hono app with just the idempotency middleware
function createTestApp() {
  let callCount = 0;
  const app = new Hono();
  app.use("*", idempotency as any);
  app.get("/test", (c) => {
    callCount++;
    return c.json({ count: callCount, time: Date.now() });
  });
  return { app, getCallCount: () => callCount };
}

describe("Idempotency middleware", () => {
  it("passes through normally when no Idempotency-Key header is set", async () => {
    const { app } = createTestApp();
    const res = await app.request("/test");

    expect(res.status).toBe(200);
    expect(res.headers.get("Idempotency-Replayed")).toBeNull();
  });

  it("replays cached response for duplicate Idempotency-Key", async () => {
    const { app, getCallCount } = createTestApp();
    const key = `test-idemp-${Date.now()}`;

    // First request
    const res1 = await app.request("/test", {
      headers: { "Idempotency-Key": key },
    });
    const body1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(getCallCount()).toBe(1);

    // Second request with same key — should replay, NOT call handler again
    const res2 = await app.request("/test", {
      headers: { "Idempotency-Key": key },
    });
    const body2 = await res2.json();

    expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
    expect(body2.count).toBe(body1.count);
    expect(getCallCount()).toBe(1); // Handler was NOT called a second time
  });

  it("treats different Idempotency-Keys as separate requests", async () => {
    const { app, getCallCount } = createTestApp();

    const res1 = await app.request("/test", {
      headers: { "Idempotency-Key": "key-a" },
    });
    const res2 = await app.request("/test", {
      headers: { "Idempotency-Key": "key-b" },
    });

    expect(res1.headers.get("Idempotency-Replayed")).toBeNull();
    expect(res2.headers.get("Idempotency-Replayed")).toBeNull();
    expect(getCallCount()).toBe(2);
  });
});
```

- [ ] **Step 7: Run all tests**

```bash
npm run test -w @synapse/backend
```

Expected: all tests PASS.

- [ ] **Step 8: Run lint on new test files**

```bash
npx biome check backend/test/
```

Fix any issues.

- [ ] **Step 9: Commit**

```bash
git add backend/test/
git commit -m "test: add unit tests for rate-limit, tier, and idempotency middleware"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full build, typecheck, test, and lint from root**

```bash
npm install
npm run typecheck --workspaces --if-present
npm run test --workspaces --if-present
npx biome check .
```

All should pass.

- [ ] **Step 2: Verify MCP builds cleanly**

```bash
npm run build -w synapsesync-mcp
head -1 mcp/dist/index.js
```

Expected: `#!/usr/bin/env node`

- [ ] **Step 3: Check git status is clean**

```bash
git status
```

No unexpected untracked files. `dist/`, `.DS_Store`, `.wrangler/`, `package-lock.json` should all be ignored.
