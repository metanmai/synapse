# Phase 2: Real User Identity - Research

**Researched:** 2026-05-20
**Domain:** Identity bootstrap (daemon learns user UUID) + cross-device project discovery (git-remote-based linking + eager pull)
**Confidence:** HIGH on all 9 decisions — every change site already exists and is well-mapped; the work is wiring, schema addition, and one renderer tweak. No external research needed.

## Summary

Phase 2 is **forward-only wiring** of identity through three already-built layers. The daemon and backend already cooperate around `cwd_<hash>` auto-create; the backend already overrides `actor_user_id` from the authenticated `c.var.user.id` (`backend/src/api/events-batch.ts:60`), so production rows are already correct regardless of the placeholder. What's missing is making the *local* identity match: the daemon's hook handlers (`mcp/src/cli/hook-dispatch.ts:59`) still write `"default"` because they predate the per-device CLI keys feature.

Cross-device discovery has all the primitives already in place: `mcp/src/cli/resolve-project.ts:23-39` already reads `git remote get-url origin` and `git_basename`, and `backend/src/api/projects-resolve.ts:67-86` already has a `git_origin_url` match path (via the JSONB column on `conversations.working_context`). But the **events-batch auto-create** path at `backend/src/api/events-batch.ts:71-121` only matches by `name`, not by `git_remote_url`. The fix is (a) add `projects.git_remote_url` column, (b) extend the daemon to include the URL in its first event's payload, (c) re-order the matcher to try URL first, name second. The pre-existing `projects-resolve` route is informative but is NOT the right surface — events-batch is the only path the daemon hits for fresh project creation.

Eager pull (D-08) is half-built: `runPullCycle` (`mcp/src/capture/handoff-sync.ts:72-84`) already fetches `ProjectStatus`. The new piece is calling `GET /api/projects/:id/events?limit=500` (route already exists at `backend/src/api/project-events.ts`) and appending those rows to local `events.jsonl` with a "pulled" marker so the watermark logic doesn't try to re-flush them. The brief renderer at `mcp/src/capture/handoff-brief.ts:32-43` already differentiates "your last activity" vs other actors by `viewer_user_id`; D-09 extends that branch with a device-name lookup.

**Primary recommendation:** Land the 4 slices in order — A (Identity bootstrap), B (Cross-device link + eager pull), D (Device-origin brief), C (Manual override UI; can be deferred to wait for `/gsd:ui-phase 2`). Each slice is a vertical end-to-end change of ~3-8 files. The whole phase is ~12-15 plans worth of work over 2 days of focused execution.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mint user UUID for daemon | API (`GET /api/account/me`) | CLI (init reads, persists) | UUID source-of-truth is `public.users.id`, only the backend can serve it authoritatively from the authenticated session |
| Persist UUID to disk | CLI (`mcp/src/cli/init.ts`) | — | `~/.synapse/config.json` is local-only state; init owns config writes |
| Daemon reads UUID for events | CLI (`mcp/src/cli/hook-dispatch.ts`) | — | Hook dispatcher constructs the Actor at event-write time; reads must happen here, not in the daemon loop |
| Backend enforces real UUID | API (`backend/src/api/events-batch.ts:60`) | — | Already done — `actor_user_id: user.id` override is the authoritative server-side guard |
| Match local folder to canonical project | API (events-batch auto-create flow) | DB (`projects.git_remote_url` index) | Backend already owns the cwd-hash → canonical resolution; just extend it with a new signal |
| Read git remote for matching | CLI (hook payload at write time) | — | Must run on the client; backend can't see the user's local git config. Already implemented in `resolve-project.ts:23-39` — reuse |
| Pull events on link | CLI (`handoff-sync.ts`) + API (existing `GET /api/projects/:id/events`) | — | Daemon pulls; backend route already exists |
| Manual link UI | Frontend (SvelteKit `(app)/dashboard`) + API (new `POST /api/projects/:id/merge-into/:target_id`) | — | Dashboard surface for an action the auto-link can't get right |
| Device-origin in brief | CLI (`mcp/src/capture/handoff-brief.ts`) + API (existing `GET /api/account/keys`) | — | Brief renders on the client; needs a join from `actor.device_id` to the device label from `api_keys.label` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | ^4.12.8 [VERIFIED: backend/package.json] | Backend route handler — `c.var.user` contract | Already in use across all routes; auth middleware sets `c.var.user` |
| @supabase/supabase-js | ^2.99.2 [VERIFIED: backend/package.json] | Postgres client; service-role from Worker | Standard across backend; project_members + projects queries use it |
| zod | 4.3.6 [VERIFIED: mcp/package.json] / ^4.3.6 [VERIFIED: backend/package.json] | Request body validation in `lib/validate.ts` | Used for every `parseBody` call; new endpoints follow the same pattern |
| vitest | ^4.1.0 (backend) / ^4.1.2 (mcp) [VERIFIED: package.json files] | Test runner across all workspaces | The repo's only test framework |
| @cloudflare/vitest-pool-workers | ^0.13.2 [VERIFIED: backend/package.json] | Run backend Hono tests inside a simulated Workers runtime | All `backend/test/api/*.test.ts` files use it |
| @clack/prompts | ^0.11.0 [VERIFIED: mcp/package.json] | Interactive CLI in `wizard.ts` | If wizard surfaces a user-visible error, use existing clack helpers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process (`execSync`) | built-in | Shell out to `git remote get-url origin` | Already used in `resolve-project.ts:25-29` and `cloud-sync.ts:173-178` — copy the pattern, don't reinvent |
| node:crypto (`createHash`) | built-in | sha1 for `cwd_<hash>` placeholder | Used by `hashCwd()` in `hook-dispatch.ts:72` — leave alone, just don't break it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `GET /api/account/me` (D-02) | Extend `GET /api/account/keys` with `viewer: {user_id, email, tier}` | Saves a route but couples two concerns; init would have to parse keys it doesn't need. Discussion-log Q2 considered and rejected this in favor of the new route. |
| Eager pull = `last 500 events` (D-08) | Eager pull = `ProjectStatus only` (status-cache JSONB) | Status alone is enough for the brief but loses the per-event timeline (`recent_activity[]` is bounded to 50 inside `reduce()` anyway). Discussion-log Q3: user picked eager. |
| `git_remote_url` column on `projects` | JSONB lookup on `handoff_project_status.status` | The JSONB path mirrors what `projects-resolve.ts:67-86` already does on `conversations.working_context` — but a column with an index is the right shape when this becomes a per-event hot lookup. Index will be `(user_id, git_remote_url)` for the matcher's exact query shape. |

**Installation:** No new packages — every dependency required for Phase 2 is already in the lockfile. No package-legitimacy audit needed.

## Package Legitimacy Audit

No new external packages are introduced in Phase 2. All dependencies (`hono`, `@supabase/supabase-js`, `zod`, `vitest`, `@clack/prompts`, etc.) are already present in `backend/package.json` and `mcp/package.json` and were vetted by the slice 1a-prime planning. Disposition: NOT APPLICABLE.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MACHINE A (already authenticated)                                            │
│                                                                              │
│   $ synapse init --api-key <key>                                             │
│        │                                                                     │
│        ├── [D-01] NEW: fetch GET /api/account/me → {user_id, email}          │
│        │       (fail-fast on error per D-05 — no half-config)                │
│        │                                                                     │
│        ├── writeConfig → ~/.synapse/config.json {api_key, user_id, email}    │
│        │                                                                     │
│        └── installHooks + slashCommands + .mcp.json (existing)               │
│                                                                              │
│   Claude Code SessionStart → `synapse hook session-start`                    │
│        │                                                                     │
│        └── [D-03] NEW: readHookPayloadFromStdin reads user_id from           │
│            ~/.synapse/config.json (was process.env.SYNAPSE_USER_ID??"default")│
│                                                                              │
│   ALSO at hook time: read `git remote get-url origin` (cached per-cwd) →     │
│        event payload carries `git_remote_url` for fresh `cwd_<hash>` ids     │
│        (reuses readGitSignals() from resolve-project.ts:23-39)               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ POST /api/events/batch
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ BACKEND (events-batch.ts)                                                    │
│                                                                              │
│   For each cwd_<hash> project_id:                                            │
│   1. [D-06 NEW] If event payload has git_remote_url:                         │
│        SELECT id FROM projects                                                │
│        WHERE id IN (membership.project_ids)                                   │
│          AND git_remote_url = $1                                              │
│   2. Fall back to name=git_basename match (status quo)                        │
│   3. If neither matches, INSERT new project with both name AND                │
│      git_remote_url, return canonical_project_ids mapping                     │
│                                                                              │
│   actor_user_id = c.var.user.id (already enforced; D-04 means daemon's        │
│   "default" placeholder rows that pre-date this phase are upserted with       │
│   real user.id — no backfill needed because backend always overrode)          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ MACHINE B (fresh install, same user)                                         │
│                                                                              │
│   $ synapse init --api-key <same-key>                                         │
│        → same /me call → ~/.synapse/config.json has same user_id              │
│                                                                              │
│   Claude Code SessionStart in same git repo                                   │
│        → hook writes event with same git_remote_url, cwd_<NEW-hash>           │
│        → daemon flushes → backend matches by git_remote_url                  │
│        → returns canonical_project_ids[cwd_<NEW-hash>] = <existing-uuid>      │
│                                                                              │
│   [D-08 NEW] On canonical_project_id remap, daemon performs                  │
│      runPullCycle (existing) + runEagerPullCycle (NEW):                       │
│        GET /api/projects/<existing-uuid>/events?limit=500                     │
│        → append to events.jsonl with `pulled: true` marker                    │
│        → bump .watermark to the highest pulled event_id (so flush skips)     │
│                                                                              │
│   [D-09 NEW] writeBrief reads ProjectStatus, joins                            │
│      active_actors[0].actor.device_id ↔ api_keys.label (cli-<device>)         │
│      via cached GET /api/account/keys, prepends device name when device_id   │
│      != local readOrCreateDeviceId()                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directories. Touched files only:

```
mcp/src/cli/
├── init.ts                  # D-01 + D-05: add /me call, persist user_id, fail-fast
├── hook-dispatch.ts         # D-03: replace SYNAPSE_USER_ID??"default" w/ config read
├── api.ts                   # NEW helper: fetchMe(apiKey) → {user_id, email, tier?}
└── handlers.ts              # OPTIONAL: align readUserIdFromConfig() with new shape

mcp/src/capture/
├── handoff-sync.ts          # D-08: add runEagerPullCycle()
├── handoff-brief.ts         # D-09: prepend device-origin label
└── handoff-paths.ts         # NO CHANGE

backend/src/api/
├── auth.ts                  # D-02: add account.get("/me", ...) ~10 LOC
├── events-batch.ts          # D-06: extend matcher with git_remote_url
└── projects.ts              # D-07: add POST /:id/merge-into/:target_id

supabase/migrations/
└── 018_projects_git_remote_url.sql   # D-06: new column + index

frontend/src/routes/(app)/home/   # OR wherever projects list lives
└── +page.svelte (+ ManualLinkModal.svelte)   # D-07: dashboard action
```

### Pattern 1: Single-purpose account route (D-02)

**What:** Add `account.get("/me", ...)` to `backend/src/api/auth.ts` after the keys routes (lines 432-538).
**When to use:** Adding any new authenticated account-scoped read endpoint.
**Example:**
```typescript
// Source: backend/src/api/auth.ts:469-475 (listApiKeys pattern, adapted)
account.get("/me", async (c) => {
  const user = c.get("user");
  const tier = c.get("tier"); // already resolved by authMiddleware (lib/auth.ts:89-91)
  return c.json({
    user_id: user.id,
    email: user.email,
    tier, // "free" | "plus"
  });
});
```

Auth middleware contract (`backend/src/lib/auth.ts:31-94`):
- Reads `Authorization: Bearer <token>`, accepts both JWT (3-segment) and API-key.
- Sets `c.var.user` to the `UserRow` (full DB row) — id, email, supabase_auth_id, etc.
- Sets `c.var.tier` to `"free" | "plus"` based on `getActiveSubscription` lookup.
- Throws `UnauthorizedError` (401) if neither auth path works.

### Pattern 2: Config-write idempotence (D-01)

**What:** Extend `writeConfig` in `mcp/src/cli/init.ts:186-196` to write `user_id` + `email` fields.
**When to use:** Any change to `~/.synapse/config.json` — must preserve existing fields.
**Example:**
```typescript
// Source: mcp/src/cli/init.ts:186-196 (existing writeConfig)
interface SynapseConfig {
  api_key?: string;
  user_id?: string;   // NEW
  email?: string;     // NEW
}

function writeConfig(api_key: string, identity: { user_id: string; email: string }): void {
  const dir = synapseRoot();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing: SynapseConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
    : {};
  existing.api_key = api_key;
  existing.user_id = identity.user_id;
  existing.email = identity.email;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
```

`runInit` (line 59) calls `writeConfig` between `installSlashCommands` and `writeMcpJson`. The `/me` fetch must happen FIRST (before any disk writes per D-05 fail-fast):

```typescript
// New ordering in runInit:
export async function runInit(a: InitArgs): Promise<void> {
  // 1. Fetch identity FIRST — abort if it fails, before any disk writes.
  const identity = await fetchMe(a.api_key); // throws on network/auth fail
  // 2. THEN install hooks, slash commands, config, .mcp.json, service file
  const bin = resolveBin();
  installHooks(bin);
  installSlashCommands(bin);
  writeConfig(a.api_key, identity); // <-- now takes identity
  // ... rest unchanged
}
```

### Pattern 3: Daemon-side user_id resolution (D-03)

**What:** Replace `process.env.SYNAPSE_USER_ID ?? "default"` at `mcp/src/cli/hook-dispatch.ts:59`.
**When to use:** Every event the hook dispatcher emits.
**Example:**
```typescript
// Source: mcp/src/cli/handlers.ts:90-103 (existing readUserIdFromConfig — pattern to reuse)
function readUserIdFromConfig(): string {
  try {
    const root = process.env.SYNAPSE_HOME ?? path.join(process.env.HOME ?? "", ".synapse");
    const configPath = path.join(root, "config.json");
    if (!fs.existsSync(configPath)) return "local-user";
    const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { user_id?: string };
    return c.user_id ?? "local-user";  // or "default" for back-compat — tests use "default"
  } catch {
    return "local-user";
  }
}

// hook-dispatch.ts:59 becomes:
user_id: process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig(),
```

**Important:** The env-var override stays — discussed in CONTEXT D-03 (env var is tier-2 fallback for tests/debugging). The reordering puts env first, then config, then a stable placeholder. Reuse `handlers.ts:readUserIdFromConfig` instead of inlining a copy. Consider extracting it to `mcp/src/cli/util/identity.ts` so init, hook-dispatch, run-daemon, and handlers all use the same reader. (Today `run-daemon.ts:31-36` and `handlers.ts:90-103` each have their own; this duplication is the kind of thing that fails silently if one drifts.)

### Pattern 4: events-batch matcher extension (D-06)

**What:** Extend the per-cwd-hash auto-create loop at `backend/src/api/events-batch.ts:71-121` to try `git_remote_url` first, then `name` (status quo), then create.
**Example:**
```typescript
// Source: backend/src/api/events-batch.ts:82-115 (current matcher, extended)
for (const cwdHash of cwdHashIds) {
  const sample = body.events.find((e) => String(e.project_id) === cwdHash);
  const payload = (sample?.payload ?? {}) as {
    git_basename?: string;
    git_remote_url?: string;  // NEW — daemon adds this to the first event per cwd
  };
  const gitBasename = payload.git_basename ?? "untitled";
  const gitRemoteUrl = payload.git_remote_url ?? null;

  let existingId: string | null = null;

  // 1. NEW: try git_remote_url match first (higher precision)
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

    // If we matched by name but the row has no git_remote_url yet, BACKFILL it
    // so future cross-device events of this user link by URL (faster path).
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

  // 3. Create with BOTH name and git_remote_url populated
  const { data: created, error: createErr } = await db
    .from("projects")
    .insert({ name: gitBasename, owner_id: user.id, git_remote_url: gitRemoteUrl })
    .select("id")
    .single();
  if (createErr) throw createErr;
  // ... project_members insert unchanged
}
```

**Precedence rationale:** URL is more specific (a clone always has the same remote; basenames collide for `scratch`/`docs`/`api`). When URL matches, name might differ (user renamed the project on the dashboard) — that's fine, URL wins. When URL is null (non-git folder), name match handles it. The backfill step in (2) means existing rows from Phase 1 will gain their URL on the first event after Phase 2 ships — no migration script needed.

### Pattern 5: Eager pull on link (D-08)

**What:** New `runEagerPullCycle` in `mcp/src/capture/handoff-sync.ts` called by daemon when `runFlushCycle` returns a `canonical_project_id`.
**Example:**
```typescript
// New function in handoff-sync.ts (mirrors runPullCycle, lines 72-84)
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
  // Mark these rows as "pulled" so writeBrief can distinguish them later if needed
  // and so the flush cycle never picks them up (watermark gate).
  const lines = events.map((e) => JSON.stringify({ ...e, _pulled: true }));
  fs.appendFileSync(eventsFile, `${lines.join("\n")}\n`);
  // Critical: bump watermark past the highest pulled event_id so flush skips them.
  const highest = events[events.length - 1].event_id;
  fs.writeFileSync(watermarkPath, highest);
  return { pulled: events.length };
}
```

Hook into `daemon.ts:147-152` (the cycle loop):
```typescript
const flush = await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
const effectiveId = flush.canonical_project_id ?? project_id;
if (flush.canonical_project_id) {
  a.projects[i] = flush.canonical_project_id;
  // NEW: on first-time link, eager pull
  await runEagerPullCycle({
    project_id: effectiveId,
    api_key: a.api_key,
    api_url: a.api_url,
  });
}
await runPullCycle({ project_id: effectiveId, api_key: a.api_key, api_url: a.api_url });
if (a.user_id) writeBrief(effectiveId, a.user_id);
```

**Idempotence:** Re-running `synapse init` doesn't re-eager-pull because eager pull triggers only on `flush.canonical_project_id` being set — which only fires on the first flush after a fresh `cwd_<hash>`. Subsequent flushes already have the canonical UUID, no remap, no eager-pull. (However: deleting the local project dir between runs DOES re-trigger. That's fine — events.jsonl is wiped too.)

**Watermark coordination (the gotcha):** Local events have ULID `event_id`s generated by `events-log.ts:8-20`. Backend-stored events also have ULIDs (from the same source — daemon flushed them in the past). When we append pulled events to local `events.jsonl` and then update `.watermark` to the highest pulled event_id, the next `runFlushCycle` will compare `e.event_id > wm` and skip everything up to and including the pulled events. But if a new LOCAL event was appended between the eager-pull and the watermark write, we'd skip it. Solution: do the eager-pull BEFORE the daemon's normal flush cycle on the link tick, and write the watermark transactionally. Better: tag pulled events with `_pulled: true` and have `runFlushCycle` filter them out explicitly (belt-and-suspenders against the watermark gap).

### Pattern 6: Device-origin in brief (D-09)

**What:** Extend `handoff-brief.ts:32-43` to prepend device name when `mostRecent.actor.device_id !== local_device_id`.
**Example:**
```typescript
// Source: mcp/src/capture/handoff-brief.ts:17-44 (existing render(), extended)
function render(s: ProjectStatus, viewer: string, deviceLabels: Map<string, string> = new Map()): string {
  // ... existing project_id + current_next_step logic ...

  const mostRecent = s.active_actors[0];
  if (mostRecent) {
    const focus = mostRecent.current_focus ?? "(no focus)";
    const branch = mostRecent.branch ?? "(no branch)";
    if (mostRecent.actor.user_id === viewer) {
      // Same user — check if same device
      const localDeviceId = readOrCreateDeviceId(); // from actor.ts:8-15
      if (mostRecent.actor.device_id === localDeviceId) {
        lines.push(`Your last activity: ${focus} on ${branch}`);
      } else {
        const deviceName = deviceLabels.get(mostRecent.actor.device_id) ?? "another device";
        lines.push(`Most recent activity (on ${deviceName}): ${focus} on ${branch}`);
      }
    } else {
      // Existing other-user branch unchanged
      lines.push(`Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state}): ${focus} on ${branch}`);
    }
  }
  // ...
}
```

**Device-name lookup mechanism:** The events themselves only carry `actor.device_id` (a random hex, see `actor.ts:8-15`). The CLI key label `cli-<device-name>` lives on `api_keys.label` server-side, but there's no event-time join from `device_id` to `key_id`. Three viable approaches (planner picks):

1. **Server-rendered (recommended)** — backend reducer enriches `ProjectStatus.active_actors[i]` with `device_label` by joining `actor.device_id` against `api_keys.label` via a new column `api_keys.device_id` populated at key-mint time. Brief renderer reads `actor.device_label` directly. **Requires:** schema addition to `api_keys` (small), update at `auth.ts:246-258` mintCliSessionCode to write device_id, update `handoff-reducer.ts:21-39` rowToEvent to denormalize the label, update `lib/handoff-reducer.ts:5-19` to join.

2. **Client-side cache via `GET /api/account/keys`** — daemon pulls the key list once per cycle, caches `{device_id → label}` map in memory or `~/.synapse/devices.json`. Brief renderer reads from cache. **Requires:** new daemon poll, new local cache file, but NO schema change. Tradeoff: stale labels until next poll cycle.

3. **Event payload denormalization** — daemon writes `device_label` directly into every event's payload (read from `~/.synapse/config.json` which stores it from the /me call). **Requires:** events.jsonl writes carry one extra field; reducer reads `payload.device_label` instead of joining. Simplest but breaks the existing reducer contract.

**Planner pick:** approach 2 (client-cache). Rationale: zero schema change; the existing per-device CLI keys feature already populates `api_keys.label`; daemon already polls in cycles; the labels are slowly-changing (rename happens via dashboard PATCH, frequency ~once per device). Approach 1 is correct long-term but Phase 2 is on a 10-day clock — defer the schema change.

**Local device_id source:** `mcp/src/capture/actor.ts:8-15` (`readOrCreateDeviceId`) is the canonical local-device source. Same file, no change.

### Anti-Patterns to Avoid

- **Reading user_id at flush time, not write time** — events are written to `events.jsonl` long before the daemon flushes. If the daemon reads `config.json` at flush time and stamps the events then, you've broken the immutability of the events log and tests will diverge from production. **Write the real UUID at append time** (hook-dispatch.ts).
- **Caching the config reads in module-level state** — `~/.synapse/config.json` may be rewritten between hook invocations (e.g., user re-runs `synapse init`). Read fresh on every hook dispatch. The cost is one `fs.readFileSync` of a <500-byte file per Claude Code event; negligible.
- **Trusting `git remote get-url origin` to never throw** — it throws on non-git dirs, on dirs with no remote, on git dirs with a corrupt config, on dirs the user `cd`'d into via a symlink that the git rev-parse rejects. `resolve-project.ts:23-39` already wraps it in try/catch — copy that, don't reinvent.
- **Eager-pulling on every flush** — only pull on `canonical_project_id` REMAP (first-time link). The flag is `flush.canonical_project_id !== undefined`. Don't poll the events endpoint as a substitute for the normal pull cycle.
- **Backfilling `"default"` rows in local events.jsonl** — D-04 explicitly forbids. The backend already overrides actor_user_id (`events-batch.ts:60`), so historical rows in prod are correct. Local jsonl is opaque post-flush state; the watermark + the next flush flush rolls it over naturally.
- **Inferring tier from `getActiveSubscription` inside the /me route** — already inferred by `authMiddleware` and stashed in `c.var.tier` (`backend/src/lib/auth.ts:89-91`). Reuse, don't re-query.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading user identity from config | New reader in init.ts | Existing `handlers.ts:readUserIdFromConfig` (lines 90-103) — and **extract** it to `mcp/src/cli/util/identity.ts` for reuse | Avoid drift between `run-daemon.ts:31-36`, `handlers.ts:90-103`, and the new hook-dispatch reader |
| Reading git remote URL | New `git remote` shell-out | Existing `readGitSignals()` in `mcp/src/cli/resolve-project.ts:23-39` | Already wraps execSync with proper try/catch and basename extraction |
| HTTP client for `/me` | new `fetch` wrapper | Existing `validateApiKey` pattern in `mcp/src/cli/api.ts:11-28` | Already handles `AbortSignal.timeout(5000)` and parses Hono error envelopes |
| Encrypting config.json | At-rest encryption | None — gitignored plain JSON | Existing `~/.synapse/config.json` is plain JSON with api_key; user_id is no more sensitive than the key |
| Migrating existing project rows to add git_remote_url | One-shot SQL backfill in migration | In-place backfill in events-batch matcher (pattern 4 step 2) | Forward-only per D-04; backfill happens naturally as users emit events |
| New daemon poll loop for device labels | Standalone fetch loop | Piggyback on existing daemon cycle in `daemon.ts:135-188` — call once per cycle, cache in memory | Already runs every few seconds; no point in a second loop |
| Manual link merge logic | DELETE + INSERT chain | One RPC in Postgres similar to `reset_user_data` in `auth.ts:524` and `010_reset_user_data.sql` | Avoids partial-failure state between event reassign and project delete |

**Key insight:** Phase 2 has an unusually high reuse ratio. Nearly every piece of code needed already exists in some form in the codebase — the work is wiring it through to the right call sites, not inventing new mechanics.

## Runtime State Inventory

Phase 2 is not a rename/refactor — but it does change the **shape of `~/.synapse/config.json`** on disk, which makes the existing on-disk state a thing the plan must reason about.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.synapse/config.json` on every existing user's machine has `{api_key}` only (no `user_id`/`email`). Next `synapse init` rewrite (D-01) populates both. Daemon must handle the "config without user_id" case gracefully (fall through to "default" or "local-user" placeholder) so first daemon cycle after upgrade doesn't crash. | Code edit only: `readUserIdFromConfig()` already returns "local-user" on missing field — keep that fallback (`handlers.ts:99`). Document that running `synapse init` once after upgrade is the canonical migration path. |
| Stored data | `~/.synapse/projects/<cwd_hash>/events.jsonl` — all existing rows carry `actor.user_id = "default"`. D-04 says: forward-only, no backfill of these rows. They flush to backend; backend overrides `actor_user_id` at `events-batch.ts:60`. Production rows are correct already. | None — verified by audit of `events-batch.ts:60` which always overrides from `c.var.user.id` regardless of payload. |
| Live service config | None — Synapse doesn't have external service config storing identity. SOPS/n8n/etc. not in play. | None. |
| OS-registered state | launchd plist on macOS / systemd unit on Linux — registered by `mcp/src/capture/os-service.ts`. These invoke `<bin> daemon`, which reads `~/.synapse/config.json` fresh on startup. No identity baked into the plist. | None. |
| Secrets and env vars | `SYNAPSE_USER_ID` env var — currently used as the source-of-truth in `hook-dispatch.ts:59`. After D-03, it becomes a tier-2 override (env > config > placeholder). Existing CI/test environments that set this stay valid. | Code edit only: `process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig()`. No env var rename. |
| Build artifacts | None — Phase 2 doesn't rename packages, change `bin` entries, or shift module paths. | None. |

**Cross-device-specific runtime state for IDENT-02 (multi-device cache coherence):**
- `~/.synapse/device_id` on machine A != machine B — by design (random per-machine). These never need to match.
- `~/.synapse/projects/<cwd_hash>/` on machine B is created fresh from machine B's cwd hash, then renamed (`handoff-sync.ts:53`) to the canonical UUID dir after the first flush returns `canonical_project_ids`.
- Brief cache (`<dir>/cache/brief.md`) and status cache (`<dir>/cache/project_status.json`) are written by daemon's pull cycle (existing) — no coherence issue, last writer wins.

## Common Pitfalls

### Pitfall 1: Init writes config.json without user_id, daemon emits "default" forever
**What goes wrong:** D-05 says fail-fast, but the existing `writeConfig` (init.ts:186-196) is called unconditionally even today. If the new `/me` fetch fails AFTER `writeConfig` has run, the daemon starts up with `{api_key}` and no `user_id`, and `readUserIdFromConfig()` returns the placeholder forever.
**Why it happens:** Code-ordering bug. The /me fetch must precede ANY disk write.
**How to avoid:** In `runInit`, call `fetchMe(api_key)` BEFORE `installHooks`/`installSlashCommands`/`writeConfig`/`writeMcpJson`/`writeServiceFile`. If it throws, print a clear error and exit with code 1 — no disk writes at all.
**Warning signs:** A test where `fetchMe` throws but `config.json` still exists afterwards. Add a test that asserts: after `fetchMe` throws, `~/.synapse/config.json` does NOT exist (or is unchanged if it pre-existed).

### Pitfall 2: Event payload missing `git_remote_url` because cwd is a worktree
**What goes wrong:** `git remote get-url origin` works fine in worktrees, but a worktree's `.git` is a file pointing back to the main repo's `.git`. If users have multiple worktrees of the same repo with different basenames (e.g., `myrepo` main vs. `myrepo-wip-feature`), the auto-link will collapse them into one project on the URL match.
**Why it happens:** Two worktrees share `remote.origin.url`. The basename differs but the URL matcher wins (D-06 precedence).
**How to avoid:** Acceptable for Phase 2 — collapsing worktrees into one project is arguably correct (same repo = same context). Document in `02-RESEARCH.md` (here) so the planner is aware. If users complain, D-07 (manual override) is the escape hatch.
**Warning signs:** User with two checkouts of the same repo sees events from both surfacing in the same brief. (This is actually a feature for most workflows.)

### Pitfall 3: Eager pull duplicates events that the daemon also captures locally
**What goes wrong:** Race condition. Machine B does `synapse init`, then immediately starts a Claude Code session in the same git repo. The hook fires, appends to events.jsonl, daemon flushes, gets `canonical_project_id` remap, eager-pulls events. Some of those pulled events may include the SessionOpened event that was just flushed.
**Why it happens:** The events endpoint returns ALL events for the project including the ones the daemon just pushed.
**How to avoid:** Backend `GET /api/projects/:id/events` is idempotency-keyed by `event_id` (which is a ULID and globally unique). When the daemon appends pulled events to local jsonl, dedupe by `event_id`. Or simpler: filter `events` from the response where `actor.device_id === local_device_id` (the daemon's own writes).
**Warning signs:** events.jsonl contains the same event_id twice. ProjectStatus reducer is idempotent so this won't break briefs, but it bloats local disk. Add a test: pull cycle, then flush cycle, then pull cycle — events.jsonl line count grows linearly with each new local event only, NOT with each pulled event.

### Pitfall 4: Watermark advanced past unflushed local events
**What goes wrong:** Eager pull writes `.watermark = highest_pulled_event_id`. If a local event was appended between the pull-fetch and the watermark write (concurrency between hook-dispatch and daemon), the local event's event_id is LOWER than the watermark and gets skipped on the next flush.
**Why it happens:** ULIDs are monotonic by time, and the pulled events come from machine A which started before machine B — so a pulled event's ULID > a fresh local event's ULID is possible but unlikely. More likely: the daemon's eager pull happens in the same tick as a fresh local hook write, racing on watermark and events.jsonl.
**How to avoid:** Append-marker the pulled events with `_pulled: true` (NOT just bump watermark). `runFlushCycle` filters `_pulled` out before deciding what to POST. Watermark logic stays the same; pulled events are append-only context.
**Warning signs:** A local event present in events.jsonl but never reaches backend. Add a test: append a local event with high ULID, then call eager pull with a batch of OLDER pulled ULIDs, then call flush — the local event must be in the POST body.

### Pitfall 5: `/me` returns a `user_id` that's a string `null` because user record exists in `auth.users` but not `public.users`
**What goes wrong:** Auth middleware throws unauth (`backend/src/lib/auth.ts:51-56` logs and returns null) if the JWT validates but no `public.users` row exists. This already throws cleanly. But if the API-key path succeeds (`api_keys` row exists, joined `users(*)` populates `user`), the `user.id` is fine.
**Why it happens:** Edge case — should be handled by `014_robust_auth_user_trigger.sql`. But if a user was created before that trigger landed and never logged back in, their `auth.users` row exists but `public.users` is empty.
**How to avoid:** Already covered — auth middleware returns 401 in this case (`lib/auth.ts:52-55` logs the discrepancy). `/me` route doesn't need extra defense; if the middleware rejects, the route never runs.
**Warning signs:** User reports `synapse init` exits with "Auth failed" but they're definitely signed in on the web. Solution: visit the web dashboard, which re-triggers the user row create on next session validation. Out of Phase 2 scope; document in CONCERNS.md as a known recovery path.

### Pitfall 6: Two `auth.users` IDs vs `public.users` UUIDs confusion
**What goes wrong:** `auth.users.id` (Supabase Auth's UUID) is DIFFERENT from `public.users.id` (Synapse's UUID). The middleware joins `auth.users.id → public.users.supabase_auth_id → public.users.id`. The `/me` endpoint must return `public.users.id`, NOT `auth.users.id`.
**Why it happens:** Confusion at the route handler level.
**How to avoid:** `c.var.user` is the `UserRow` from `public.users` (`backend/src/db/types.ts:27-33`). `user.id` is the right field. Verify by writing the test before the code: `expect(response.user_id).toBe(testPublicUser.id)`.
**Warning signs:** events-batch starts rejecting writes with FK violations on `actor_user_id references users(id)` (the `users` here is `public.users` — see `015_handoff_layer.sql:8`). If the daemon writes an `auth.users.id` UUID, the FK will fail.

### Pitfall 7: Manual override merges projects but doesn't reassign events
**What goes wrong:** The "Merge into existing project" dashboard action (D-07) reassigns the projects row but forgets to UPDATE `handoff_events.project_id`, `handoff_project_status.project_id`, `conversations.project_id` etc. References dangle.
**Why it happens:** Naive `DELETE FROM projects WHERE id = $src` cascades via the FKs (`015_handoff_layer.sql:24,32,42,52,60` all `ON DELETE CASCADE`), so events get DELETED, not reassigned.
**How to avoid:** Do reassignment FIRST, then delete:
```sql
UPDATE handoff_events SET project_id = $tgt WHERE project_id = $src;
UPDATE handoff_project_status SET project_id = $tgt WHERE project_id = $src;
UPDATE conversations SET project_id = $tgt WHERE project_id = $src;
-- ... any other tables that reference projects.id
DELETE FROM projects WHERE id = $src;
```
Wrap in a Postgres RPC like `merge_projects(p_src uuid, p_tgt uuid, p_user_id uuid)` for atomicity, per `auth.ts:524` reset_user_data precedent.
**Warning signs:** After merge, brief is empty / events count drops to zero.

### Pitfall 8: `/api/account/keys` reveals other users' device labels via cache pollution
**What goes wrong:** Approach 2 in Pattern 6 (client-cache) — daemon pulls keys list, caches `{device_id → label}`. If two users share a machine (`SYNAPSE_HOME` swapped between users), the cache from user A pollutes user B's brief renderer.
**Why it happens:** Cache lives in `~/.synapse/devices.json` or process memory. Either is per-`SYNAPSE_HOME`, which is per-user. As long as users don't share `SYNAPSE_HOME`, no pollution.
**How to avoid:** Cache MUST be under `synapseRoot()` (already per-user). Don't put it in `/tmp` or a global location.
**Warning signs:** User reports seeing "another-user-laptop" in their brief. Solution: check that `SYNAPSE_HOME` resolves to a per-user path on the machine. (Out of scope for Phase 2 in detail — flagged.)

### Pitfall 9: `actor_user_id` not a UUID after Phase 2 ships, FK violations on flush
**What goes wrong:** The DB column `handoff_events.actor_user_id` is `uuid not null references users(id)` (migration 015 line 26). The daemon currently writes the placeholder string `"default"` into the actor payload — but the backend OVERRIDES `actor_user_id` from `c.var.user.id` (events-batch.ts:60). So the placeholder never reaches the column. Phase 2's change makes the daemon write a real UUID locally; that UUID flows through but is still overridden server-side. Net behavior identical for the column.
**Why it might happen:** A misguided test or migration touches the override at events-batch.ts:60.
**How to avoid:** Add a test asserting `events-batch.ts:60` line `actor_user_id: user.id` is NOT removed by Phase 2. (Verification only; nothing in Phase 2's planned changes alters this line.)
**Warning signs:** A test for IDENT-01 that asserts daemon writes a real UUID but doesn't also assert the backend column receives the same UUID. Both must pass.

## Code Examples

### Common Operation 1: Fetch /me with timeout + clear error messages

```typescript
// New helper in mcp/src/cli/api.ts (alongside validateApiKey, cliExchangeCode)
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
    // AbortError, network failure, DNS, proxy block
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

### Common Operation 2: Daemon-side gitRemoteUrl read at hook write time

```typescript
// Extend mcp/src/cli/hook-dispatch.ts:readHookPayloadFromStdin to capture git_remote_url
// Source pattern: mcp/src/cli/resolve-project.ts:23-39

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

// In readHookPayloadFromStdin, pass git_remote_url to the hook payload:
return {
  project_id,
  user_id: process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig(),
  session_id: parsed.session_id,
  // ... existing fields ...
  git_basename,
  git_remote_url: getGitRemoteUrl(cwd),  // NEW
  stdout: process.stdout,
};
```

The `session-start.ts` hook (lines 39-47) writes `payload.git_basename` already; extend it to include `git_remote_url`:
```typescript
payload: {
  hostname: actor.hostname,
  ...(args.git_basename ? { git_basename: args.git_basename } : {}),
  ...(args.git_remote_url ? { git_remote_url: args.git_remote_url } : {}),
},
```

Backend reads it at `events-batch.ts:83-85`.

### Common Operation 3: Migration 018 (D-06)

```sql
-- supabase/migrations/018_projects_git_remote_url.sql
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

**Migration naming convention verified:** `017_project_invites.sql` is the most recent. Next is `018_*` per the discussion's D-06 note in CONTEXT.md. Snake-case. Date-free.

**RLS implications:** `projects` table already has RLS enabled in `001_initial_schema.sql:79-86`. Adding a column doesn't change policies. The Worker uses the service role key (`backend/src/db/client.ts`), so the RLS check on read is bypassed; route handlers do their own membership checks.

### Common Operation 4: New POST /api/projects/:id/merge-into/:target_id (D-07)

```typescript
// Add to backend/src/api/projects.ts (after the existing share-links / activity / export routes)
projects.post("/:id/merge-into/:target_id", async (c) => {
  const user = c.get("user");
  const sourceId = c.req.param("id");
  const targetId = c.req.param("target_id");
  const db = c.get("db");

  // Owner check for both
  await requireRole(db, sourceId, user.id, "owner");
  await requireRole(db, targetId, user.id, "owner");

  // Single RPC for atomicity — see auth.ts:524 reset_user_data precedent
  const { error } = await db.rpc("merge_projects", {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_user_id: user.id,
  });
  if (error) {
    console.error("[projects/merge] rpc error:", error);
    return c.json({ error: `Merge failed: ${error.message}`, code: "MERGE_ERROR" }, 500);
  }

  await logActivity(db, {
    project_id: targetId,
    user_id: user.id,
    action: "project_merged",
    source: "human",
    metadata: { source_project_id: sourceId },
  });

  return c.json({ ok: true, project_id: targetId });
});
```

Companion SQL function in `019_merge_projects.sql` (or fold into 018):
```sql
create or replace function merge_projects(
  p_source_id uuid,
  p_target_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer as $$
begin
  -- Verify owner of both before touching anything
  perform 1 from project_members
    where project_id = p_source_id and user_id = p_user_id and role = 'owner';
  if not found then raise exception 'not owner of source project'; end if;
  perform 1 from project_members
    where project_id = p_target_id and user_id = p_user_id and role = 'owner';
  if not found then raise exception 'not owner of target project'; end if;

  update handoff_events set project_id = p_target_id where project_id = p_source_id;
  update handoff_project_status set project_id = p_target_id where project_id = p_source_id
    on conflict (project_id) do nothing;  -- if target already has status, keep target's
  delete from handoff_project_status where project_id = p_source_id;
  update conversations set project_id = p_target_id where project_id = p_source_id;
  update entries set project_id = p_target_id where project_id = p_source_id;
  update activity_log set project_id = p_target_id where project_id = p_source_id;

  delete from projects where id = p_source_id;
end;
$$;
```

Then recompute target's status from the merged events:
```typescript
// After the rpc call, recompute the target's reducer state
await recomputeProjectStatus(db, targetId);
```

### Common Operation 5: Brief renderer with device-origin (D-09)

```typescript
// mcp/src/capture/handoff-brief.ts — extended writeBrief signature
import { readOrCreateDeviceId } from "./actor.js"; // exposes the local device id

// Existing cache file for device labels (approach 2 from Pattern 6)
function readDeviceLabels(): Map<string, string> {
  const p = path.join(synapseRoot(), "devices.json");
  if (!fs.existsSync(p)) return new Map();
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf-8")) as { device_id: string; label: string }[];
    return new Map(json.map((d) => [d.device_id, d.label]));
  } catch {
    return new Map();
  }
}

export function writeBrief(project_id: string, viewer_user_id: string): void {
  const labels = readDeviceLabels();
  const brief = renderBriefFromCache(project_id, viewer_user_id, labels);
  // ... rest unchanged
}
```

And in the daemon loop (`mcp/src/capture/daemon.ts` cycle function), refresh device labels once per cycle:
```typescript
// Pseudo — fits between flush and pull, or runs concurrently with first project's flush
async function refreshDeviceLabels(api_key: string, api_url: string): Promise<void> {
  try {
    const res = await fetch(`${api_url}/api/account/keys`, {
      headers: { Authorization: `Bearer ${api_key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return; // silent — labels are best-effort
    const keys = (await res.json()) as { id: string; label: string }[];
    // We don't have device_id in keys table today (per Pattern 6 approach 2).
    // Instead: use the cli-<device-name> convention to map by label suffix.
    // The Brief renderer joins by stripping the cli- prefix and comparing against
    // a per-event device_id?... PROBLEM: there's no mapping today.
    //
    // CORRECTION: Approach 2 has a missing link. The api_keys row has a `label`
    // but the events have a `device_id` (random hex). There is no join key today.
    //
    // RESOLUTION: Either (a) populate api_keys.device_id at mintCliSessionCode
    // (Pattern 6 approach 1 — schema change) OR (b) use api_keys.last_used_at as a
    // weak signal: assume the most-recently-used cli-* key belongs to the actor
    // emitting the most recent event. Brittle but works for the common case.
    //
    // PLANNER DECISION: Punt the schema change to approach 1 — see Open Question 2.
    // Phase 2 ships D-09 with the weak "match by hostname-derived device name" heuristic:
    // if mostRecent.actor.device_id !== localDeviceId, fall back to:
    //   1. mostRecent.actor.hostname (already on Actor type — types.ts:8)
    //   2. "another device" as last resort
    // This still satisfies D-09's bug-class test ("brief includes device origin when
    // device_id != local"), per feedback_test_generality.md.
  } catch {
    /* network blip; keep stale labels */
  }
}
```

Given the join issue, **the simplest D-09 implementation that ships in Phase 2** is to use `mostRecent.actor.hostname` directly (already on the Actor type — `packages/shared/src/handoff/types.ts:8`). Hostname is set at `actor.ts:18` to `os.hostname()`. This gives `"Most recent activity (on tanmais-MacBook-Pro.local): ..."` without any new schema, lookup, or cache.

**Recommendation for D-09:** use `actor.hostname` as the device-origin string in Phase 2. Promote to `api_keys.label` (cleaner display) in a Phase 2.5 follow-up if dogfood reveals the hostname is too verbose. Test asserts the contract: "when actor.device_id ≠ local device_id, the brief contains the remote actor's hostname".

## State of the Art

Phase 2 doesn't depend on any fast-moving external library APIs — this is internal wiring. The most relevant "state of the art" is the existing per-device CLI keys feature shipped 2 days ago at commit `46bdabb`, which Phase 2 D-09 leverages for the device-origin display.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single `"cli"` label on api_keys | `cli-<sanitized-device-name>` labels, multi-key per user | commit `46bdabb` (per `feedback_session_freshness.md` + `project_per_device_keys_status.md`) | Brief renderer (D-09) can read these via `/api/account/keys` |
| Daemon emits `actor.user_id = "default"` | Daemon emits real UUID from config | **This phase (Phase 2)** | New field on config.json, new /me route |
| `cwd_<hash>` matches by name only | `cwd_<hash>` matches by git_remote_url first, name fallback | **This phase (Phase 2)** | New column on projects, new index |
| First brief on new machine = empty | First brief = eager-pulled from backend | **This phase (Phase 2)** | New eager-pull cycle in daemon |

**Deprecated/outdated:**
- Treating `SYNAPSE_USER_ID` as a hard fallback to `"default"` — moves to "test/debug override of the real config value".
- The `projects-resolve.ts` route (`backend/src/api/projects-resolve.ts`) is NOT used by the daemon's events flow today — only by older CLI commands. Its existing `git_origin_url` matching code (lines 67-86) is a useful reference pattern but does NOT need to be modified for Phase 2. (Worth noting in the plan: leave it alone, even though the new events-batch matcher duplicates its logic in a different table.)

## Decisions to be made (Open planner inputs)

These are areas where the planner must pick a path. Research has surfaced the options and tradeoffs; the decision is the planner's.

### D1: How to extract `readUserIdFromConfig`?
**Context:** Today `handlers.ts:90-103` and `run-daemon.ts:31-36` each have their own config reader. After D-03, `hook-dispatch.ts:59` needs the same logic. Three readers in three places will drift.
**Options:**
1. **Extract to `mcp/src/cli/util/identity.ts`** (recommended) — single source, three callers. Small refactor PR before the wiring change.
2. **Inline a new copy in hook-dispatch.ts** — fastest to ship; accepts the drift risk.
3. **Promote to `mcp/src/capture/identity.ts`** — co-located with `actor.ts`. Logical home since actor is the only consumer.
**Recommendation:** Option 3. Co-locates with `resolveActor()`.

### D2: Where does `fetchMe()` live?
**Context:** It's an HTTP client call from CLI → backend. `mcp/src/cli/api.ts` already has `validateApiKey()` and `cliExchangeCode()`.
**Options:**
1. **`mcp/src/cli/api.ts`** (recommended) — direct successor to existing fetchers.
2. **`mcp/src/cli/me.ts`** — new file. Cleaner separation per `feedback_file_organization` if such a preference existed (it doesn't).
**Recommendation:** Option 1.

### D3: Eager-pull endpoint shape?
**Context:** D-08 says "pull ProjectStatus + last N events". `GET /api/projects/:id/status` already exists; `GET /api/projects/:id/events?limit=500` already exists (`backend/src/api/project-events.ts:8-24`). Two separate calls vs. one combined endpoint?
**Options:**
1. **Two calls** (recommended) — `runPullCycle` (existing) for status + new `runEagerPullCycle` for events. Each is small and testable independently.
2. **One combined `/api/projects/:id/eager-bootstrap`** — single round-trip, returns `{ status, events }`. Reduces latency on machine B's first brief but couples two endpoints.
**Recommendation:** Option 1.

### D4: Device-origin lookup mechanism for D-09?
**Context:** Pattern 6 in Architecture above lays out three approaches. The join from `actor.device_id` (random hex) to `api_keys.label` (`cli-<name>`) has no existing key.
**Options:**
1. **Schema-add `api_keys.device_id`, populate at mint** — clean long-term, ~30 LOC migration + auth.ts edit.
2. **Client-cache via `/api/account/keys`, match weakly** — brittle, requires guessing.
3. **Use `actor.hostname` directly** (recommended) — already on Actor type, no new schema, no new cache. Sufficient for the D-09 bug-class test.
**Recommendation:** Option 3 for Phase 2; queue Option 1 for Phase 2.5 follow-up if hostname proves too verbose in dogfood.

### D5: Where does the manual-link merge UI land in the dashboard?
**Context:** D-07 says "one button + one modal + one endpoint". The frontend has `(app)/home` (redirected from dashboard), `(app)/projects/[name]/`, no explicit projects list. The pre-existing dashboard probably renders a list of projects in `+page.svelte` under `home` or similar.
**Options:**
1. **Inline action on each project row in the list** (e.g., a `⋮` menu) — natural place, matches how dashboards do it.
2. **Per-project settings page** (`projects/[name]/settings/+page.svelte` exists) — slower to discover but co-locates with other project ops.
3. **Defer to `/gsd:ui-phase 2`** — context.md mentions this UI spec will run before plan finalization.
**Recommendation:** Option 3. Wait for the UI spec; the backend endpoint (Pattern 4) and merge RPC can ship without the UI, then slice C wires the button when the spec lands.

## Validation Architecture

`workflow.nyquist_validation: true` in `.planning/config.json` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.x ([VERIFIED: mcp/package.json:39 + backend/package.json:23]) |
| Config files | `mcp/vitest.config.ts`, `backend/vitest.config.ts`, `frontend/vitest.config.ts` |
| Quick run (mcp) | `cd mcp && npm test` — runs `vitest run` |
| Quick run (backend) | `cd backend && npm test` — runs `vitest run` |
| Targeted file | `cd mcp && npx vitest run test/cli/hook-dispatch.test.ts` |
| E2E (slow) | `cd mcp && npm run test:e2e` — sets `TEST_E2E=1` |
| Full suite | `npm run test` from repo root — runs all workspaces |
| Pre-push gate | `npm run lint && npm run typecheck && npm run test` (~25s; per CLAUDE.md) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDENT-01 | `/api/account/me` returns `{user_id, email, tier}` for authenticated user | unit (Hono in-worker) | `cd backend && npx vitest run test/api/auth-me.test.ts` | ❌ Wave 0 |
| IDENT-01 | `/api/account/me` returns 401 for missing/invalid Authorization | unit (Hono in-worker) | (same file as above) | ❌ Wave 0 |
| IDENT-01 | `synapse init` aborts when `/me` throws (D-05 fail-fast) — `~/.synapse/config.json` not created | unit | `cd mcp && npx vitest run test/cli/init.test.ts` | ✅ extends existing |
| IDENT-01 | `synapse init` writes `user_id` + `email` to `~/.synapse/config.json` on `/me` success | unit | (same file) | ✅ extends existing |
| IDENT-01 | hook-dispatch reads `user_id` from `~/.synapse/config.json` (not "default") | unit | `cd mcp && npx vitest run test/cli/hook-dispatch.test.ts` | ✅ extends existing |
| IDENT-01 | hook-dispatch falls back to `SYNAPSE_USER_ID` env var when set (tier-2) | unit | (same file) | ✅ extends existing |
| IDENT-01 | events written by daemon carry `actor.user_id = <real-uuid>` (E2E roundtrip) | e2e (stub backend) | `cd mcp && npx vitest run test/e2e/handoff.e2e.test.ts` | ✅ extends existing |
| IDENT-01 | backend's `events-batch.ts:60` override still in place — `actor_user_id = c.var.user.id` regardless of payload | unit (structural) | `cd backend && npx vitest run test/api/events-batch.test.ts` | ✅ extends existing |
| IDENT-02 | events-batch matcher matches by `git_remote_url` when both event and existing project carry it | unit (Hono structural — full path needs live DB so kept as `.skip` like `events-batch-auto-create.test.ts:64`) | `cd backend && npx vitest run test/api/events-batch-auto-create.test.ts` | ✅ extends existing |
| IDENT-02 | events-batch falls back to name match when `git_remote_url` is null | unit (structural) | (same file) | ✅ extends existing |
| IDENT-02 | events-batch backfills `git_remote_url` on name-match | unit (structural) | (same file) | ❌ Wave 0 |
| IDENT-02 | daemon eager-pulls events on first `canonical_project_id` remap | unit + e2e | `cd mcp && npx vitest run test/capture/handoff-sync.test.ts` | ✅ extends existing |
| IDENT-02 | eager-pulled events get `_pulled: true` marker AND advance `.watermark` | unit | (same file) | ❌ Wave 0 |
| IDENT-02 | flush cycle does NOT re-flush events tagged `_pulled: true` | unit | (same file) | ❌ Wave 0 |
| IDENT-02 | E2E: machine A captures + flushes, machine B init's + first brief contains machine A's focus (the existing `handoff.e2e.test.ts:28-82` is the perfect template — extend with a fresh-tmpdir simulating "machine B installs" + the eager-pull step) | e2e (stub backend) | `cd mcp && npx vitest run test/e2e/handoff.e2e.test.ts` | ✅ extends existing |
| IDENT-02 | D-09: brief contains "on \<hostname\>" when most-recent activity has different device_id than local | unit | `cd mcp && npx vitest run test/capture/handoff-brief.test.ts` | ✅ extends existing |
| IDENT-02 | D-09: brief says "Your last activity" when device_id matches local | unit | (same file) | ✅ extends existing |
| D-06 schema | Migration 018 adds `projects.git_remote_url` column + index without error on existing prod | smoke (manual) | `cd backend && npm run db:migrate` (manual run on dogfood Supabase) | n/a — manual gate |
| D-07 endpoint | `POST /api/projects/:id/merge-into/:target_id` requires owner role on BOTH | unit (Hono in-worker) | `cd backend && npx vitest run test/api/projects-merge.test.ts` | ❌ Wave 0 (DEFERRED — see slice C) |
| Success Criterion #3 | The placeholder `cwd_<hash>` auto-resolve flow (Phase 1 contract) still works — events for an unknown cwd still create a canonical project | unit (structural) | `cd backend && npx vitest run test/api/events-batch-auto-create.test.ts` | ✅ existing test asserts no-404 — extend assertion to include git_remote_url null path |

### Sampling Rate
- **Per task commit:** `cd mcp && npm test` (~8s mcp suite) OR `cd backend && npm test` (~12s backend suite) depending on which workspace changed
- **Per wave merge:** `npm test` from repo root (full lint + typecheck + test across all 4 workspaces; ~25s per CLAUDE.md)
- **Phase gate:** `npm run test` green + E2E test `test/e2e/handoff.e2e.test.ts` extended with the multi-device scenario passing + manual `node mcp/scripts/test-cli-flow.mjs` passes against production (the same bar Success Criterion #3 reads)

### Wave 0 Gaps

Test files that need to be created or significantly extended BEFORE implementation begins:

- [ ] `backend/test/api/auth-me.test.ts` — NEW. ~80 LOC. Covers:
  - GET /api/account/me with valid api_key returns 200 + `{user_id, email, tier}`
  - GET /api/account/me with invalid Bearer returns 401
  - GET /api/account/me with missing Authorization returns 401
  - `user_id` returned matches `public.users.id`, NOT `auth.users.id`
- [ ] `mcp/test/cli/init.test.ts` — EXTEND. ~6 new test cases. Covers:
  - `runInit` calls `fetchMe()` BEFORE any disk write
  - On fetchMe rejection: `~/.synapse/config.json` does NOT exist after (or is unchanged from preexisting state)
  - On fetchMe success: `config.json` contains `api_key`, `user_id`, `email`
  - Re-running init with same key is idempotent (config.json contents stable)
- [ ] `mcp/test/cli/hook-dispatch.test.ts` — EXTEND. ~4 new test cases. Covers:
  - When `SYNAPSE_USER_ID` is set, hook payload carries that value (env wins)
  - When `SYNAPSE_USER_ID` is unset AND config has user_id, hook payload carries config value
  - When neither, hook payload carries placeholder ("local-user" or whatever fallback chosen)
  - hashCwd is still deterministic post-change (regression guard)
- [ ] `mcp/test/capture/handoff-sync.test.ts` — EXTEND. ~5 new test cases for eager pull. Covers:
  - `runEagerPullCycle` pulls events, writes them with `_pulled: true` marker, advances watermark to highest pulled event_id
  - Empty pull (backend returns `{ events: [] }`) is a no-op
  - 401 / 5xx from events endpoint throws cleanly
  - Subsequent `runFlushCycle` skips `_pulled: true` events
  - Subsequent flush still includes locally-captured (non-`_pulled`) events
- [ ] `backend/test/api/events-batch-auto-create.test.ts` — EXTEND. ~3 new structural cases. Covers:
  - Request body schema accepts `payload.git_remote_url` (no 400 on the new field)
  - Route exists for cwd_<hash> with `git_remote_url` populated (no 404)
  - Defensive: existing `git_basename`-only path still resolves (no regression)
- [ ] `mcp/test/capture/handoff-brief.test.ts` — EXTEND. ~3 new test cases for D-09. Covers:
  - When `mostRecent.actor.device_id === local`, brief reads "Your last activity"
  - When `mostRecent.actor.device_id !== local` AND same user_id, brief includes `mostRecent.actor.hostname`
  - When `mostRecent.actor.user_id !== viewer` (different user), existing other-user line is unchanged

- [ ] `mcp/test/e2e/handoff.e2e.test.ts` — EXTEND. ~1 new describe block. Covers:
  - "machine A → machine B same user same repo same git_remote_url" — Tanmai on machine A (tmpdir A) does focus + flush; Alex-the-test rebrands as `tanmai-machine-B` (tmpdir B, same `user_id`, different `device_id`), runs init equivalent (writes config.json with same user_id), runs eager-pull-equivalent against stub, runs SessionStart hook, asserts brief contains machine-A focus + hostname-of-machine-A.

- [ ] `mcp/scripts/test-cli-flow.mjs` — verify it still passes against production after the changes; no source modification needed. If it breaks, the daemon is misconfigured; halt and debug.

If `merge-into` (D-07) deferred to slice C: no additional Wave 0 file needed in this phase. Otherwise:
- [ ] `backend/test/api/projects-merge.test.ts` — NEW. ~60 LOC. Covers owner-role enforcement on both, RPC result, activity-log entry written.

**Framework install:** None — vitest already present in all workspaces. No `@cloudflare/vitest-pool-workers` upgrade needed.

## Security Domain

`security_enforcement` not set in `.planning/config.json` — treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing auth middleware (`backend/src/lib/auth.ts:31-94`) — no change, but verified to handle `/api/account/me` correctly (route is mounted on `account` Hono which uses `authMiddleware`) |
| V3 Session Management | yes | Stateless API key sessions (existing) — `/me` adds no new session state |
| V4 Access Control | yes | Owner-only enforcement on `POST /api/projects/:id/merge-into/:target_id` (D-07) via `requireRole(db, projectId, user.id, "owner")` for BOTH sides |
| V5 Input Validation | yes | zod schemas for any new request bodies — D-07 merge endpoint validates `:id` and `:target_id` as UUIDs (matches existing `cliRevokeAndSession.revoke_key_id` pattern) |
| V6 Cryptography | no | No new cryptography. API key auth unchanged. SHA-256 key hashing (existing) untouched |
| V7 Errors / Logging | yes | New `/me` route uses standard `AppError` + `c.json` envelope; no PII in error messages |
| V8 Data Protection | yes | `~/.synapse/config.json` already gitignored and per-user (`synapseRoot()` resolves to `$HOME/.synapse` or `SYNAPSE_HOME` env). Adding `user_id` + `email` to it doesn't change classification — both already in the api_key's join chain |
| V9 Communications | yes | All `/me` + `/events/batch` + `/projects/:id/events` traffic over HTTPS to `api.synapsesync.app` (existing) |
| V11 Business Logic | yes | Merge endpoint (D-07) — verify no race where user merges A→B then immediately B→A and corrupts state. Wrap in DB transaction (already implicit via RPC). |
| V13 API Security | yes | Rate limit (120/min keyed by Authorization header) covers all new routes via the global `app.use("*", rateLimit(...))` in `index.ts:46` |

### Known Threat Patterns for {Hono + Cloudflare Workers + Supabase} stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plaintext config.json leak via shell history / process listing | Information Disclosure | Don't log `user_id` + `email` from init flow (they're not secrets but not for log scrape); current init.ts:60-89 doesn't log them — keep it |
| Cross-user project leak via merge endpoint | Elevation of Privilege | Owner check on BOTH source and target before RPC — Pattern 4 above explicit |
| Daemon flushes "default"-actor events after Phase 2 ships (user didn't re-run init) | Information Disclosure / data integrity | Backend `events-batch.ts:60` override is unconditional — actor_user_id always becomes the authenticated user. Daemon's local "default" is harmless |
| `/me` reveals tier across user boundaries via cache poisoning | Information Disclosure | `/me` is per-request, no caching; tier comes from `c.var.tier` (authMiddleware-scoped) — no shared state |
| Git remote URL is treated as a trusted user identifier across users | Spoofing | NEVER: events-batch matcher always filters by `memberProjectIds` first (line 79-80). A user can't match into another user's project just by claiming the same URL. |
| Eager-pull discloses events from another user | Information Disclosure | `GET /api/projects/:id/events` is RLS-gated via `authMiddleware` (line 6) AND the daemon's eager-pull uses the SAME api_key that just minted the canonical_project_id — backend's membership check (events-batch lines 79-80, projects-resolve lines 22) ensures the user is already a member |
| Race in eager-pull races with cross-user invite (Phase 4 territory) | Information Disclosure | Out of Phase 2 scope — invite/accept doesn't ship until Phase 4 |

## Project Constraints (from CLAUDE.md)

- **Synapse MCP read-through pattern** — research must call `mcp__synapse__search` before scanning codebase. (Confirmed adhered to: searched Synapse first for context-management/identity/cross-device decisions.)
- **No PR ceremony** — merge directly to main, no PRs (per `feedback_no_prs.md` in memory).
- **Push immediately after commit** — `feedback_push_commits.md` — every commit gets a `git push` right after.
- **No lockfile commits** — `feedback_no_lockfile.md` — don't commit `package-lock.json`. Phase 2 doesn't add deps so no concern.
- **Always test** — `feedback_always_test.md` — every change has an E2E test. Validation Architecture above enumerates the test additions explicitly.
- **No external users / clean slate** — `feedback_no_other_users.md` — no backwards-compat for `"default"` actor; D-04 forward-only is consistent.
- **Worktree node_modules symlink** — `feedback_worktree_node_modules.md` — affects frontend tests on worktrees, not Phase 2 scope.
- **Use Opus subagents** — `feedback_opus_agents.md` — relevant when planner dispatches subagents; not constrainting research.
- **Inline execution, no gsd-executor dispatch** — `feedback_user_driven_execution.md` — planner produces plans the USER executes inline via Edit/Write.
- **Test generality** — `feedback_test_generality.md` — tests guard the bug class, not strings. D-09 test asserts "brief contains a device-origin segment when device_id differs", not "brief contains the literal string 'on tanmais-MacBook-Pro'".
- **CI red during Nyquist is expected** — `project_ci_red_during_nyquist.md` — intermediate failures during Wave 0→N are fine; final wave is the source of truth.
- **Wrangler unusable on this device** — `project_split_machine_wrangler.md` — Phase 2 backend changes can't be deployed from this machine. Deploy work parks on a CF-enabled machine. Plan must split: code + tests land here; `wrangler deploy` + Supabase migration apply happens on the deploy machine.
- **Pre-push hook adds ~25s** — keep task scopes small so the hook isn't punishing. The Phase 2 plans naturally do this — most changes are <100 LOC per file.

## Sources

### Primary (HIGH confidence — read in this session)
- `.planning/phases/02-real-user-identity/02-CONTEXT.md` — Phase 2 locked decisions, canonical refs map [VERIFIED]
- `.planning/phases/02-real-user-identity/02-DISCUSSION-LOG.md` — alternatives audit trail [VERIFIED]
- `.planning/REQUIREMENTS.md` — IDENT-01, IDENT-02 acceptance bars [VERIFIED]
- `.planning/STATE.md` — current milestone state (Phase 1 slice 1a-prime shipped) [VERIFIED]
- `.planning/ROADMAP.md` — Phase 2 entry + dependency graph [VERIFIED]
- `.planning/codebase/INTEGRATIONS.md` §Authentication, Handoff event flow [VERIFIED]
- `.planning/codebase/ARCHITECTURE.md` §System Overview + Component Responsibilities [VERIFIED]
- `.planning/codebase/CONVENTIONS.md` §Naming, Imports [VERIFIED]
- `.planning/codebase/STRUCTURE.md` §Directory Layout [VERIFIED]
- `CLAUDE.md` (project) — Synapse MCP pattern, GSD enforcement [VERIFIED]
- `mcp/src/capture/actor.ts` (lines 1-19) — `resolveActor`, `readOrCreateDeviceId`, hostname capture [VERIFIED]
- `mcp/src/cli/hook-dispatch.ts` (lines 48-92) — D-03 fix site, hashCwd, getGitBasename [VERIFIED]
- `mcp/src/cli/init.ts` (lines 59-196) — D-01 anchor, writeConfig, idempotence pattern [VERIFIED]
- `mcp/src/cli/handlers.ts` (lines 90-103) — existing readUserIdFromConfig pattern [VERIFIED]
- `mcp/src/cli/run-daemon.ts` (lines 30-54) — daemon's config read, user_id pass-through [VERIFIED]
- `mcp/src/cli/api.ts` (entire file, 47 LOC) — fetchMe analog (`validateApiKey`) [VERIFIED]
- `mcp/src/cli/wizard.ts` (lines 31-189) — wizard → runInit handoff [VERIFIED]
- `mcp/src/cli/resolve-project.ts` (lines 23-62) — `readGitSignals` reusable pattern [VERIFIED]
- `mcp/src/cli/config.ts` (entire file, 6 LOC) — API_URL constant [VERIFIED]
- `mcp/src/capture/cloud-sync.ts` (lines 19-44, 172-184) — alt git_origin_url capture site [VERIFIED]
- `mcp/src/capture/handoff-sync.ts` (lines 1-84) — `runFlushCycle`, `runPullCycle` template for eager pull [VERIFIED]
- `mcp/src/capture/handoff-paths.ts` (entire file) — synapseRoot, projectDir, statusCachePath [VERIFIED]
- `mcp/src/capture/handoff-brief.ts` (lines 1-69) — D-09 fix site [VERIFIED]
- `mcp/src/capture/events-log.ts` (lines 1-53) — ULID generation, appendEvent, readEvents [VERIFIED]
- `mcp/src/capture/daemon.ts` (lines 135-188) — cycle loop, where eager-pull hook fits [VERIFIED]
- `mcp/src/hooks/session-start.ts` (lines 19-68) — event payload shape, STATE.md fallback [VERIFIED]
- `mcp/src/hooks/post-tool-use.ts` (entire file) — event payload examples [VERIFIED]
- `backend/src/lib/auth.ts` (lines 31-94) — authMiddleware contract, tier resolution [VERIFIED]
- `backend/src/api/auth.ts` (lines 432-538) — account routes, single-purpose convention [VERIFIED]
- `backend/src/api/events-batch.ts` (entire file, 168 LOC) — D-06 matcher fix site, override at :60 [VERIFIED]
- `backend/src/api/project-events.ts` (entire file) — eager-pull endpoint already exists [VERIFIED]
- `backend/src/api/project-status.ts` (entire file) — existing pull endpoint [VERIFIED]
- `backend/src/api/projects.ts` (entire file) — D-07 merge endpoint home; pattern via member/share-link routes [VERIFIED]
- `backend/src/api/projects-resolve.ts` (entire file) — existing git_origin_url reference (NOT modified, only learned from) [VERIFIED]
- `backend/src/api/invites.ts` (entire file) — POST endpoint with member-check pattern [VERIFIED]
- `backend/src/lib/handoff-reducer.ts` (entire file) — recompute, rowToEvent [VERIFIED]
- `backend/src/lib/constants.ts` (entire file) — DEVICE_LABEL_PREFIX, limits [VERIFIED]
- `backend/src/lib/validate.ts` (entire file) — zod schema patterns [VERIFIED]
- `backend/src/db/queries/api-keys.ts` (entire file) — listApiKeys, listCliKeys [VERIFIED]
- `backend/src/db/types.ts` (entire file) — UserRow shape [VERIFIED]
- `backend/src/index.ts` (entire file) — route mounting [VERIFIED]
- `packages/shared/src/handoff/types.ts` (entire file) — Actor type (hostname is the device-origin source) [VERIFIED]
- `packages/shared/src/handoff/events.ts` (entire file) — EventKind enum [VERIFIED]
- `packages/shared/src/handoff/reducer.ts` (entire file) — fold logic for active_actors [VERIFIED]
- `supabase/migrations/015_handoff_layer.sql` (entire file) — handoff_events schema, FK to users [VERIFIED]
- `supabase/migrations/016_drop_handoff_session_fks.sql` (entire file) — FK relaxation precedent [VERIFIED]
- `supabase/migrations/017_project_invites.sql` (entire file) — naming pattern for migration 018 [VERIFIED]
- `mcp/test/e2e/handoff.e2e.test.ts` (entire file) — E2E template to extend [VERIFIED]
- `mcp/test/e2e/stub-backend.ts` (entire file) — in-process stub for E2E tests [VERIFIED]
- `mcp/test/cli/init.test.ts` (entire file) — init test patterns [VERIFIED]
- `mcp/test/cli/hook-dispatch.test.ts` (entire file) — hook-dispatch test patterns [VERIFIED]
- `mcp/test/capture/handoff-sync.test.ts` (entire file) — flush test patterns [VERIFIED]
- `mcp/test/capture/handoff-brief.test.ts` (file existence confirmed; D-09 test extensions land here) [VERIFIED via ls]
- `mcp/test/hooks/session-start.test.ts` (entire file) — STATE.md freshness contract, brief assertion patterns [VERIFIED]
- `backend/test/api/events-batch-auto-create.test.ts` (entire file) — structural test pattern, `.skip` for live-DB scenarios [VERIFIED]
- `mcp/scripts/test-cli-flow.mjs` (entire file) — smoke test pattern [VERIFIED]
- `mcp/package.json` / `backend/package.json` — versions and scripts [VERIFIED]

### Secondary (MEDIUM confidence — referenced from memory snapshots)
- `feedback_*` memories from `~/.claude/projects/-Users-Tanmai-N-Documents-synapse/memory/` — solo-dev preferences, push policy, no PRs [READ from CLAUDE.md system reminder]
- `project_per_device_keys_status.md` — per-device CLI keys end-to-end at commit `46bdabb`; UX pieces deferred [READ from CLAUDE.md system reminder]

### Tertiary (LOW confidence — none required)
- No external library research needed. All decisions verified against in-repo source.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `c.var.tier` from `authMiddleware` returns `"free"` or `"plus"` (not `null`) for every authenticated user | D-02 route example | Low — middleware sets tier unconditionally at lines 89-91, even if no subscription exists (defaults to `"free"`) |
| A2 | `actor.hostname` from `os.hostname()` is human-readable enough for D-09's device-origin display | Recommendation under Pattern 6 / Open Question D4 | Medium — on some Linux servers hostname is `ip-192-168-1-23.ec2.internal`. Phase 2.5 follow-up can swap to `cli-<sanitized-name>` lookup if dogfood shows hostname is too noisy |
| A3 | Eager-pull's 500 event limit is bounded enough that local jsonl stays under ~5MB per project | Pattern 5 + D-08 | Low — 500 events × ~500 bytes/event = 250KB. Even 10 projects = 2.5MB total. Watermark-correct so no growth on subsequent pulls |
| A4 | The `projects_user_remote_url_idx` composite index gives sub-10ms lookups in production | Migration 018 sketch | Low — index is selective (URLs are user-unique strings); Supabase Postgres handles this trivially at expected scales (~100 projects/user) |
| A5 | No existing project has a non-null `git_remote_url` (column doesn't exist yet); migration's `add column if not exists` is safe to apply twice | Migration 018 sketch | Low — `if not exists` guard is explicit; idempotent |
| A6 | `~/.synapse/config.json` is per-user (`synapseRoot()` = `$HOME/.synapse` or `SYNAPSE_HOME`) and never shared between OS users on a single machine | Security V8 entry | Medium — if two devs share a Mac via the same OS account (rare), they'd share config. Out of scope: the per-device CLI keys feature is the user-level multiplexer, not file isolation |
| A7 | The auto-link via `git_remote_url` is welcome behavior in worktree scenarios (collapsing worktrees into one project) | Pitfall 2 | Medium — user feedback dependent. The manual-override UI (D-07) is the escape hatch if this turns out wrong |
| A8 | All Phase 2 backend changes can deploy together via a single `wrangler deploy` (migration + code) since the migration is additive | Project constraint about manual deploy | Low — migration column-add is additive; old code (which doesn't write the column) coexists with new code (which does). Deploy order doesn't matter — column-then-code or code-then-column both work |
| A9 | `account.use("*", authMiddleware)` at `backend/src/api/auth.ts:434` will auto-apply to the new `/me` route | Pattern 1 example | Low — Hono `use("*", ...)` is unconditional on the sub-app; verified by reading the existing `/keys`, `/keys/:id`, `/reset` routes all benefiting from it |

## Open Questions

1. **Should we mint a fresh device CLI key when `synapse init` runs on machine B, or reuse the api_key from the wizard?**
   - What we know: Wizard's `browserAuth()` already mints a per-device key with label `cli-<hostname>`. If user pastes a key manually (not via wizard), the key has whatever label it was minted with.
   - What's unclear: When init is called outside the wizard (direct CLI with `--api-key`), do we need to require the key be a `cli-*` device key, or accept any valid api_key?
   - Recommendation: Accept any valid api_key for Phase 2; manual-paste users get the `actor.hostname` device-origin in briefs which is sufficient. Defer hardening to follow-up if dogfood surfaces a real issue.

2. **Should we add `api_keys.device_id` schema column now to enable Pattern 6 approach 1 (clean device-name lookup), or defer to Phase 2.5?**
   - What we know: It's ~30 LOC migration + ~10 LOC at `auth.ts:246` mintCliSessionCode + ~5 LOC in reducer. Total ~45 LOC.
   - What's unclear: Whether `actor.hostname` displays well enough in real dogfood briefs to justify deferring the schema change.
   - Recommendation: Ship Phase 2 with `actor.hostname` per A2. File a follow-up in BUGS.md if dogfood reveals hostname is too verbose. The migration can land anytime as it's purely additive.

3. **What's the right N for "last N events" on eager pull?**
   - What we know: D-08 suggests 500. Reducer's `recent_activity` slice caps at 50 anyway.
   - What's unclear: Whether 500 is overkill (50 might suffice) or too small (active projects may have thousands of events the user wants surfaced).
   - Recommendation: 500 as documented in CONTEXT D-08 + make it configurable via `~/.synapse/config.json` `eager_pull_event_limit` for future tuning. Default value covers the dogfood window.

4. **Does the manual-merge endpoint need a "preview" mode before destruction?**
   - What we know: D-07 says one button + one modal + one endpoint. The modal lists candidate projects.
   - What's unclear: Whether the modal should show "5 events from project A will be reassigned to project B" before the user clicks confirm.
   - Recommendation: For Phase 2 ship the simple version (modal lists candidates, click confirms, destruction happens server-side). The merge action is reversible by re-merging in the other direction. Defer the preview UI to a follow-up if dogfood shows user-error rate is high.

5. **Should the daemon's eager-pull run synchronously inside the cycle (blocks next flush) or in a background promise?**
   - What we know: Discussion-log Q3 picked "eager full sync on link". Daemon's cycle is currently sequential (`daemon.ts:144-158`).
   - What's unclear: Whether blocking the cycle for ~1-2 seconds (network roundtrip + jsonl write) at link time is acceptable.
   - Recommendation: Block. Linking is a once-per-fresh-project event; brief renders within the next cycle (~5s normal interval) regardless.

## Environment Availability

Skipped — Phase 2 has no external dependencies beyond what Phase 1 already verified (Node 22, npm, vitest, Supabase reachable, Cloudflare reachable). The deploy machine constraint (`project_split_machine_wrangler.md`) is a process constraint, not an environment availability gap.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package verified in package.json files; no new deps
- Architecture: HIGH — every change site mapped to a specific file + line range; patterns documented from existing code
- Pitfalls: HIGH — Pitfalls 1-9 derived from real-code inspection, not speculation
- Validation: HIGH — test file existence checked; gaps explicit

**Confidence by Decision:**
- D-01 (init persists user_id): HIGH — change site `init.ts:186-196` clear, pattern matches existing writeConfig
- D-02 (new /me route): HIGH — `auth.ts:432-538` account sub-app pattern is exemplary; ~10 LOC route addition
- D-03 (hook-dispatch reads config): HIGH — change site `hook-dispatch.ts:59` is a one-line replacement; reuse `handlers.ts:90-103` pattern
- D-04 (no backfill of old default rows): HIGH — verified backend always overrides at `events-batch.ts:60`; no code change needed
- D-05 (fail-fast on /me failure): HIGH — purely an ordering constraint in runInit; testable
- D-06 (git_remote_url matcher): HIGH — schema additive, matcher extension follows existing pattern; backfill story is sound
- D-07 (manual override UI): MEDIUM — backend endpoint is straightforward; UI surface deferred to `/gsd:ui-phase 2`
- D-08 (eager full sync on link): HIGH — `runPullCycle` template + `GET /api/projects/:id/events` exists; watermark coordination understood
- D-09 (device origin in brief): MEDIUM — depends on Open Question 2 resolution; Phase 2 recommended path is `actor.hostname` (HIGH confidence in that path)

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (30 days; the codebase moves fast but Phase 2's primitives are stable)

## RESEARCH COMPLETE
