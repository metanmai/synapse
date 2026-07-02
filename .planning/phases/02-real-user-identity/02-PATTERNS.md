# Phase 2: Real User Identity — Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 16 (8 NEW, 8 EXTEND, plus one migration)
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| **NEW** `backend/src/api/auth.ts` (`/api/account/me` route added to existing `account` sub-app) | controller | request-response (authenticated GET) | `backend/src/api/auth.ts:469-475` (`account.get("/keys", ...)`) | exact |
| **NEW** `mcp/src/capture/identity.ts` | utility (config reader) | file-I/O (read-only) | `mcp/src/cli/handlers.ts:90-103` (existing duplicate) | exact (the function to extract) |
| **NEW** `mcp/src/cli/api.ts` (`fetchMe` added to existing API client) | service (HTTP client) | request-response | `mcp/src/cli/api.ts:12-28` (`validateApiKey`) | exact |
| **NEW** `supabase/migrations/018_projects_git_remote_url.sql` | migration | DDL (additive) | `supabase/migrations/017_project_invites.sql` | role-match |
| **NEW** `backend/src/api/projects.ts` (`POST /:id/merge-into/:target_id` added) | controller | request-response + RPC | `backend/src/api/auth.ts:518-536` (`/account/reset` — RPC call pattern) + `backend/src/api/projects.ts:76-101` (owner-check pattern) | exact composite |
| **NEW** SQL function `merge_projects(p_src, p_tgt, p_user)` (in migration 018 or 019) | DB function | DDL (RPC) | `supabase/migrations/010_reset_user_data.sql` | exact |
| **NEW** `frontend/src/lib/components/project-link/LinkPicker.svelte` | component | state-machine UI + form-action | `frontend/src/lib/components/account/DangerZone.svelte` | exact |
| **NEW** `backend/test/api/auth-me.test.ts` | test | unit (Hono in-worker) | `backend/test/api/projects.test.ts:1-115` | exact |
| **NEW** `backend/test/api/projects-merge.test.ts` | test | unit (Hono in-worker) | `backend/test/api/projects.test.ts` (auth-rejection structural pattern) | exact |
| **EXTEND** `mcp/src/cli/handlers.ts:90-103` | utility | file-I/O | self (collapse into `mcp/src/capture/identity.ts`) | self-replace |
| **EXTEND** `mcp/src/cli/run-daemon.ts:30-37` | service entry | file-I/O | self (collapse into `mcp/src/capture/identity.ts`) | self-replace |
| **EXTEND** `mcp/src/cli/init.ts:59-89` (`runInit` + `writeConfig`) | service (orchestrator) | request-response + file-I/O | self (existing pattern), extended | extension of self |
| **EXTEND** `mcp/src/cli/hook-dispatch.ts:57-68` (`readHookPayloadFromStdin`) | utility (event-shaper) | event-driven | `mcp/src/cli/resolve-project.ts:23-39` (`readGitSignals`) | role-match (for git-remote read) |
| **EXTEND** `backend/src/api/events-batch.ts:82-115` (matcher) | controller | event-driven (batch ingest) | self (existing matcher), extended | extension of self |
| **EXTEND** `mcp/src/capture/handoff-sync.ts` (add `runEagerPullCycle`) | service | streaming pull | `mcp/src/capture/handoff-sync.ts:72-84` (`runPullCycle`) | exact |
| **EXTEND** `mcp/src/capture/daemon.ts:144-158` (cycle loop) | service (loop) | event-driven | self (existing cycle), extended | extension of self |
| **EXTEND** `mcp/src/capture/handoff-brief.ts:17-43` (`render`) | utility (renderer) | transform | self (existing render), extended | extension of self |
| **EXTEND** `mcp/src/hooks/session-start.ts:39-47` (payload assembly) | hook handler | event-driven | self (existing payload), extended | extension of self |
| **EXTEND** `frontend/src/routes/(app)/projects/[name]/settings/+page.svelte` (mount LinkPicker) | route page | composition | self (existing Members section), extended | extension of self |
| **EXTEND** `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` (add `linkProject` action) | route loader/action | form-action | self + `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts:11-26` (`addMember` action) | exact |
| **EXTEND** test files: `mcp/test/cli/init.test.ts`, `hook-dispatch.test.ts`, `capture/handoff-sync.test.ts`, `capture/handoff-brief.test.ts`, `events-batch-auto-create.test.ts` | tests | unit / e2e | self, each follows local file conventions | extension of self |

---

## Pattern Assignments

### NEW `backend/src/api/auth.ts` — add `GET /api/account/me` route (D-02)

**Analog:** `backend/src/api/auth.ts:469-475` (`account.get("/keys", ...)`)

**Imports pattern** — already present in `backend/src/api/auth.ts:1-30`; no new imports required for the route itself. The Hono sub-app `account` and `authMiddleware` are already mounted (line 433-434).

**Auth pattern** — handled by the sub-app middleware mount (already in place):
```typescript
// backend/src/api/auth.ts:432-434
export const account = new Hono<{ Bindings: Env }>();
account.use("*", authMiddleware);
```

**Core single-purpose GET pattern** — copy from `account.get("/keys", ...)` at `backend/src/api/auth.ts:469-475`:
```typescript
// EXISTING — backend/src/api/auth.ts:469-475
account.get("/keys", async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const keys = await listApiKeys(db, user.id);
  return c.json(keys);
});
```

**New route to add** (lands between lines 475 and 478, or anywhere inside the `account` sub-app block):
```typescript
// NEW — same file, same sub-app
account.get("/me", async (c) => {
  const user = c.get("user");
  const tier = c.get("tier");
  return c.json({
    user_id: user.id,
    email: user.email,
    tier,
  });
});
```

**`c.var.user` shape** — `UserRow` set by `authMiddleware` at `backend/src/lib/auth.ts:86`. `c.var.tier` set at `backend/src/lib/auth.ts:89-91` (`"free" | "plus"`). No `parseBody` needed (GET has no body).

**Error handling** — none required at route level. `authMiddleware` throws `UnauthorizedError` (401) for invalid/missing tokens; global `app.onError` in `backend/src/index.ts:51-65` serialises it. The standard contract per `.planning/codebase/CONVENTIONS.md` §Error Handling is "throw, never inline c.json({error}, 4xx)" — but this route has no failure path beyond auth.

---

### NEW `mcp/src/capture/identity.ts` — extract `readUserIdFromConfig` helper

**Analog:** `mcp/src/cli/handlers.ts:90-103` (the existing duplicate to extract)

**Imports pattern** — node built-ins only, matches `.planning/codebase/CONVENTIONS.md` §Imports (node-protocol prefix mandatory):
```typescript
// NEW file — mcp/src/capture/identity.ts
import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";  // co-located helper; same .js convention
```

**Core file-I/O pattern** — extracted verbatim from `mcp/src/cli/handlers.ts:90-103`:
```typescript
// EXISTING source — mcp/src/cli/handlers.ts:90-103
function readUserIdFromConfig(): string {
  try {
    const root = process.env.SYNAPSE_HOME ?? path.join(process.env.HOME ?? "", ".synapse");
    const configPath = path.join(root, "config.json");
    if (!fs.existsSync(configPath)) return "local-user";
    const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      user_id?: string;
      email?: string;
    };
    return c.user_id ?? c.email ?? "local-user";
  } catch {
    return "local-user";
  }
}
```

**Extracted version (with named export + use `synapseRoot()` instead of inline path)** — recommended shape that all three callers consume:
```typescript
// NEW — mcp/src/capture/identity.ts
export function readUserIdFromConfig(): string {
  try {
    const configPath = path.join(synapseRoot(), "config.json");
    if (!fs.existsSync(configPath)) return "local-user";
    const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      user_id?: string;
      email?: string;
    };
    return c.user_id ?? c.email ?? "local-user";
  } catch {
    return "local-user";
  }
}
```

**Why `mcp/src/capture/` not `mcp/src/cli/util/`** — per RESEARCH D1 (line 800-803): co-locate with `actor.ts` since identity is the user-half of the actor concept. The `synapseRoot()` helper already lives in `mcp/src/capture/handoff-paths.ts`.

**Anti-pattern (per RESEARCH line 418):** Do NOT cache the config read in module-level state. Read fresh on every call (cost = one ~500-byte `fs.readFileSync` per hook).

---

### EXTEND `mcp/src/cli/handlers.ts:90-103` — replace with import

**Analog:** itself (the extraction target)

**Current state** — `mcp/src/cli/handlers.ts:90-103` carries the duplicate.

**After extraction**:
```typescript
// mcp/src/cli/handlers.ts — top of file imports
import { readUserIdFromConfig } from "../capture/identity.js";

// ... and DELETE lines 90-103 (the function definition).
// handlerContext() at line 105-111 already calls readUserIdFromConfig() — no change needed there.
```

---

### EXTEND `mcp/src/cli/run-daemon.ts:30-37` — replace inline config read

**Analog:** itself (the extraction target)

**Current state** — `mcp/src/cli/run-daemon.ts:30-37` reads config.json inline:
```typescript
// EXISTING — mcp/src/cli/run-daemon.ts:29-37
  const root = synapseRoot();
  const configPath = path.join(root, "config.json");
  const config = fs.existsSync(configPath)
    ? (JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
        api_key?: string;
        user_id?: string;
      })
    : {};
  const apiKey = config.api_key ?? process.env.SYNAPSE_API_KEY;
```

**After extraction** — keep the `api_key` read inline (it's not user_id; different concern) but replace the user_id branch by passing `readUserIdFromConfig()` to `startHandoffLoop`:
```typescript
// EXTENDED — mcp/src/cli/run-daemon.ts
import { readUserIdFromConfig } from "../capture/identity.js";

// in runDaemon():
const stop = startFn({
  projects,
  api_key: apiKey,
  api_url: API_URL,
  user_id: readUserIdFromConfig(),  // was: config.user_id (may be undefined)
});
```

Note: the daemon's existing path coexists with the new shared helper — both read the same `config.json`, but the helper centralises the placeholder-fallback logic.

---

### NEW `mcp/src/cli/api.ts` — add `fetchMe` (extend existing file)

**Analog:** `mcp/src/cli/api.ts:12-28` (`validateApiKey`)

**Imports pattern** — already present:
```typescript
// EXISTING — mcp/src/cli/api.ts:1-9
import { API_URL } from "./config.js";

interface ErrorResponse {
  error?: string;
}

type AuthResult<T> = { ok: true; data: T } | { ok: false; message: string };
```

**Core request-response pattern** — copy the shape from `validateApiKey`:
```typescript
// EXISTING — mcp/src/cli/api.ts:11-28
export async function validateApiKey(apiKey: string): Promise<{ status: KeyStatus }> {
  try {
    const res = await fetch(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return { status: "valid" };
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "UNAUTHORIZED" || body.code === "AUTH_ERROR") return { status: "expired" };
    }
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}
```

**New function to add** — D-05 fail-fast semantics differ from `validateApiKey` (must throw, not return a status union) per RESEARCH §Common Operation 1 (lines 522-558):
```typescript
// NEW — mcp/src/cli/api.ts (append)
export interface MeResponse {
  user_id: string;
  email: string;
  tier?: "free" | "plus";
}

export async function fetchMe(apiKey: string): Promise<MeResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/account/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(
      `Could not reach ${API_URL}/api/account/me: ${(err as Error).message}. ` +
      `Check your network — if you're on a proxy (Netskope, corporate firewall), ` +
      `tether to a different network and retry.`,
    );
  }
  if (res.status === 401) {
    throw new Error(`API key rejected by server (401). Run 'synapse login' or paste a fresh key from synapsesync.app.`);
  }
  if (!res.ok) {
    throw new Error(`/api/account/me returned ${res.status} ${res.statusText} — cannot proceed.`);
  }
  const body = (await res.json()) as MeResponse;
  if (!body.user_id || !body.email) {
    throw new Error(`/api/account/me returned invalid shape: ${JSON.stringify(body)}`);
  }
  return body;
}
```

**Note on timeout:** `validateApiKey` uses 5000ms; `fetchMe` uses 10000ms because (a) `runInit` is interactive and a slower failure message is acceptable, (b) Netskope-proxied first connections can take longer. Per RESEARCH §Common Operation 1, both choices align with CONVENTIONS.md §Error Handling ("error messages cite the failing operation").

---

### EXTEND `mcp/src/cli/init.ts:59-89` — call fetchMe FIRST + persist user_id

**Analog:** self — extend the existing `runInit` flow

**Imports to add:**
```typescript
import { fetchMe, type MeResponse } from "./api.js";
```

**Current `runInit` structure** (`mcp/src/cli/init.ts:59-89`) — calls `installHooks`, `installSlashCommands`, `writeConfig(a.api_key)`, `editorIo.writeMcpJson`, `editorIo.ensureGitignore`, then `writeServiceFile`.

**D-05 fail-fast ordering rule:** `fetchMe(a.api_key)` MUST run BEFORE any disk write. If it throws, no `~/.synapse/config.json` is written, no hooks installed, no slash commands installed, no `.mcp.json` written. Per RESEARCH §Pitfall 1 (lines 458-462).

**New `runInit` structure:**
```typescript
// EXTENDED — mcp/src/cli/init.ts
export async function runInit(a: InitArgs): Promise<void> {
  // STEP 1 — Fail-fast on identity fetch. Any throw exits the caller (wizard
  // or direct CLI) with the error message from fetchMe(). No disk writes before this point.
  const identity = await fetchMe(a.api_key);

  // STEP 2 — Existing flow, unchanged except for writeConfig signature
  const bin = resolveBin();
  installHooks(bin);
  installSlashCommands(bin);
  writeConfig(a.api_key, identity);  // signature change — see below

  const cwd = process.cwd();
  const mcpPath = path.join(cwd, ".mcp.json");
  editorIo.writeMcpJson(mcpPath, a.api_key);
  editorIo.ensureGitignore(cwd, ".mcp.json");

  if (!a.skip_service) {
    const svc = writeServiceFile();
    console.log(`[synapse init] OS service registered: ${svc.path}`);
  }

  // BUG-03 npx probe — unchanged
  const resolved = resolveSynapseMcpCommand(a.api_key);
  if (resolved.command === "npx") {
    const reachable = await probeNpmRegistry();
    if (!reachable) {
      console.warn(`[synapse init] ${PROXY_FALLBACK_WARNING}`);
    }
  }
}
```

**`writeConfig` extension** — existing at `mcp/src/cli/init.ts:182-196`:
```typescript
// EXISTING — mcp/src/cli/init.ts:182-196
interface SynapseConfig {
  api_key?: string;
}

function writeConfig(api_key: string): void {
  const dir = synapseRoot();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing: SynapseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  existing.api_key = api_key;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
```

**Extended `writeConfig`** — preserves existing-fields idempotence (RESEARCH §Pattern 2, lines 184-208):
```typescript
// EXTENDED — mcp/src/cli/init.ts
interface SynapseConfig {
  api_key?: string;
  user_id?: string;
  email?: string;
}

function writeConfig(api_key: string, identity: MeResponse): void {
  const dir = synapseRoot();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing: SynapseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  existing.api_key = api_key;
  existing.user_id = identity.user_id;
  existing.email = identity.email;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
```

**Wizard call site update** — `mcp/src/cli/wizard.ts:354` calls `await runInit({ api_key: apiKey })` and the wizard's `runEditorSetup` path catches errors per its existing `try/catch` pattern (see lines 170-174 of `wizard.ts` for the analog `clack.log.error((err as Error).message); process.exit(1);` exit shape). No additional change required in wizard — `fetchMe` throws propagate.

---

### EXTEND `mcp/src/cli/hook-dispatch.ts:57-68` — read user_id from config + capture git_remote_url

**Analog (for user_id read):** `mcp/src/cli/handlers.ts:90-103` (function being extracted to `identity.ts`)
**Analog (for git_remote_url read):** `mcp/src/cli/resolve-project.ts:23-39` (`readGitSignals`)

**Imports to add:**
```typescript
import { readUserIdFromConfig } from "../capture/identity.js";
// execSync already imported at hook-dispatch.ts:1
```

**Current state — `readHookPayloadFromStdin`** (`mcp/src/cli/hook-dispatch.ts:48-69`):
```typescript
// EXISTING — mcp/src/cli/hook-dispatch.ts:48-69
export async function readHookPayloadFromStdin(): Promise<AnyHookPayload> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const parsed = JSON.parse(raw);
  const cwd: string = parsed.cwd ?? process.cwd();
  const project_id = hashCwd(cwd);
  const git_basename = getGitBasename(cwd) ?? path.basename(cwd);
  return {
    project_id,
    user_id: process.env.SYNAPSE_USER_ID ?? "default",  // ← D-03 fix site
    session_id: parsed.session_id,
    tool: parsed.tool_name,
    input: parsed.tool_input,
    output: parsed.tool_response,
    prompt: parsed.prompt,
    subagent: parsed.subagent_type,
    git_basename,
    stdout: process.stdout,
  };
}
```

**Reusable git-signals pattern** — `mcp/src/cli/resolve-project.ts:23-39`:
```typescript
// EXISTING — mcp/src/cli/resolve-project.ts:23-39
function readGitSignals(cwd: string): { git_origin_url?: string; git_basename?: string } {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const match = url.match(/[/:]([^/:]+?)(?:\.git)?$/);
    return {
      git_origin_url: url || undefined,
      git_basename: match?.[1],
    };
  } catch {
    return {};
  }
}
```

**Extended `readHookPayloadFromStdin`** — per RESEARCH §Common Operation 2 (lines 562-595):
```typescript
// EXTENDED — mcp/src/cli/hook-dispatch.ts
const gitRemoteCache = new Map<string, string | undefined>();

function getGitRemoteUrl(cwd: string): string | undefined {
  if (gitRemoteCache.has(cwd)) return gitRemoteCache.get(cwd);
  let url: string | undefined;
  try {
    const out = execSync("git config --get remote.origin.url", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    url = out || undefined;
  } catch {
    url = undefined;
  }
  gitRemoteCache.set(cwd, url);
  return url;
}

export async function readHookPayloadFromStdin(): Promise<AnyHookPayload> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const parsed = JSON.parse(raw);
  const cwd: string = parsed.cwd ?? process.cwd();
  const project_id = hashCwd(cwd);
  const git_basename = getGitBasename(cwd) ?? path.basename(cwd);
  return {
    project_id,
    user_id: process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig(),  // env wins per D-03
    session_id: parsed.session_id,
    tool: parsed.tool_name,
    input: parsed.tool_input,
    output: parsed.tool_response,
    prompt: parsed.prompt,
    subagent: parsed.subagent_type,
    git_basename,
    git_remote_url: getGitRemoteUrl(cwd),
    stdout: process.stdout,
  };
}
```

**Anti-pattern (per RESEARCH lines 417-419):** Read fresh on every hook dispatch (the `gitRemoteCache` is per-process, in-memory only — same process across hooks within one Claude Code session). Do NOT persist this cache to disk.

---

### EXTEND `mcp/src/hooks/session-start.ts:39-47` — include git_remote_url in payload

**Analog:** self — extend the existing payload assembly.

**Current state** — `mcp/src/hooks/session-start.ts:39-47`:
```typescript
// EXISTING — mcp/src/hooks/session-start.ts:39-47
appendEvent(projectDir(args.project_id), {
  project_id: args.project_id,
  session_id,
  actor,
  attached_to: null,
  kind: EventKind.SessionOpened,
  occurred_at: new Date().toISOString(),
  payload: { hostname: actor.hostname, ...(args.git_basename ? { git_basename: args.git_basename } : {}) },
});
```

**Extended state** — adds `git_remote_url` conditionally (mirrors the existing `git_basename` spread pattern). Also update the `SessionStartArgs` interface (lines 10-17) to accept `git_remote_url?: string`:
```typescript
// EXTENDED — mcp/src/hooks/session-start.ts
export interface SessionStartArgs {
  project_id: string;
  user_id: string;
  stdout: NodeJS.WriteStream;
  skipFallback?: boolean;
  git_basename?: string;
  git_remote_url?: string;  // NEW
  cwd?: string;
}

// in runSessionStartHook:
appendEvent(projectDir(args.project_id), {
  project_id: args.project_id,
  session_id,
  actor,
  attached_to: null,
  kind: EventKind.SessionOpened,
  occurred_at: new Date().toISOString(),
  payload: {
    hostname: actor.hostname,
    ...(args.git_basename ? { git_basename: args.git_basename } : {}),
    ...(args.git_remote_url ? { git_remote_url: args.git_remote_url } : {}),
  },
});
```

---

### EXTEND `backend/src/api/events-batch.ts:71-121` — git_remote_url-first matcher

**Analog:** self — extend the existing auto-create matcher.

**Current state** (auto-create loop, `backend/src/api/events-batch.ts:71-121`):
```typescript
// EXISTING — backend/src/api/events-batch.ts:82-115
for (const cwdHash of cwdHashIds) {
  const sample = body.events.find((e) => String(e.project_id) === cwdHash);
  const payload = (sample?.payload ?? {}) as { git_basename?: string };
  const gitBasename = payload.git_basename ?? "untitled";

  let existingId: string | null = null;
  if (memberProjectIds.length > 0) {
    const { data: existing } = await db
      .from("projects")
      .select("id")
      .eq("name", gitBasename)
      .in("id", memberProjectIds)
      .maybeSingle();
    existingId = (existing as { id: string } | null)?.id ?? null;
  }

  if (existingId) {
    idMapping.set(cwdHash, existingId);
    continue;
  }

  const { data: created, error: createErr } = await db
    .from("projects")
    .insert({ name: gitBasename, owner_id: user.id })
    .select("id")
    .single();
  // ... project_members insert
}
```

**Extended state** — per RESEARCH §Pattern 4 (lines 252-317). Three changes: (1) URL match first, (2) backfill URL on name-match, (3) populate URL on create.
```typescript
// EXTENDED — backend/src/api/events-batch.ts
for (const cwdHash of cwdHashIds) {
  const sample = body.events.find((e) => String(e.project_id) === cwdHash);
  const payload = (sample?.payload ?? {}) as {
    git_basename?: string;
    git_remote_url?: string;  // NEW
  };
  const gitBasename = payload.git_basename ?? "untitled";
  const gitRemoteUrl = payload.git_remote_url ?? null;

  let existingId: string | null = null;

  // 1. NEW: git_remote_url match (higher precision; cross-device link signal)
  if (gitRemoteUrl && memberProjectIds.length > 0) {
    const { data: byUrl } = await db
      .from("projects")
      .select("id")
      .eq("git_remote_url", gitRemoteUrl)
      .in("id", memberProjectIds)
      .maybeSingle();
    existingId = (byUrl as { id: string } | null)?.id ?? null;
  }

  // 2. Fall back to name match (status quo)
  if (!existingId && memberProjectIds.length > 0) {
    const { data: byName } = await db
      .from("projects")
      .select("id")
      .eq("name", gitBasename)
      .in("id", memberProjectIds)
      .maybeSingle();
    existingId = (byName as { id: string } | null)?.id ?? null;

    // NEW: opportunistic backfill — link future events of this user via URL fast-path
    if (existingId && gitRemoteUrl) {
      await db
        .from("projects")
        .update({ git_remote_url: gitRemoteUrl })
        .eq("id", existingId)
        .is("git_remote_url", null);
    }
  }

  if (existingId) {
    idMapping.set(cwdHash, existingId);
    continue;
  }

  // 3. Create with both name AND git_remote_url
  const { data: created, error: createErr } = await db
    .from("projects")
    .insert({ name: gitBasename, owner_id: user.id, git_remote_url: gitRemoteUrl })
    .select("id")
    .single();
  if (createErr) throw createErr;
  // ... project_members insert unchanged
}
```

**`actor_user_id` override at line 60 must stay** — per RESEARCH §Pitfall 9 (line 514-518). The line `actor_user_id: user.id` is the server-side guard; do not remove or replace it.

---

### NEW `supabase/migrations/018_projects_git_remote_url.sql`

**Analog:** `supabase/migrations/017_project_invites.sql`

**Migration naming pattern** (per `.planning/codebase/STRUCTURE.md` §New Supabase migration):
- Next sequential number: `018_*` after `017_project_invites.sql`
- `snake_case`, no date suffix, monotonic
- Use `add column if not exists` / `create index if not exists` for idempotence

**Pattern from `017_project_invites.sql`** (compact, alter-table-style migration):
```sql
-- EXISTING — supabase/migrations/017_project_invites.sql:1-24
-- 017_project_invites.sql
-- v1.1 invite flow: ...

create table if not exists project_invites (
  token text primary key,
  project_id uuid not null references projects(id) on delete cascade,
  -- ...
);

create index project_invites_email_idx on project_invites(email);
create index project_invites_project_id_idx on project_invites(project_id);

alter table project_invites enable row level security;

create policy project_invites_member_read on project_invites for select
  using (exists (select 1 from project_members pm where pm.project_id = project_invites.project_id and pm.user_id = auth.uid()));
```

**New migration** — per RESEARCH §Common Operation 3 (lines 608-633):
```sql
-- NEW — supabase/migrations/018_projects_git_remote_url.sql
-- Phase 2 D-06: add git_remote_url column to projects for cross-device link matching.
--
-- Daemon writes the URL into the event payload at hook-write time
-- (mcp/src/cli/hook-dispatch.ts). Backend events-batch matcher
-- (backend/src/api/events-batch.ts) consults this column when resolving
-- cwd_<hash> placeholder project_ids — same user + same URL = same project,
-- regardless of which machine emitted the event.
--
-- Nullable: pre-existing projects don't have URLs until their first post-Phase-2
-- event arrives (the matcher backfills opportunistically when it matches by name).
-- Non-git folders never populate this — they fall through to name matching.

alter table projects
  add column if not exists git_remote_url text;

-- Lookup index for the matcher hot path. Composite with owner_id because
-- the query is always scoped by membership (events-batch.ts already filters
-- by project_members.user_id; this index speeds the inner lookup).
create index if not exists projects_user_remote_url_idx
  on projects(owner_id, git_remote_url)
  where git_remote_url is not null;
```

**RLS** — `projects` already has RLS enabled in `001_initial_schema.sql`; adding a column doesn't change policies. The service-role Worker bypasses RLS (`backend/src/db/client.ts`), so no policy update needed.

---

### NEW `backend/src/api/projects.ts` — add `POST /:id/merge-into/:target_id` (D-07)

**Analog (RPC call shape):** `backend/src/api/auth.ts:518-536` (`/account/reset` calling `db.rpc("reset_user_data", ...)`)
**Analog (owner-check before destructive op):** `backend/src/api/projects.ts:76-101` (`POST /:id/members` with `requireRole(db, projectId, user.id, "owner")`)
**Analog (post-op activity log):** `backend/src/api/projects.ts:51-57` (`createProject` `logActivity` call)

**Imports — already present in `backend/src/api/projects.ts:1-33`**. No new imports beyond what's there. `logActivity` from `../db/activity-logger`, `requireRole` from `../middleware/project-auth`, `Hono` etc. all imported already.

**Auth pattern** — handled by `projects.use("*", authMiddleware)` at line 36.

**Reset analog (RPC call + post-RPC follow-up)** — `backend/src/api/auth.ts:518-536`:
```typescript
// EXISTING — backend/src/api/auth.ts:519-536
account.post("/reset", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  // Single RPC call — avoids Cloudflare Workers subrequest limit
  const { error: rpcErr } = await db.rpc("reset_user_data", { p_user_id: user.id });
  if (rpcErr) {
    console.error("[account/reset] rpc error:", JSON.stringify(rpcErr));
    return c.json({ error: `Reset failed: ${rpcErr.message}`, code: "RESET_ERROR" }, 500);
  }
  // ... post-RPC follow-up (re-mint key)
  return c.json({ ok: true, api_key: apiKey });
});
```

**Owner-check analog** — `backend/src/api/projects.ts:76-83`:
```typescript
// EXISTING — backend/src/api/projects.ts:76-83
projects.post("/:id/members", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  // ...
  const db = c.get("db");
  await requireRole(db, projectId, user.id, "owner");
```

**`logActivity` analog** — `backend/src/api/projects.ts:51-57`:
```typescript
// EXISTING — backend/src/api/projects.ts:51-57
await logActivity(db, {
  project_id: project.id,
  user_id: user.id,
  action: "project_created",
  source: "human",
  metadata: { name: project.name },
});
```

**New route** — per RESEARCH §Common Operation 4 (lines 642-673). Insert in `backend/src/api/projects.ts` between the existing routes (after the `import` and `/:id/import` handler at line 261 is fine):
```typescript
// NEW — backend/src/api/projects.ts (insert before `export { projects };` at line 313)
projects.post("/:id/merge-into/:target_id", async (c) => {
  const user = c.get("user");
  const sourceId = c.req.param("id");
  const targetId = c.req.param("target_id");
  const db = c.get("db");

  // V4 Access Control: owner-check BOTH sides before any destructive op
  await requireRole(db, sourceId, user.id, "owner");
  await requireRole(db, targetId, user.id, "owner");

  // Single RPC for atomicity — mirrors account/reset pattern; avoids
  // partial-failure state between event reassign and project delete.
  const { error } = await db.rpc("merge_projects", {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_user_id: user.id,
  });
  if (error) {
    console.error("[projects/merge] rpc error:", JSON.stringify(error));
    return c.json({ error: `Merge failed: ${error.message}`, code: "MERGE_ERROR" }, 500);
  }

  await logActivity(db, {
    project_id: targetId,
    user_id: user.id,
    action: "project_merged",
    source: "human",
    metadata: { source_project_id: sourceId },
  });

  // Recompute the target's reducer state from the now-merged event set
  await recomputeProjectStatus(db, targetId);

  return c.json({ ok: true, project_id: targetId });
});
```

**Note on imports** — `recomputeProjectStatus` is already imported in `events-batch.ts:4`. For `projects.ts`, add: `import { recomputeProjectStatus } from "../lib/handoff-reducer";`. Pattern verified against `backend/src/lib/handoff-reducer.ts:5-19`.

**Error envelope** — uses inline `c.json({...}, 500)` matching the `account/reset` precedent. The codebase convention per `.planning/codebase/CONVENTIONS.md` §Error Handling is "throw `AppError`, don't inline c.json" for VALIDATION/AUTH errors — but the reset precedent shows that RPC-level failures use inline `c.json` because they're not classified errors. Follow the precedent.

---

### NEW SQL function `merge_projects(p_src, p_tgt, p_user)`

**Analog:** `supabase/migrations/010_reset_user_data.sql`

**Pattern from `010_reset_user_data.sql`:**
```sql
-- EXISTING — supabase/migrations/010_reset_user_data.sql:1-50
create or replace function reset_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  pid uuid;
  -- ...
begin
  -- For each project the user is a member of
  for pid in
    select project_id from project_members where user_id = p_user_id
  loop
    -- ... per-project cleanup ...
  end loop;

  delete from projects where owner_id = p_user_id;
  -- ...
end;
$$;
```

**New function** — folds into `018_projects_git_remote_url.sql` (single migration; per CONTEXT.md "next migration is `018_*`") OR creates `019_merge_projects.sql`. Either is valid; planner picks. Per RESEARCH §Common Operation 4 (lines 676-704):
```sql
-- NEW — append to 018 (or new file 019_merge_projects.sql)
create or replace function merge_projects(
  p_source_id uuid,
  p_target_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer as $$
begin
  -- V4 access control echo: owner-check both sides (defense-in-depth
  -- alongside the API-tier check in projects.ts)
  perform 1 from project_members
    where project_id = p_source_id and user_id = p_user_id and role = 'owner';
  if not found then raise exception 'not owner of source project'; end if;
  perform 1 from project_members
    where project_id = p_target_id and user_id = p_user_id and role = 'owner';
  if not found then raise exception 'not owner of target project'; end if;

  -- Per RESEARCH Pitfall 7: reassign FIRST, then delete (FK cascade would
  -- otherwise wipe events instead of moving them).
  update handoff_events set project_id = p_target_id where project_id = p_source_id;
  delete from handoff_project_status where project_id = p_source_id;  -- target keeps its row; recomputed by backend after
  update conversations set project_id = p_target_id where project_id = p_source_id;
  update entries set project_id = p_target_id where project_id = p_source_id;
  update activity_log set project_id = p_target_id where project_id = p_source_id;

  delete from projects where id = p_source_id;
end;
$$;
```

**Note:** `handoff_project_status` has primary key `project_id`, so `update ... set project_id = p_target_id where project_id = p_source_id` would conflict with the target's existing row. Per RESEARCH §Common Operation 4 line 695: delete source's status row instead; backend's `recomputeProjectStatus(db, targetId)` rebuilds the target's status from the reassigned events.

---

### EXTEND `mcp/src/capture/handoff-sync.ts` — add `runEagerPullCycle`

**Analog:** `mcp/src/capture/handoff-sync.ts:72-84` (`runPullCycle`)

**Pattern source** — same file:
```typescript
// EXISTING — mcp/src/capture/handoff-sync.ts:72-84
export async function runPullCycle(a: FlushArgs): Promise<{ pulled: number }> {
  const dir = projectDir(a.project_id);
  const statusPath = path.join(dir, "cache/project_status.json");
  const res = await fetch(`${a.api_url}/api/projects/${a.project_id}/status`, {
    headers: { Authorization: `Bearer ${a.api_key}` },
  });
  if (res.status === 404) return { pulled: 0 };
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  const status = await res.json();
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  return { pulled: 1 };
}
```

**Backend endpoint already exists** — `backend/src/api/project-events.ts:8-24` returns `{ events: Row[], next_since: string | null }` with `limit` capped at 1000.

**New `runEagerPullCycle`** — per RESEARCH §Pattern 5 (lines 322-348). Adds `_pulled: true` marker per RESEARCH §Pitfall 4 (lines 476-481):
```typescript
// NEW — mcp/src/capture/handoff-sync.ts (append after runPullCycle)
import type { Event } from "@synapse/shared/handoff/types.js";  // add import if missing

export async function runEagerPullCycle(a: FlushArgs & { limit?: number }): Promise<{ pulled: number }> {
  const limit = a.limit ?? 500;
  const dir = projectDir(a.project_id);
  const eventsFile = path.join(dir, "events.jsonl");
  const watermarkPath = path.join(dir, ".watermark");

  const res = await fetch(
    `${a.api_url}/api/projects/${a.project_id}/events?limit=${limit}`,
    { headers: { Authorization: `Bearer ${a.api_key}` } },
  );
  if (!res.ok) throw new Error(`eager pull failed: ${res.status}`);
  const { events } = (await res.json()) as { events: Event[]; next_since: string | null };
  if (events.length === 0) return { pulled: 0 };

  fs.mkdirSync(dir, { recursive: true });
  // Marker per RESEARCH Pitfall 4: tag pulled events so runFlushCycle filters
  // them out of POST bodies (belt-and-suspenders against watermark gap).
  const lines = events.map((e) => JSON.stringify({ ...e, _pulled: true }));
  fs.appendFileSync(eventsFile, `${lines.join("\n")}\n`);
  // Bump watermark past the highest pulled event_id (events are ordered ascending
  // per project-events.ts line 18 — `event_id ascending`).
  const highest = events[events.length - 1].event_id;
  fs.writeFileSync(watermarkPath, highest);
  return { pulled: events.length };
}
```

**Critical: `runFlushCycle` must filter `_pulled` events** — current code at `mcp/src/capture/handoff-sync.ts:33-35`:
```typescript
// EXISTING — mcp/src/capture/handoff-sync.ts:33-34 (current filter)
const all = readEvents(dir);
const pending = wm ? all.filter((e) => e.event_id > wm) : all;
```

**Extended filter** — add the `_pulled` guard:
```typescript
// EXTENDED — mcp/src/capture/handoff-sync.ts (replace lines 33-34)
const all = readEvents(dir);
const pending = (wm ? all.filter((e) => e.event_id > wm) : all)
  .filter((e) => !(e as { _pulled?: boolean })._pulled);
```

**Idempotence (per RESEARCH §Pattern 5 lines 367-371):** `runEagerPullCycle` runs only on `flush.canonical_project_id` being set — first-time link only. Subsequent flushes already have the canonical UUID; no remap, no eager-pull.

---

### EXTEND `mcp/src/capture/daemon.ts:144-158` — hook eager pull into cycle

**Analog:** self — extend the existing per-project loop.

**Current state** (`mcp/src/capture/daemon.ts:144-158`):
```typescript
// EXISTING — mcp/src/capture/daemon.ts:144-158
for (let i = 0; i < a.projects.length; i++) {
  const project_id = a.projects[i];
  try {
    const flush = await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
    const effectiveId = flush.canonical_project_id ?? project_id;
    if (flush.canonical_project_id) {
      a.projects[i] = flush.canonical_project_id;
    }
    await runPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
    if (a.user_id) writeBrief(effectiveId, a.user_id);
  } catch (err) {
    console.error("[handoff] cycle error", project_id, err);
    ok = false;
  }
}
```

**Extended state** — eager pull ONLY when `canonical_project_id` is set (first-time link). Per RESEARCH §Pattern 5 lines 352-365:
```typescript
// EXTENDED — mcp/src/capture/daemon.ts
import { runEagerPullCycle } from "./handoff-sync.js";  // add import alongside runFlushCycle, runPullCycle

for (let i = 0; i < a.projects.length; i++) {
  const project_id = a.projects[i];
  try {
    const flush = await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
    const effectiveId = flush.canonical_project_id ?? project_id;
    if (flush.canonical_project_id) {
      a.projects[i] = flush.canonical_project_id;
      // NEW: on first-time link to a canonical project (cross-device match),
      // eager-pull recent events so the brief reflects machine-A activity.
      // Failures are swallowed in the surrounding try/catch — same as runPullCycle.
      await runEagerPullCycle({
        project_id: effectiveId,
        api_key: a.api_key,
        api_url: a.api_url,
      });
    }
    await runPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
    if (a.user_id) writeBrief(effectiveId, a.user_id);
  } catch (err) {
    console.error("[handoff] cycle error", project_id, err);
    ok = false;
  }
}
```

---

### EXTEND `mcp/src/capture/handoff-brief.ts:17-43` — device-origin in brief (D-09)

**Analog:** self — extend `render()`.

**Reusable local-device-id source** — `mcp/src/capture/actor.ts:8-15` (`readOrCreateDeviceId`) — currently NOT exported. The extension must export it.

**Current state** (`mcp/src/capture/actor.ts:8-15`):
```typescript
// EXISTING — mcp/src/capture/actor.ts:8-15
function readOrCreateDeviceId(): string {
  const idFile = path.join(synapseRoot(), "device_id");
  if (fs.existsSync(idFile)) return fs.readFileSync(idFile, "utf-8").trim();
  fs.mkdirSync(synapseRoot(), { recursive: true });
  const id = randomBytes(8).toString("hex");
  fs.writeFileSync(idFile, id);
  return id;
}
```

**Required change in `actor.ts`** — add `export`:
```typescript
// EXTENDED — mcp/src/capture/actor.ts
export function readOrCreateDeviceId(): string { /* unchanged body */ }
```

**Current state — `render()`** (`mcp/src/capture/handoff-brief.ts:17-43`):
```typescript
// EXISTING — mcp/src/capture/handoff-brief.ts:17-43
function render(s: ProjectStatus, viewer: string): string {
  const lines: string[] = [];
  lines.push(`Project: ${s.project_id}`);
  if (s.current_next_step) { /* ... */ }
  const mostRecent = s.active_actors[0];
  if (mostRecent) {
    const focus = mostRecent.current_focus ?? "(no focus)";
    const branch = mostRecent.branch ?? "(no branch)";
    if (mostRecent.actor.user_id === viewer) {
      lines.push(`Your last activity: ${focus} on ${branch}`);
    } else {
      lines.push(
        `Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state}): ${focus} on ${branch}`,
      );
    }
  }
  // ...
}
```

**Extended state** — per RESEARCH §Pattern 6 (lines 376-401) + Recommendation at lines 774-776 (use `actor.hostname` for Phase 2):
```typescript
// EXTENDED — mcp/src/capture/handoff-brief.ts
import { readOrCreateDeviceId } from "./actor.js";  // add import

function render(s: ProjectStatus, viewer: string): string {
  const lines: string[] = [];
  lines.push(`Project: ${s.project_id}`);
  if (s.current_next_step) { /* unchanged */ }

  const mostRecent = s.active_actors[0];
  if (mostRecent) {
    const focus = mostRecent.current_focus ?? "(no focus)";
    const branch = mostRecent.branch ?? "(no branch)";
    if (mostRecent.actor.user_id === viewer) {
      // Same user — check whether the most-recent device matches the local one
      const localDeviceId = readOrCreateDeviceId();
      if (mostRecent.actor.device_id === localDeviceId) {
        lines.push(`Your last activity: ${focus} on ${branch}`);
      } else {
        // Cross-device: surface device origin. Hostname is the simplest signal
        // available today (per RESEARCH §Pattern 6 recommendation — see Open Question 2).
        const deviceLabel = mostRecent.actor.hostname || "another device";
        lines.push(`Most recent activity (on ${deviceLabel}): ${focus} on ${branch}`);
      }
    } else {
      // Different user — unchanged (Phase 4 cross-user surface is separate)
      lines.push(
        `Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state}): ${focus} on ${branch}`,
      );
    }
  }
  // ... rest unchanged
}
```

**Test contract (per RESEARCH line 776 + `feedback_test_generality.md`):** assert "when actor.device_id ≠ local device_id, the brief contains the remote actor's hostname"; do NOT assert the literal string format.

---

### NEW `frontend/src/lib/components/project-link/LinkPicker.svelte` (D-07 UI per UI-SPEC.md)

**Analog:** `frontend/src/lib/components/account/DangerZone.svelte`

**Imports pattern** — already shown in `DangerZone.svelte:1-9`:
```svelte
<!-- EXISTING — frontend/src/lib/components/account/DangerZone.svelte:1-9 -->
<script lang="ts">
import { enhance } from "$app/forms";

let { email, resetSuccess, resetError, deleteError } = $props<{
  email: string;
  resetSuccess?: boolean;
  resetError?: string;
  deleteError?: string;
}>();
```

**State-machine pattern** — `DangerZone.svelte:11-17`:
```svelte
<!-- EXISTING — frontend/src/lib/components/account/DangerZone.svelte:11-17 -->
let showResetConfirm = $state(false);
let showDeleteConfirm = $state(false);
let deleteInput = $state("");
let resetLoading = $state(false);
let deleteLoading = $state(false);
const deleteConfirmed = $derived(deleteInput === "DELETE");
```

**Inline-expander pattern (state A → state B)** — `DangerZone.svelte:48-90`:
```svelte
<!-- EXISTING — frontend/src/lib/components/account/DangerZone.svelte:48-90 -->
{#if !showResetConfirm}
  <button
    type="button"
    class="btn-danger cursor-pointer"
    onclick={() => { showResetConfirm = true; }}
  >
    Reset data
  </button>
{:else}
  <div class="rounded-lg p-4 mt-2" style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);">
    <p class="text-sm mb-3" style="color: var(--color-danger); font-weight: 600;">
      Are you sure? This will permanently delete all your workspace data.
    </p>
    <div class="flex gap-2">
      <form method="POST" action="?/resetAccount" use:enhance={() => {
        resetLoading = true;
        return async ({ update }) => {
          resetLoading = false;
          showResetConfirm = false;
          await update();
        };
      }}>
        <button type="submit" disabled={resetLoading} class="btn-danger cursor-pointer">
          {#if resetLoading}
            <span class="flex items-center justify-center gap-2">
              <span class="spinner spinner-sm spinner-white"></span>
              Resetting...
            </span>
          {:else}
            Yes, reset all data
          {/if}
        </button>
      </form>
      <button type="button" class="btn-secondary cursor-pointer" onclick={() => { showResetConfirm = false; }}>
        Cancel
      </button>
    </div>
  </div>
{/if}
```

**Type-to-confirm input pattern** — `DangerZone.svelte:107-153`:
```svelte
<!-- EXISTING — frontend/src/lib/components/account/DangerZone.svelte:115-122 -->
<input
  type="text"
  bind:value={deleteInput}
  placeholder="Type DELETE to confirm"
  class="w-full text-sm mb-3"
  style="border-radius: var(--radius-sm); padding: 12px 16px; transition: var(--transition-base); background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text); outline: none;"
/>

<!-- EXISTING — disable submit until confirm matches -->
<button type="submit" disabled={!deleteConfirmed || deleteLoading} class="btn-danger cursor-pointer">
```

**LinkPicker.svelte structure** (per UI-SPEC.md §Surface 1, States A→F):
```svelte
<!-- NEW — frontend/src/lib/components/project-link/LinkPicker.svelte (skeleton) -->
<script lang="ts">
import { enhance } from "$app/forms";

interface Candidate {
  id: string;
  name: string;
  conversation_count: number;
  last_activity?: string;
  matched_by_remote: boolean;
}

let { sourceProjectId, sourceProjectName, candidates, allOtherProjects, linkError } = $props<{
  sourceProjectId: string;
  sourceProjectName: string;
  candidates: Candidate[];          // auto-match top section
  allOtherProjects: Candidate[];     // "Your other projects"
  linkError?: string;
}>();

let showPicker = $state(false);       // State A → State B
let selectedTargetId = $state("");
let showConfirm = $state(false);      // State B → State C
let confirmInput = $state("");
let linking = $state(false);          // State D
const confirmed = $derived(confirmInput === sourceProjectName);
const hasAnyTargets = $derived(allOtherProjects.length > 0 || candidates.length > 0);
</script>

<section class="glass rounded-xl" style="padding: 2rem;" aria-labelledby="linked-projects-heading">
  <h2 id="linked-projects-heading" style="font-size: 18px; font-weight: 700; color: var(--color-accent);">
    Linked Projects
  </h2>

  {#if !showPicker}
    <!-- State A: idle -->
    <p style="font-size: 14px; color: var(--color-text-muted);">
      Link this project to another one of your projects to merge their events and history.
      Useful when the same repo got captured twice from different machines.
    </p>
    <button
      type="button"
      class="btn-primary cursor-pointer"
      onclick={() => { showPicker = true; }}
      disabled={!hasAnyTargets}
    >
      + Link to existing project
    </button>
    {#if !hasAnyTargets}
      <p style="font-size: 12px; color: var(--color-text-muted);">
        (You need at least 2 projects to link.)
      </p>
    {/if}
  {:else if !showConfirm}
    <!-- State B: picker open -->
    <!-- ... candidates radios + allOtherProjects radios + Cancel/Continue -->
  {:else}
    <!-- State C: type-to-confirm -->
    <!-- mirrors DangerZone.svelte:107-153 with parameterized name -->
    <input
      type="text"
      bind:value={confirmInput}
      placeholder={`Type "${sourceProjectName}" to confirm`}
      class="w-full text-sm"
      style="border-radius: var(--radius-sm); padding: 12px 16px; background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text); outline: none;"
    />
    <form method="POST" action="?/linkProject" use:enhance={() => {
      linking = true;
      return async ({ update }) => {
        linking = false;
        await update();
      };
    }}>
      <input type="hidden" name="sourceProjectId" value={sourceProjectId} />
      <input type="hidden" name="targetProjectId" value={selectedTargetId} />
      <button type="submit" disabled={!confirmed || linking} class="btn-danger cursor-pointer">
        {#if linking}
          <span class="flex items-center justify-center gap-2">
            <span class="spinner spinner-sm spinner-white"></span>
            Linking…
          </span>
        {:else}
          Link projects & delete source
        {/if}
      </button>
    </form>
  {/if}

  {#if linkError}
    <div role="alert" style="background: rgba(139,0,0,0.06); border: 1px solid rgba(139,0,0,0.2); color: var(--color-danger); padding: 8px 12px; border-radius: 8px; font-size: 13px;">
      {linkError}
    </div>
  {/if}
</section>

<style>
  /* btn-primary, btn-danger, btn-secondary, .glass, .spinner already exist
     globally in frontend/src/app.css. No new classes required. */
</style>
```

**Per UI-SPEC.md §Copywriting Contract** — all visible strings locked. Executor uses verbatim.

**Per UI-SPEC.md §Out of Scope** — NO floating modal. The inline expander pattern is mandatory (mirrors `DangerZone.svelte`).

**Per UI-SPEC.md §Accessibility Contract** — `role="alert"` on error, `role="status"` on success, `<section aria-labelledby="...">`, focus management on state transitions via `tick()`. Verified against `home/+page.svelte:88` and `DangerZone.svelte:38`.

---

### EXTEND `frontend/src/routes/(app)/projects/[name]/settings/+page.svelte` — mount LinkPicker

**Analog:** self — `+page.svelte:11-17` (existing Members section). Add a sibling section.

**Current state** — `frontend/src/routes/(app)/projects/[name]/settings/+page.svelte:1-18`:
```svelte
<!-- EXISTING — frontend/src/routes/(app)/projects/[name]/settings/+page.svelte -->
<script>
import InviteDialog from "$lib/components/sharing/InviteDialog.svelte";
import MemberList from "$lib/components/sharing/MemberList.svelte";

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
</div>
```

**Extended state** — add the LinkPicker section after Members. Per UI-SPEC.md §Surface 1 placement rationale.
```svelte
<!-- EXTENDED — frontend/src/routes/(app)/projects/[name]/settings/+page.svelte -->
<script>
import InviteDialog from "$lib/components/sharing/InviteDialog.svelte";
import MemberList from "$lib/components/sharing/MemberList.svelte";
import LinkPicker from "$lib/components/project-link/LinkPicker.svelte";

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
    <LinkPicker
      sourceProjectId={data.project.id}
      sourceProjectName={data.project.name}
      candidates={data.linkCandidates ?? []}
      allOtherProjects={data.otherProjects ?? []}
      linkError={form?.linkError}
    />
  </section>
</div>
```

---

### EXTEND `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts` — add `linkProject` action

**Analog:** self — `+page.server.ts:11-26` (`addMember` action).

**Current state** — `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts:11-26`:
```typescript
// EXISTING — frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts:11-26
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
  // ... other actions
};
```

**Extended state** — add `linkProject` action following the same shape:
```typescript
// EXTENDED — frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts
import { redirect } from "@sveltejs/kit";

// in load (add to existing load):
export const load: PageServerLoad = async ({ locals, params }) => {
  const api = createApi(locals.token);
  const billing = await api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null }));
  // NEW — fetch projects + match candidates for the picker
  const allProjects = await api.listProjects();  // existing api method
  const linkCandidates = await api.listLinkCandidates(params.name).catch(() => []);  // new api method
  return { tier: billing.tier, linkCandidates, otherProjects: allProjects.filter(p => p.name !== params.name) };
};

// in actions:
linkProject: async ({ request, locals }) => {
  const data = await request.formData();
  const sourceProjectId = data.get("sourceProjectId") as string;
  const targetProjectId = data.get("targetProjectId") as string;
  const confirmInput = data.get("confirmInput") as string;
  // confirmInput vs sourceProjectName check happens client-side; server-side trusts api owner check

  const api = createApi(locals.token);
  try {
    const result = await api.mergeProjects(sourceProjectId, targetProjectId);
    // Per UI-SPEC.md §State E — redirect to target after success (source no longer exists)
    throw redirect(303, `/projects/${result.target_name ?? targetProjectId}/settings`);
  } catch (err) {
    // Map API error codes to UI-SPEC §State F copy
    const status = (err as { status?: number }).status;
    if (status === 403) return fail(403, { linkError: "You're not the owner of one of these projects. Only the owner can link projects." });
    if (status === 404) return fail(404, { linkError: "That target project no longer exists. Refresh and pick another one." });
    if (status === 409) return fail(409, { linkError: "You can't link a project to itself. Pick a different target." });
    if (status && status >= 500) return fail(status, { linkError: "Something went wrong on our side. Wait a moment and try again — if it keeps failing, check the project page in a few minutes." });
    return fail(500, { linkError: "Couldn't reach the server. Check your connection and try again." });
  }
},
```

---

### NEW `backend/test/api/auth-me.test.ts`

**Analog:** `backend/test/api/projects.test.ts:1-115`

**Pattern from `projects.test.ts` (auth-rejection structural test)** — same vitest + cloudflare/vitest-pool-workers pattern:
```typescript
// EXISTING — backend/test/api/projects.test.ts:1-25
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("Projects API — auth enforcement", () => {
  it("GET /api/projects without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
  // ...
});
```

**New file shape** — mirror the structural pattern, plus an `.skip` for the live-DB path (matches `events-batch-auto-create.test.ts:64-67`):
```typescript
// NEW — backend/test/api/auth-me.test.ts (skeleton)
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("GET /api/account/me — auth enforcement", () => {
  it("returns 401 without Authorization header", async () => {
    const req = new Request("http://localhost/api/account/me");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid Bearer token", async () => {
    const req = new Request("http://localhost/api/account/me", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("route is registered (does not 404 even without auth)", async () => {
    const req = new Request("http://localhost/api/account/me", {
      headers: { Authorization: "Bearer x" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  it.skip("returns 200 with {user_id, email, tier} for a valid API key (requires live DB)", async () => {
    // Live verification: with a seeded api_key and SUPABASE_URL set,
    // expect body.user_id to match public.users.id (NOT auth.users.id).
  });
});
```

---

### NEW `backend/test/api/projects-merge.test.ts`

**Analog:** `backend/test/api/projects.test.ts` (auth-rejection structural pattern) + `backend/test/api/events-batch-auto-create.test.ts` (skip for live-DB)

**Skeleton:**
```typescript
// NEW — backend/test/api/projects-merge.test.ts
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("POST /api/projects/:id/merge-into/:target_id — structural", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost/api/projects/src-id/merge-into/tgt-id", {
      method: "POST",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("route is registered for source/target IDs (does not 404)", async () => {
    const req = new Request("http://localhost/api/projects/src-id/merge-into/tgt-id", {
      method: "POST",
      headers: { Authorization: "Bearer invalid" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).not.toBe(404);
  });

  it.skip("requires owner role on BOTH source and target (requires live DB)", async () => {
    // Live verification: seed two projects with different owners; expect 403.
  });

  it.skip("writes activity_log entry on successful merge (requires live DB)", async () => {});
});
```

---

### EXTEND test files (Wave 0 extensions)

**Analog (file-by-file):** each test file in `mcp/test/` and `backend/test/` follows local conventions. The new test cases extend the existing `describe` blocks in place.

**`mcp/test/cli/init.test.ts`** — analog: existing setup at lines 1-28 (tmpdir, SYNAPSE_HOME, process.chdir).
New cases (per VALIDATION §Wave 0 line 56):
- "fetchMe is called BEFORE installHooks/writeConfig" — mock `fetch` to throw, assert no `.synapse/config.json` exists after `runInit` rejects.
- "writeConfig persists user_id + email on /me success" — mock `fetch` to return `{user_id: "u1", email: "e@x"}`, assert config has both fields.
- Test scaffold pattern (matches existing line 27 `vi.restoreAllMocks()`): use `vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({user_id, email}), {status: 200}))`.

**`mcp/test/cli/hook-dispatch.test.ts`** — analog: existing setup at lines 6-16 (tmpdir, SYNAPSE_HOME).
New cases (per VALIDATION §Wave 0 line 57):
- "env var SYNAPSE_USER_ID wins over config" — set env, write config with different value, assert payload carries env.
- "config user_id used when env unset" — write `~/.synapse/config.json` with user_id, assert payload carries config value.
- "placeholder used when neither" — no env, no config → `"local-user"`.
- "hashCwd determinism" — already at line 97-103, regression-guard preserved.

**`mcp/test/capture/handoff-sync.test.ts`** — analog: existing `runFlushCycle` test at lines 18-47.
New cases (per VALIDATION §Wave 0 line 58, for `runEagerPullCycle`):
- Mock `fetch` to return `{events: [makeEv("01HZA"), makeEv("01HZB")], next_since: "01HZB"}`, assert: events.jsonl appended with `_pulled: true` markers, watermark = `01HZB`.
- Empty pull: `{events: []}` → no-op.
- 5xx → throws.
- Subsequent `runFlushCycle` after eager-pull: assert `_pulled` events NOT in POST body.

**`mcp/test/capture/handoff-brief.test.ts`** — analog: existing `setupStatus` + `makeStatusFromActor` helpers at lines 42-72.
New cases (per VALIDATION §Wave 0 line 60):
- Same `user_id`, same `device_id` (write local device_id file matching status's actor.device_id): brief contains "Your last activity".
- Same `user_id`, different `device_id`, actor has `hostname: "macbook-A"`: brief contains "on macbook-A".
- Different `user_id`: existing other-user line unchanged.

**`backend/test/api/events-batch-auto-create.test.ts`** — analog: existing structural tests at lines 10-67.
New cases (per VALIDATION §Wave 0 line 59):
- Request body accepts `payload.git_remote_url` without 400.
- Route still resolves cwd_<hash> when only `git_basename` is present (regression guard for existing path).
- New structural assertion: payload with `git_remote_url` does not 404.

**`mcp/test/e2e/handoff.e2e.test.ts`** — analog: existing describe block (machine-A focus + flush). Extend with one new describe (per VALIDATION §Wave 0 line 61):
- Fresh tmpdir simulating "machine B installs"; same `user_id` from `readUserIdFromConfig` mock; different `device_id` via separate `~/.synapse/device_id` file; run hook + assert brief contains machine-A focus + hostname after eager-pull.

---

## Shared Patterns

### Authentication (backend routes)

**Source:** `backend/src/lib/auth.ts:31-94` + `backend/src/api/auth.ts:434` (sub-app mount).

**Apply to:** All new authenticated routes (`/api/account/me`, `/api/projects/:id/merge-into/:target_id`).

```typescript
// EXISTING — backend/src/api/projects.ts:35-37
const projects = new Hono<{ Bindings: Env }>();
projects.use("*", authMiddleware);
projects.use("*", idempotency);

// inside any route handler:
const user = c.get("user");      // UserRow from public.users
const tier = c.get("tier");      // "free" | "plus"
const db = c.get("db");          // SupabaseClient (service-role)
```

**Existing sub-apps already mount `authMiddleware`** — `account` (`auth.ts:434`), `projects` (`projects.ts:36`), `eventsBatch` (`events-batch.ts:10`), `projectEvents` (`project-events.ts:6`). Phase 2 routes add inside existing sub-apps; nothing new required.

### Error Handling

**Source:** `backend/src/lib/errors.ts` + `backend/src/index.ts:51-65` (global onError).

**Apply to:** All new backend routes.

**Standard pattern (per `.planning/codebase/CONVENTIONS.md` §Error Handling):**
- Route handlers `throw new AppError("msg")` / `throw new NotFoundError(...)` / `throw new ForbiddenError(...)` — never `return c.json({error}, 4xx)` inline.
- Exception: RPC failures use inline `c.json({error, code}, 500)` per the `account/reset` precedent (`backend/src/api/auth.ts:524-528`). The merge endpoint follows the same precedent.

```typescript
// EXISTING — backend/src/lib/errors.ts:1-33
export class AppError extends Error {
  constructor(message: string, public status = 500, public code = "INTERNAL_ERROR") { super(message); }
}
export class NotFoundError extends AppError { constructor(m: string) { super(m, 404, "NOT_FOUND"); } }
export class UnauthorizedError extends AppError { constructor(m = "Invalid or missing API key") { super(m, 401, "UNAUTHORIZED"); } }
export class ForbiddenError extends AppError { constructor(m = "Insufficient permissions") { super(m, 403, "FORBIDDEN"); } }
export class ConflictError extends AppError { constructor(m: string) { super(m, 409, "CONFLICT"); } }
```

**Apply to:** MCP CLI errors throw `new Error("usage: ...")` with the failing-operation message cited. Already followed by `fetchMe()` design in `mcp/src/cli/api.ts`.

### Validation (POST bodies)

**Source:** `backend/src/lib/validate.ts:9-17` (`parseBody`) + `schemas` object.

**Apply to:** Any new POST/PATCH handler. Phase 2's `POST /api/projects/:id/merge-into/:target_id` has NO body (params only), so `parseBody` is not needed — the URL params are validated via Hono's built-in `c.req.param()`. If a future iteration adds a body field, follow:

```typescript
// EXISTING — backend/src/lib/validate.ts:9-17
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AppError(issues, 400, "VALIDATION_ERROR");
  }
  return result.data;
}
```

### Imports (per workspace)

**Source:** `.planning/codebase/CONVENTIONS.md` §Import Organization.

**MCP** (`mcp/src/...`): `.js` extension MANDATORY on relative imports (Node16 module resolution):
```typescript
import { readUserIdFromConfig } from "../capture/identity.js";  // .js required
import { synapseRoot } from "./handoff-paths.js";
```

**Backend** (`backend/src/...`): no extension on relative imports (bundler resolution):
```typescript
import { authMiddleware } from "../lib/auth";
import { AppError } from "../lib/errors";
```

**Frontend** (`frontend/src/...`): no extension on relative imports; use `$lib` alias:
```typescript
import { createApi } from "$lib/server/api";
import LinkPicker from "$lib/components/project-link/LinkPicker.svelte";
```

**All workspaces:** `node:` protocol prefix mandatory on Node built-ins.

### Logging tags

**Source:** `.planning/codebase/CONVENTIONS.md` §Logging.

**Apply to:** New backend `console.error` calls — use `[area]` prefix matching existing convention:
- `[projects/merge]` for the new merge endpoint (mirrors `[account/reset]` at `auth.ts:526`)
- `[auth/me]` if any `/me` route logs (currently none)
- `[synapse init]` already in use for init log lines

### Testing (vitest + cloudflare/vitest-pool-workers)

**Source:** existing test files cited above + `.planning/codebase/CONVENTIONS.md` §File Naming.

**Apply to:** All Wave 0 NEW files (`auth-me.test.ts`, `projects-merge.test.ts`).

Pattern:
```typescript
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("...", () => {
  it("...", async () => {
    const req = new Request("http://localhost/api/...");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(...);
  });
});
```

Live-DB tests use `it.skip(...)` with a comment explaining what live verification asserts — mirrors `events-batch-auto-create.test.ts:64-67`. Per `feedback_test_generality.md`: guard the bug class, not the literal string.

### Activity log entries

**Source:** `backend/src/db/activity-logger.ts` (`logActivity`) + usage examples in `backend/src/api/projects.ts:51-57`, `:91-99`, `:117-124`, `:177-184`, `:210-216`.

**Apply to:** Successful destructive actions in `POST /:id/merge-into/:target_id`:
```typescript
await logActivity(db, {
  project_id: targetId,
  user_id: user.id,
  action: "project_merged",       // new action string — convention: snake_case verb
  source: "human",                 // "human" or "claude"; merge is always human-initiated
  metadata: { source_project_id: sourceId },
});
```

### SvelteKit form action error mapping

**Source:** `frontend/src/routes/(app)/projects/[name]/settings/+page.server.ts:11-26` (`addMember` action with `fail(...)` on catch).

**Apply to:** New `linkProject` action — return `fail(status, {linkError: "..."})` mapped to the UI-SPEC.md §State F copy table.

---

## No Analog Found

None — every file in Phase 2 has at least a role-match analog in the codebase. The high reuse ratio is explicitly noted in RESEARCH.md line 436 ("Phase 2 has an unusually high reuse ratio").

| File | Role | Data Flow | Reason | Recommendation |
|------|------|-----------|--------|----------------|
| (none) | | | | |

---

## Metadata

**Analog search scope:**
- `backend/src/api/` — all 16 route files scanned via Grep + targeted Read
- `backend/src/lib/` — auth.ts, errors.ts, handoff-reducer.ts, validate.ts read
- `mcp/src/cli/` — handlers.ts, hook-dispatch.ts, init.ts, run-daemon.ts, api.ts, resolve-project.ts, wizard.ts (partial) read
- `mcp/src/capture/` — actor.ts, handoff-sync.ts, handoff-brief.ts, daemon.ts (partial) read
- `mcp/src/hooks/` — session-start.ts read
- `mcp/test/` — cli/init.test.ts, cli/hook-dispatch.test.ts, capture/handoff-sync.test.ts, capture/handoff-brief.test.ts read
- `backend/test/api/` — projects.test.ts, events-batch-auto-create.test.ts read
- `frontend/src/lib/components/` — account/DangerZone.svelte, sharing/InviteDialog.svelte read
- `frontend/src/routes/(app)/projects/[name]/settings/` — +page.svelte, +page.server.ts read
- `frontend/src/routes/(app)/home/+page.svelte` — partial (styles section)
- `supabase/migrations/` — 010_reset_user_data.sql, 015_handoff_layer.sql, 017_project_invites.sql read

**Files scanned:** 24 source files + 8 test files + 3 migration files + 3 codebase doc files = 38 total.

**Pattern extraction date:** 2026-05-20

---

## PATTERN MAPPING COMPLETE
