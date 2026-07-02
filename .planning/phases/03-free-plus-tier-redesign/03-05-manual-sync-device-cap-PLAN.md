---
phase: 03-free-plus-tier-redesign
plan: 5
type: execute
wave: 3
depends_on: [03-01]
files_modified:
  - mcp/src/capture/daemon.ts
  - mcp/src/capture/handoff-sync.ts
  - mcp/src/cli/sync.ts
  - mcp/src/cli/init.ts
  - mcp/src/cli/device-id.ts
  - mcp/src/cli/commands.ts
  - backend/src/api/device-keys.ts
  - backend/src/index.ts
  - supabase/migrations/025_device_keys_machine_id.sql
  - frontend/src/routes/(app)/settings/devices/+page.svelte
  - mcp/test/cli/sync.test.ts
  - mcp/test/cli/device-id.test.ts
  - scripts/e2e-device-cap.mjs
  - scripts/e2e-manual-sync.mjs
autonomous: false
requirements: [TIER-05, TIER-06, TIER-07]

must_haves:
  truths:
    - "Daemon's cycle() skips flush/pull/prewarm when user tier is free"
    - "Hooks (SessionEnd, PreCompact) still push inline regardless of tier"
    - "`synapsesync sync` CLI fires one cycle on demand with streaming progress + final summary"
    - "Free user limited to 3 devices, Plus to 10"
    - "Re-init from same machine returns the existing key (no duplicate row)"
    - "4th device init on Free surfaces an arrow-key sign-out picker"
    - "Tier flip (free→plus) propagates to daemon within seconds via tier_revision response piggyback"
    - "Device identity persists across hostname renames via ~/.synapse/device.json UUID"
  artifacts:
    - path: "mcp/src/cli/device-id.ts"
      provides: "getOrCreateMachineId — UUID at ~/.synapse/device.json, stable across hostname renames"
      contains: "getOrCreateMachineId"
    - path: "mcp/src/cli/sync.ts"
      provides: "Manual sync command with streaming progress output"
      contains: "synapsesync sync"
    - path: "supabase/migrations/025_device_keys_machine_id.sql"
      provides: "machine_id column + UNIQUE(user_id, machine_id) partial index"
      contains: "machine_id"
    - path: "frontend/src/routes/(app)/settings/devices/+page.svelte"
      provides: "Device management UI — list, rename, sign out"
      contains: "devices"
    - path: "scripts/e2e-device-cap.mjs"
      provides: "E2E for 3-device cap + sign-out picker + re-init-no-duplicate"
      contains: "DEVICE_CAP_EXCEEDED"
    - path: "scripts/e2e-manual-sync.mjs"
      provides: "E2E for Free manual sync + auto-sync after tier flip"
      contains: "tier_revision"
  key_links:
    - from: "mcp/src/capture/daemon.ts:cycle"
      to: "backend response tier_revision field"
      via: "fetch response inspection in runFlushCycle"
      pattern: "tier_revision"
    - from: "mcp/src/cli/init.ts"
      to: "mcp/src/cli/device-id.ts:getOrCreateMachineId"
      via: "import { getOrCreateMachineId }"
      pattern: "machine_id"
---

<objective>
The biggest slice — gates the daemon's auto-sync cycle on tier, adds the new `synapsesync sync` CLI command with streaming output, builds solid device identity via per-machine UUID, enforces the 3/10 device cap with a sign-out picker, and wires tier-flip latency down to seconds via response piggyback.

Sub-pieces (track separately during execution):
- A. Migration 025 (machine_id column + unique index)
- B. Device-id helper (`mcp/src/cli/device-id.ts`)
- C. Backend device-key registration (cap check + return existing key on re-init)
- D. CLI `init` flow extension (use machine_id, handle 402 picker)
- E. `synapsesync sync` command + commands.ts registration
- F. Daemon tier-gate + tier_revision piggyback
- G. Frontend settings/devices page
- H. E2E tests
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md
@.planning/phases/03-free-plus-tier-redesign/03-PATTERNS.md
@mcp/src/capture/daemon.ts
@mcp/src/capture/handoff-sync.ts
@mcp/src/cli/init.ts
@mcp/src/cli/smoke.ts
@mcp/src/cli/commands.ts
@backend/src/api/device-keys.ts
@backend/src/index.ts
@supabase/migrations/024_insights_supersession.sql
</context>

<tasks>

<task id="03-05-A" type="execute">
<title>Migration 025 — device_keys.machine_id column + unique partial index</title>
<read_first>
  - supabase/migrations/024_insights_supersession.sql (recent migration pattern — additive, idempotent)
</read_first>
<action>
Create `supabase/migrations/025_device_keys_machine_id.sql`:

```sql
-- 025_device_keys_machine_id.sql
-- Solid per-machine device identity for the device cap.
--
-- Adds device_keys.machine_id (NULL for legacy rows). New CLI installs
-- generate a UUID and persist it at ~/.synapse/device.json, then include
-- it on device-key registration. Re-init from the same machine matches
-- on (user_id, machine_id) via the partial unique index and returns the
-- existing row instead of creating a duplicate.
--
-- The index is partial (WHERE machine_id IS NOT NULL) so legacy rows with
-- NULL machine_id don't conflict with each other or block the migration.

ALTER TABLE device_keys
  ADD COLUMN IF NOT EXISTS machine_id text DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_keys_user_machine
  ON device_keys(user_id, machine_id)
  WHERE machine_id IS NOT NULL;
```

User must apply this migration via Supabase Dashboard SQL Editor (or `supabase db push` if the CI auto-migrate is wired). Call out in the commit message.
</action>
<acceptance_criteria>
  - File `supabase/migrations/025_device_keys_machine_id.sql` exists
  - Migration is purely additive + idempotent (IF NOT EXISTS)
  - Commit message references the manual-apply step
  - User confirms migration applied before downstream tasks (03-05-C, 03-05-D)
</acceptance_criteria>
</task>

<task id="03-05-B" type="execute">
<title>device-id.ts — get-or-create machine UUID at ~/.synapse/device.json</title>
<read_first>
  - mcp/src/capture/handoff-paths.js (synapseRoot helper)
</read_first>
<action>
Create `mcp/src/cli/device-id.ts`:

```typescript
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "../capture/handoff-paths.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeviceFile {
  machine_id: string;
  created_at: string;
}

/**
 * Returns this machine's stable UUID. On first call, generates and
 * persists to ~/.synapse/device.json. Subsequent calls return the
 * persisted value.
 *
 * If ~/.synapse/device.json is deleted, a new UUID is generated — this
 * appears to the backend as a new device. That's correct semantically
 * (the user has reset their install state) but consumes a slot on the
 * cap. `doctor` should surface this as a warning when the device-key
 * count > 1 and ~/.synapse/device.json looks newly-created.
 */
export function getOrCreateMachineId(): string {
  const file = path.join(synapseRoot(), "device.json");

  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<DeviceFile>;
      if (data.machine_id && UUID_PATTERN.test(data.machine_id)) {
        return data.machine_id;
      }
    } catch {
      // Fall through to regenerate
    }
  }

  const id = crypto.randomUUID();
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ machine_id: id, created_at: new Date().toISOString() } satisfies DeviceFile, null, 2),
  );
  return id;
}

/**
 * Read-only helper: returns the machine_id if it exists, null otherwise.
 * Used by diagnostics (doctor, status) to detect a fresh install.
 */
export function peekMachineId(): string | null {
  const file = path.join(synapseRoot(), "device.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<DeviceFile>;
    return data.machine_id && UUID_PATTERN.test(data.machine_id) ? data.machine_id : null;
  } catch {
    return null;
  }
}
```

Add a corresponding test file at `mcp/test/cli/device-id.test.ts`:
- Test 1: First call creates the file with valid UUID
- Test 2: Second call returns the same UUID (no regeneration)
- Test 3: Corrupted file → regenerates with new UUID
- Test 4: peekMachineId returns null when file doesn't exist
- Tests use a tmpdir SYNAPSE_HOME to avoid touching the real user state
</action>
<acceptance_criteria>
  - File `mcp/src/cli/device-id.ts` exists with both exports
  - File `mcp/test/cli/device-id.test.ts` exists with 4+ tests
  - `npm run test --workspace=mcp -- device-id` exits 0
  - UUIDs match the regex pattern; corrupted JSON triggers regen, not crash
</acceptance_criteria>
</task>

<task id="03-05-C" type="execute">
<title>Backend: device-key registration with machine_id matching + cap check</title>
<read_first>
  - backend/src/api/device-keys.ts (or wherever CLI key registration lives — search for "cli-" prefix)
  - backend/src/lib/tier.ts (getDeviceCapForTier from 03-01)
  - backend/src/lib/constants.ts (DEVICE_LIMIT_FREE, DEVICE_LIMIT_PLUS, DEVICE_LABEL_PREFIX)
</read_first>
<action>
In the device-key registration endpoint (e.g., POST /api/device-keys or wherever `synapsesync init` issues a key):

1. Accept a new optional body field `machine_id: string` (UUID).
2. If `machine_id` is provided:
   a. Look up an existing row matching `(user_id, machine_id)`. If found, return its api_key (don't create duplicate). 200 OK with the existing key.
   b. If not found, count current device keys for the user. If at cap (`getDeviceCapForTier(tier)`), return 402:
   ```json
   {
     "error": "Device limit reached. Sign out a device to register a new one.",
     "code": "DEVICE_CAP_EXCEEDED",
     "devices": [
       {"id": "<uuid>", "hostname": "<...>", "last_seen_at": "<iso>", "registered_at": "<iso>"}
     ]
   }
   ```
   c. Otherwise insert with the machine_id.
3. If `machine_id` is NOT provided (legacy CLI): existing behavior, log a warning.

Also: ensure the `last_seen_at` column exists on device_keys (used in the picker payload). If not, add it via the migration in 03-05-A.

DELETE /api/device-keys/:id already exists (used by sign-out). Confirm it works; add it if missing.
</action>
<acceptance_criteria>
  - Endpoint accepts machine_id and returns existing key on match
  - 402 + DEVICE_CAP_EXCEEDED + devices list at cap
  - Endpoint never creates duplicate (user_id, machine_id) pairs (verified by unique index from migration 025)
  - `npm run test --workspace=backend -- device-keys` exits 0
</acceptance_criteria>
</task>

<task id="03-05-D" type="execute">
<title>CLI init.ts — pass machine_id, handle 402 picker</title>
<read_first>
  - mcp/src/cli/init.ts (existing init flow)
  - mcp/src/cli/device-id.ts (from 03-05-B)
</read_first>
<action>
In `mcp/src/cli/init.ts`:

1. Import `getOrCreateMachineId` from `./device-id.js` and call it to generate/read the UUID before the device-key registration POST.
2. Include `machine_id: <uuid>` in the POST body.
3. Handle the 402 response: parse `response.devices` and present an arrow-key selector. Use a minimal prompt (could be `readline` + manual cursor handling, or pull in an `inquirer`-style dep if one is already in mcp/ — DON'T add a new dep just for this without checking).
4. Display:
   ```
   You have 3/3 devices on Free. Sign out one to register this device:
     1. Tanmai's MacBook Pro (registered 2026-04-12, last seen 2 hours ago)
     2. work-laptop (registered 2026-05-01, last seen 3 days ago)
     3. dev-vm (registered 2026-05-18, last seen 12 days ago)
   [Enter number 1-3, or 'c' to cancel]
   ```
5. On user selection: `DELETE /api/device-keys/<id>` → retry the original POST.
6. On cancel: exit with code 1 and message "No device registered. Run synapsesync init again to retry."

KEEP this code path simple — no fancy TUI library. Print + readline is sufficient.
</action>
<acceptance_criteria>
  - `grep -c "getOrCreateMachineId" mcp/src/cli/init.ts` returns 1
  - `grep -c "DEVICE_CAP_EXCEEDED" mcp/src/cli/init.ts` returns 1
  - Manual test: with a Free account at 3 devices, run `synapsesync init` from a 4th machine → picker appears, selection works, init completes
  - Cancel path: pressing 'c' exits with code 1 + helpful message
</acceptance_criteria>
</task>

<task id="03-05-E" type="execute">
<title>synapsesync sync command (streaming progress)</title>
<read_first>
  - mcp/src/cli/smoke.ts (streaming-progress pattern — SmokeStep shape)
  - mcp/src/cli/commands.ts (where commands are registered)
  - mcp/src/capture/handoff-sync.ts (runFlushCycle, runPullCycle — reusable)
</read_first>
<action>
Create `mcp/src/cli/sync.ts`:

```typescript
import { runFlushCycle, runPullCycle } from "../capture/handoff-sync.js";
import { readApiKey, readApiUrl } from "./config.js";  // or wherever these live
import { readEvents } from "../capture/events-log.js";
import { projectDir } from "../capture/handoff-paths.js";
import { readProjectMap } from "./project-map.js";

interface SyncStep {
  step: number;
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs?: number;
}

async function run(): Promise<{ ok: boolean; steps: SyncStep[] }> {
  const steps: SyncStep[] = [];
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error("✗ No API key found. Run `synapsesync init` first.");
    return { ok: false, steps };
  }
  const apiUrl = readApiUrl();

  // Step 1: read local event queue
  process.stdout.write("▶ Reading local event queue... ");
  const start1 = Date.now();
  const projects = Object.values(readProjectMap()).map((p) => p.project_id);
  let totalEvents = 0;
  for (const projectId of projects) {
    totalEvents += readEvents(projectDir(projectId)).length;
  }
  console.log(`${totalEvents} events pending`);
  steps.push({ step: 1, name: "read-queue", ok: true, detail: `${totalEvents} events`, elapsedMs: Date.now() - start1 });

  // Step 2: push events
  process.stdout.write("▶ Pushing events to backend... ");
  const start2 = Date.now();
  let pushed = 0;
  for (const projectId of projects) {
    try {
      const r = await runFlushCycle({ project_id: projectId, api_key: apiKey, api_url: apiUrl });
      pushed += r.flushed;
    } catch (e) {
      steps.push({ step: 2, name: "push", ok: false, detail: e instanceof Error ? e.message : String(e), elapsedMs: Date.now() - start2 });
    }
  }
  console.log(`done (${pushed} events)`);
  steps.push({ step: 2, name: "push", ok: true, detail: `${pushed} events`, elapsedMs: Date.now() - start2 });

  // Step 3: pull handoff
  process.stdout.write("▶ Pulling handoff... ");
  const start3 = Date.now();
  let pulled = 0;
  for (const projectId of projects) {
    try {
      await runPullCycle({ project_id: projectId, api_key: apiKey, api_url: apiUrl });
      pulled++;
    } catch {}  // best-effort
  }
  console.log(`done (${pulled} project(s))`);
  steps.push({ step: 3, name: "pull-handoff", ok: true, detail: `${pulled} projects`, elapsedMs: Date.now() - start3 });

  // Final
  const totalMs = steps.reduce((s, x) => s + (x.elapsedMs ?? 0), 0);
  const okOverall = steps.every((s) => s.ok);
  if (okOverall) {
    console.log(`✓ Synced in ${(totalMs / 1000).toFixed(1)}s`);
  } else {
    console.log(`✗ Sync completed with errors (${steps.filter((s) => !s.ok).length} step(s) failed)`);
  }
  return { ok: okOverall, steps };
}

export async function runSyncCommand(): Promise<number> {
  const r = await run();
  return r.ok ? 0 : 1;
}
```

Register in `mcp/src/cli/commands.ts`:
```typescript
case "sync":
  return await (await import("./sync.js")).runSyncCommand();
```
</action>
<acceptance_criteria>
  - File `mcp/src/cli/sync.ts` exists
  - `mcp/src/cli/commands.ts` has a `sync` case
  - Manual: run `synapsesync sync` → prints the 3-step progress + summary, exits 0
  - Failure: kill the network mid-sync → relevant step prints error, final summary shows "✗ Sync completed with errors", exit code 1
  - `npm run typecheck --workspace=mcp` exits 0
</acceptance_criteria>
</task>

<task id="03-05-F" type="execute">
<title>Daemon tier-gate + tier_revision piggyback</title>
<read_first>
  - mcp/src/capture/daemon.ts (cycle function at line 245)
  - mcp/src/capture/handoff-sync.ts (runFlushCycle, runPullCycle — fetch response handling)
  - backend/src/index.ts (response middleware for tier_revision injection)
</read_first>
<action>
TWO SIDES:

**Backend** — inject `tier_revision` (timestamp of last subscription change) into a common response field. Pick a path:
- Option (preferred): Hono middleware that runs on all authenticated routes, fetches the user's subscription updated_at, and attaches it as `X-Synapse-Tier-Revision` header.
- Option (lighter): only inject on the daemon-relevant endpoints (`/api/events/batch`, `/api/conversations/...`).

**Daemon** — `mcp/src/capture/daemon.ts`:
```typescript
// Module-level tier cache
let cachedTier: { tier: "free" | "plus"; fetchedAt: number; revision?: string } | null = null;
const TIER_CACHE_TTL_MS = 5 * 60 * 1000;
let tierInvalidated = false;

async function getTierForCycle(apiKey: string, apiUrl: string): Promise<"free" | "plus"> {
  const now = Date.now();
  if (
    cachedTier &&
    !tierInvalidated &&
    now - cachedTier.fetchedAt < TIER_CACHE_TTL_MS
  ) {
    return cachedTier.tier;
  }
  try {
    const r = await fetch(`${apiUrl}/api/account/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) return cachedTier?.tier ?? "free";
    const body = (await r.json()) as { tier?: string };
    const tier = body.tier === "plus" ? "plus" : "free";
    cachedTier = { tier, fetchedAt: now };
    tierInvalidated = false;
    return tier;
  } catch {
    return cachedTier?.tier ?? "free";
  }
}

// At top of cycle():
const tier = await getTierForCycle(a.api_key, a.api_url);
if (tier === "free") return true;  // skip cycle entirely
```

Update `runFlushCycle` (and other daemon fetch wrappers in handoff-sync.ts) to read the `X-Synapse-Tier-Revision` header. If revision changes vs cached, set `tierInvalidated = true` (export the flag setter from daemon.ts).

Test the tier flip:
- E2E phase: while daemon running with Free, flip account to Plus (via test webhook or direct DB update), wait <30s, observe daemon cycle resumes (events flushing).
</action>
<acceptance_criteria>
  - `grep -c "getTierForCycle\|tierInvalidated" mcp/src/capture/daemon.ts` returns ≥ 2
  - Backend response middleware sets X-Synapse-Tier-Revision on at least the daemon's relevant endpoints
  - Daemon reads the header from runFlushCycle's response and invalidates cache on change
  - Cycle skips when tier is free
  - `npm run typecheck` (both workspaces) exits 0
</acceptance_criteria>
</task>

<task id="03-05-G" type="execute">
<title>Frontend: settings/devices page</title>
<read_first>
  - frontend/src/routes/(app)/settings (existing settings routes)
  - frontend/src/lib/components (existing card/list components)
  - backend/src/api/device-keys.ts (after 03-05-C)
</read_first>
<action>
Create `frontend/src/routes/(app)/settings/devices/+page.svelte` + `+page.server.ts`:

- Server load: `GET /api/device-keys` for the authed user, return the list.
- Page: render each device as a card with:
  - Hostname (editable inline; PATCH /api/device-keys/:id updates display name)
  - Registered date, last seen
  - "Sign out" button → DELETE /api/device-keys/:id with confirmation
- Header: "Devices (3/3)" with the cap visible.
- At cap: subtle banner "You're at your device limit. Sign out one to register another."

Use existing card / button / muted-text styles. Don't introduce new visual primitives.
</action>
<acceptance_criteria>
  - Routes exist; page renders the device list
  - Sign-out button works (DELETE call + page reload)
  - Hostname rename works
  - At cap, banner visible
  - `npm run typecheck --workspace=frontend` exits 0
</acceptance_criteria>
</task>

<task id="03-05-H" type="execute">
<title>E2E: device cap + manual sync</title>
<read_first>
  - scripts/e2e-smoke.mjs (E2E pattern)
</read_first>
<action>
Create two E2E scripts:

**scripts/e2e-device-cap.mjs:**
1. Free test user. Cleanup: delete all existing device keys.
2. Register devices 1-3 with machine_ids A, B, C. All succeed.
3. Register device 4 with machine_id D. Assert 402 + DEVICE_CAP_EXCEEDED + devices list contains A, B, C.
4. RE-register device with machine_id A (no change). Assert: returns existing key (no duplicate row), 200 OK.
5. DELETE device A. Register device with machine_id D. Assert 201 (cap freed).
6. Cleanup: delete all test device keys.

**scripts/e2e-manual-sync.mjs:**
1. Free test user with daemon running locally.
2. Generate some local events (e.g., POST a synthetic event via the existing event-log helper).
3. Wait 30s. Observe daemon DID NOT push (events still queued locally — verify via reading the local event-log file).
4. Run `node mcp/dist/cli/sync.js` (or equivalent CLI invocation). Assert: events queue drains; pull-handoff cache updates; exit 0.
5. Tier-flip test: upgrade account to Plus (via test webhook or fake DB update). Wait <30s. Generate more events. Observe daemon now pushes them automatically (no manual sync needed).
6. Cleanup: revert account to Free, delete test events.

Exit 0 on full pass, 1 on any phase fail.
</action>
<acceptance_criteria>
  - Both E2E scripts exist and pass
  - Bug-class assertions: cap-frees-on-delete, re-init-no-duplicate, tier-flip-within-30s
  - Self-cleaning
</acceptance_criteria>
</task>

</tasks>

<verification>
After all sub-tasks:
1. `npm run lint && npm run typecheck && npm run test` exit 0
2. `node scripts/e2e-device-cap.mjs` passes
3. `node scripts/e2e-manual-sync.mjs` passes
4. Manual: full new-machine `synapsesync init` flow with picker UX
5. Migration 025 applied to Supabase
</verification>
