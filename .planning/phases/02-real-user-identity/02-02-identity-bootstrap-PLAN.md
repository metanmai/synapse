---
phase: 02-real-user-identity
plan: 2
type: execute
wave: 2
depends_on: ["02-01"]
files_modified:
  - backend/src/api/auth.ts
  - mcp/src/capture/identity.ts
  - mcp/src/cli/api.ts
  - mcp/src/cli/init.ts
  - mcp/src/cli/handlers.ts
  - mcp/src/cli/run-daemon.ts
  - mcp/src/cli/hook-dispatch.ts
autonomous: true
requirements: [IDENT-01]
threat_refs: [T-02-04, T-02-05]

must_haves:
  truths:
    - "Authenticated users can fetch their {user_id, email, tier} via GET /api/account/me"
    - "synapse init persists the real user_id and email into ~/.synapse/config.json"
    - "synapse init fails-fast (no disk writes) when /me fetch fails (D-05)"
    - "Daemon hooks emit events carrying the real user UUID (env var still wins as tier-2 override)"
    - "The single readUserIdFromConfig helper is the only reader across handlers, run-daemon, hook-dispatch"
    - "No regression in backend events-batch.ts:60 actor_user_id override — production rows are still correct regardless of payload"
  artifacts:
    - path: "backend/src/api/auth.ts"
      provides: "GET /api/account/me route inside account sub-app"
      contains: "account.get(\"/me\""
    - path: "mcp/src/capture/identity.ts"
      provides: "Shared readUserIdFromConfig helper for all daemon-side consumers"
      contains: "export function readUserIdFromConfig"
    - path: "mcp/src/cli/api.ts"
      provides: "fetchMe(apiKey) HTTP client with fail-fast error messages"
      contains: "export async function fetchMe"
    - path: "mcp/src/cli/init.ts"
      provides: "runInit calls fetchMe FIRST, writeConfig persists user_id + email"
      contains: "fetchMe"
    - path: "mcp/src/cli/hook-dispatch.ts"
      provides: "Hook payload carries real user_id (env > config > placeholder)"
      contains: "readUserIdFromConfig"
  key_links:
    - from: "mcp/src/cli/init.ts:runInit"
      to: "mcp/src/cli/api.ts:fetchMe"
      via: "first call before any disk write"
      pattern: "fetchMe\\(a\\.api_key\\)"
    - from: "mcp/src/cli/hook-dispatch.ts:readHookPayloadFromStdin"
      to: "mcp/src/capture/identity.ts:readUserIdFromConfig"
      via: "import from ../capture/identity.js"
      pattern: "readUserIdFromConfig"
    - from: "mcp/src/cli/handlers.ts"
      to: "mcp/src/capture/identity.ts:readUserIdFromConfig"
      via: "import — old inline copy removed"
      pattern: "import.*readUserIdFromConfig.*identity"
    - from: "backend/src/api/auth.ts:account.get(\"/me\")"
      to: "c.var.user (UserRow from public.users)"
      via: "authMiddleware sets c.var.user, c.var.tier"
      pattern: "c\\.get\\(\"user\"\\)"
---

<objective>
Implement Slice A — Identity bootstrap. Locked decisions: D-01 (init persists user_id from /me), D-02 (new GET /api/account/me route), D-03 (hook-dispatch reads user_id from config), D-04 (no backfill of existing "default" rows — relies on backend events-batch.ts:60 override), D-05 (fail-fast on /me failure — no half-config writes).

After this plan ships, events written by an authenticated daemon carry the real UUID end-to-end. The backend's existing `actor_user_id: user.id` override at `backend/src/api/events-batch.ts:60` continues to act as the server-side guard (D-04 — no backfill needed). The local daemon-emitted rows now ALSO carry the real UUID at write-time, closing the IDENT-01 contract.

Purpose: complete IDENT-01 — events carry the authenticated `actor.user_id` (the user's `public.users` UUID), no `"default"` rows after this lands.

Output: 1 NEW file (`mcp/src/capture/identity.ts`), 6 EXTENDED files (`backend/src/api/auth.ts` adds /me route; `mcp/src/cli/api.ts` adds fetchMe; `mcp/src/cli/init.ts` adds fetchMe-first ordering + extended writeConfig; `mcp/src/cli/handlers.ts` + `mcp/src/cli/run-daemon.ts` replace inline duplicates with import; `mcp/src/cli/hook-dispatch.ts` reads user_id from config via the new helper).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/02-real-user-identity/02-CONTEXT.md
@.planning/phases/02-real-user-identity/02-RESEARCH.md
@.planning/phases/02-real-user-identity/02-PATTERNS.md
@.planning/phases/02-real-user-identity/02-VALIDATION.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/INTEGRATIONS.md
@backend/src/api/auth.ts
@backend/src/lib/auth.ts
@mcp/src/cli/init.ts
@mcp/src/cli/api.ts
@mcp/src/cli/hook-dispatch.ts
@mcp/src/cli/handlers.ts
@mcp/src/cli/run-daemon.ts
@mcp/src/capture/handoff-paths.ts

<interfaces>
<!-- Key contracts from auth middleware + existing /keys route. Executor uses these directly. -->

From backend/src/lib/auth.ts (auth middleware contract):
- `c.var.user`: UserRow from public.users (has id, email, supabase_auth_id)
- `c.var.tier`: "free" | "plus" (set at lines 89-91)
- `c.var.db`: SupabaseClient (service-role)

Existing single-purpose pattern (backend/src/api/auth.ts:469-475):
```typescript
account.get("/keys", async (c) => {
  const user = c.get("user");
  const db = c.get("db");
  const keys = await listApiKeys(db, user.id);
  return c.json(keys);
});
```

Existing fetcher pattern (mcp/src/cli/api.ts:11-28):
```typescript
export async function validateApiKey(apiKey: string): Promise<{ status: KeyStatus }> {
  try {
    const res = await fetch(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    // ... returns status union ...
  } catch { return { status: "unknown" }; }
}
```

Existing readUserIdFromConfig (mcp/src/cli/handlers.ts:90-103) — to be EXTRACTED into mcp/src/capture/identity.ts:
```typescript
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
  } catch { return "local-user"; }
}
```

Existing writeConfig signature (mcp/src/cli/init.ts:186-196):
```typescript
function writeConfig(api_key: string): void { /* writes {api_key} only */ }
// Plan extends to:
function writeConfig(api_key: string, identity: MeResponse): void {
  /* preserves existing fields; adds user_id + email */
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Backend — add GET /api/account/me route (D-02)</name>
  <files>backend/src/api/auth.ts</files>
  <read_first>
    - backend/src/api/auth.ts (full file — confirm `account` sub-app mount at lines 432-434 + authMiddleware; reference `account.get("/keys", ...)` pattern at lines 469-475 and `account.post("/reset", ...)` at lines 519-536)
    - backend/src/lib/auth.ts (lines 31-94 — confirm c.var.user is the public.users UserRow, c.var.tier is "free" | "plus")
    - backend/src/db/types.ts (UserRow shape — confirm user.id is the public.users UUID, not auth.users.id)
    - backend/test/api/auth-me.test.ts (created in Plan 01 — this is the contract this task must satisfy)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 37-77 — exact pattern for /me route)
  </read_first>
  <behavior>
    - GET /api/account/me with valid api_key Bearer → 200 + JSON {user_id, email, tier}
    - user_id MUST equal c.var.user.id (the public.users.id from authMiddleware)
    - email MUST equal c.var.user.email
    - tier MUST equal c.var.tier ("free" | "plus")
    - GET /api/account/me without Authorization → 401 (from authMiddleware automatically)
    - GET /api/account/me with invalid Bearer → 401 (from authMiddleware automatically)
    - Route MUST be mounted inside the existing `account` Hono sub-app so it inherits authMiddleware + rateLimit
  </behavior>
  <action>
    Add `account.get("/me", async (c) => { ... })` to `backend/src/api/auth.ts` inside the existing `account` sub-app (after the `/keys` route at line 475 is a natural place; before the `/reset` route at line 519). The route is ~7 lines: read `user` and `tier` via `c.get(...)`, return `c.json({ user_id: user.id, email: user.email, tier })`. NO request body parsing. NO new imports. NO new error envelope — authMiddleware already throws UnauthorizedError on bad/missing auth; global onError at backend/src/index.ts:51-65 handles the rest. Per PATTERNS.md line 65-73 for exact shape. Per RESEARCH.md Pitfall 6 (lines 488-492) — verify user.id is the public.users.id, NOT auth.users.id (it is, because authMiddleware joins via supabase_auth_id at backend/src/lib/auth.ts:75-88). Do NOT add `c.var.user.supabase_auth_id` to the response — only the three fields above. Avoid logging user_id or email at info level per RESEARCH security V8 (line 938-939).
  </action>
  <verify>
    <automated>cd backend && npx vitest run test/api/auth-me.test.ts 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'account.get("/me"' backend/src/api/auth.ts` returns at least one match
    - `grep -nc 'user_id: user.id' backend/src/api/auth.ts` is ≥ 1 (Plan 01's auth-me.test.ts unauth tests now PASS; route-registered test PASSES)
    - The 401-on-unauth tests in `backend/test/api/auth-me.test.ts` PASS
    - The route-registered (not-404) test in auth-me.test.ts PASSES (with `Authorization: Bearer x` — even invalid token gets 401 not 404)
    - `cd backend && npm run lint && cd backend && npm run typecheck` — both pass
    - Verify the response shape via the existing /me test or a manual curl (when deployed): `curl -H "Authorization: Bearer <valid-key>" https://api.synapsesync.app/api/account/me` returns `{"user_id":"...","email":"...","tier":"free|plus"}` — see manual gate in 02-VALIDATION.md
  </acceptance_criteria>
  <done>auth.ts contains the new /me route inside the `account` sub-app; auth-me.test.ts structural tests turn GREEN; lint + typecheck pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MCP — extract identity helper + add fetchMe HTTP client + extend init runInit ordering & writeConfig</name>
  <files>mcp/src/capture/identity.ts, mcp/src/cli/api.ts, mcp/src/cli/init.ts, mcp/src/cli/handlers.ts, mcp/src/cli/run-daemon.ts</files>
  <read_first>
    - mcp/src/capture/handoff-paths.ts (full file — confirm synapseRoot() export, exact return path)
    - mcp/src/cli/handlers.ts (lines 90-103 — the existing readUserIdFromConfig source; lines 105-111 — handlerContext that calls it)
    - mcp/src/cli/run-daemon.ts (lines 29-54 — current inline config read for user_id; replace just the user_id branch, keep api_key inline)
    - mcp/src/cli/api.ts (full file, 47 LOC — validateApiKey analog at lines 11-28; AbortSignal.timeout pattern; type AuthResult)
    - mcp/src/cli/init.ts (lines 59-89 — current runInit ordering; lines 182-196 — current writeConfig)
    - mcp/src/cli/wizard.ts (lines 31-189 — wizard's call to runInit; confirm `await runInit({ api_key })` and the existing try/catch pattern that exits on error)
    - mcp/test/cli/init.test.ts (RED tests from Plan 01 — fetchMe-first ordering + persist user_id contract)
    - mcp/test/cli/hook-dispatch.test.ts (RED tests from Plan 01 — env > config > placeholder fallback)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 82-353 — full specs for identity.ts extraction, fetchMe shape, init ordering, writeConfig signature change, handlers.ts + run-daemon.ts cleanups, hook-dispatch.ts extension)
    - .planning/phases/02-real-user-identity/02-RESEARCH.md (lines 522-558 — fetchMe exact error messages; Pitfall 1 lines 458-462 — fetchMe-first ordering rationale)
  </read_first>
  <behavior>
    mcp/src/capture/identity.ts (NEW):
    - Export `readUserIdFromConfig(): string` that reads `synapseRoot() + "/config.json"`, returns `c.user_id ?? c.email ?? "local-user"` per the existing handlers.ts pattern
    - No module-level caching (read fresh every call — per RESEARCH anti-pattern line 418)
    - Throws caught → return "local-user" fallback

    mcp/src/cli/api.ts (EXTEND — add fetchMe):
    - Export type `MeResponse = { user_id: string; email: string; tier?: "free" | "plus" }`
    - Export `async function fetchMe(apiKey: string): Promise<MeResponse>` — calls GET /api/account/me with Bearer header, 10000ms timeout
    - On network error / abort: throws Error with "Could not reach ... Check your network — if you're on a proxy (Netskope, corporate firewall), tether to a different network and retry."
    - On 401: throws Error with "API key rejected by server (401). Run 'synapse login' or paste a fresh key from synapsesync.app."
    - On other non-2xx: throws Error with status text + status code + " — cannot proceed."
    - On invalid response shape (missing user_id or email): throws Error with received JSON
    - On 2xx with valid shape: returns the parsed MeResponse

    mcp/src/cli/init.ts (EXTEND):
    - import { fetchMe, type MeResponse } from "./api.js"
    - runInit calls `await fetchMe(a.api_key)` FIRST — before installHooks/installSlashCommands/writeConfig/writeMcpJson/writeServiceFile. If fetchMe throws, runInit re-throws and the wizard's existing try/catch + process.exit(1) handles user-facing display.
    - writeConfig signature becomes `writeConfig(api_key: string, identity: MeResponse): void` — sets api_key, user_id, email on the SynapseConfig object; preserves existing fields per the idempotence contract (init.ts:189 spread)
    - SynapseConfig interface extends to include `user_id?: string; email?: string;`

    mcp/src/cli/handlers.ts (EXTEND):
    - Replace the inline readUserIdFromConfig (lines 90-103) with `import { readUserIdFromConfig } from "../capture/identity.js"`
    - DELETE the inline function definition
    - handlerContext() at lines 105-111 unchanged (still calls readUserIdFromConfig; just imports it now)

    mcp/src/cli/run-daemon.ts (EXTEND):
    - import { readUserIdFromConfig } from "../capture/identity.js"
    - Keep the existing inline read of api_key (it's a different concern from user_id)
    - Pass `user_id: readUserIdFromConfig()` to startHandoffLoop (was reading config.user_id which may be undefined)
  </behavior>
  <action>
    Five-file change, all coordinated:

    1. CREATE `mcp/src/capture/identity.ts` per PATTERNS.md lines 87-127. Use the `synapseRoot()` import from `./handoff-paths.js`. The function shape mirrors handlers.ts:90-103 verbatim with `.js` imports (Node16 module resolution).

    2. EXTEND `mcp/src/cli/api.ts` per PATTERNS.md lines 228-260. Add `interface MeResponse` and `async function fetchMe`. Use the exact error message strings from RESEARCH.md lines 540-557 — they are user-facing copy locked by the Netskope-proxy context. Use `AbortSignal.timeout(10000)` (10s — longer than validateApiKey's 5s because init is interactive and Netskope-proxy first-connect can take longer).

    3. EXTEND `mcp/src/cli/init.ts` per PATTERNS.md lines 281-354. Add `import { fetchMe, type MeResponse } from "./api.js"`. Reorder runInit so fetchMe runs FIRST. Change writeConfig signature to take `identity: MeResponse`. The existing wizard.ts call site `await runInit({ api_key })` does NOT need modification because the wizard's existing try/catch + `clack.log.error((err as Error).message); process.exit(1);` pattern (wizard.ts:170-174) already handles thrown errors.

    4. EXTEND `mcp/src/cli/handlers.ts` per PATTERNS.md lines 137-149. Add the import at the top, DELETE lines 90-103 (the inline function), leave the call site at line 105-111 alone.

    5. EXTEND `mcp/src/cli/run-daemon.ts` per PATTERNS.md lines 158-184. Add the import; replace `config.user_id` with `readUserIdFromConfig()` at the startHandoffLoop call. Keep the api_key read inline (different concern).

    All `.js` extensions on relative imports (per CONVENTIONS.md MCP workspace rules). No module-level caching of config reads (per RESEARCH.md anti-pattern line 418-419). Per `feedback_no_other_users.md` (clean slate, no backwards-compat): do NOT preserve a special-case for `"default"` — the new placeholder is `"local-user"` from readUserIdFromConfig, which is acceptable per Pitfall 9 (line 514-518) because backend events-batch.ts:60 overrides anyway.
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/init.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - File `mcp/src/capture/identity.ts` exists and exports `readUserIdFromConfig`: `grep -c "export function readUserIdFromConfig" mcp/src/capture/identity.ts` ≥ 1
    - File `mcp/src/cli/api.ts` contains `export async function fetchMe` and `export interface MeResponse`: `grep -c "fetchMe\|MeResponse" mcp/src/cli/api.ts` ≥ 2
    - File `mcp/src/cli/init.ts` contains `await fetchMe(` BEFORE any installHooks/installSlashCommands/writeConfig call — verify ordering by line numbers: `grep -n "fetchMe\|installHooks\|writeConfig" mcp/src/cli/init.ts` shows fetchMe line < installHooks line < writeConfig line within the runInit function body
    - File `mcp/src/cli/handlers.ts` no longer contains a local `function readUserIdFromConfig(` definition: `grep -v "^import" mcp/src/cli/handlers.ts | grep -c "function readUserIdFromConfig"` == 0
    - File `mcp/src/cli/handlers.ts` imports the helper: `grep -c "from \"../capture/identity" mcp/src/cli/handlers.ts` ≥ 1
    - File `mcp/src/cli/run-daemon.ts` imports the helper: `grep -c "from \"../capture/identity" mcp/src/cli/run-daemon.ts` ≥ 1
    - All Plan-01 RED cases in `mcp/test/cli/init.test.ts` flip to GREEN — specifically: "runInit calls fetchMe BEFORE any disk write" PASSES (mock fetchMe rejects, assert no config.json), "writeConfig persists user_id + email" PASSES (mock fetchMe resolves with shape, assert config has user_id + email)
    - `cd mcp && npm run lint && cd mcp && npm run typecheck` — both pass
    - `cd mcp && npm test` — passes (existing tests + Plan-01 init tests now green)
  </acceptance_criteria>
  <done>5 files modified consistently; identity.ts is the single source of readUserIdFromConfig across handlers/run-daemon/hook-dispatch; runInit fail-fasts on /me failure; writeConfig persists user_id + email; Plan-01 init tests flip GREEN.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: MCP — hook-dispatch reads user_id from config (D-03)</name>
  <files>mcp/src/cli/hook-dispatch.ts</files>
  <read_first>
    - mcp/src/cli/hook-dispatch.ts (full file — confirm current state at line 59 where `process.env.SYNAPSE_USER_ID ?? "default"` lives; lines 48-69 for the full readHookPayloadFromStdin function)
    - mcp/src/capture/identity.ts (created in Task 2 — confirm export signature)
    - mcp/test/cli/hook-dispatch.test.ts (extended in Plan 01 — confirm the 4 RED contract cases: env wins, config fallback, placeholder fallback, hashCwd regression)
    - .planning/phases/02-real-user-identity/02-PATTERNS.md (lines 357-457 — exact extension shape; lines 442-456 — final readHookPayloadFromStdin form)
    - .planning/phases/02-real-user-identity/02-CONTEXT.md (D-03 — env var stays as tier-2 fallback)
  </read_first>
  <behavior>
    - Hook payload's `user_id` field is sourced via `process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig()` — env wins
    - Old `"default"` literal at line 59 is removed
    - hashCwd determinism is preserved (regression guard from Plan-01 test passes)
    - When neither env nor config has a value, falls back to readUserIdFromConfig's own placeholder ("local-user")
    - DO NOT add git_remote_url capture here — that lands in Plan 04 (Slice B)
  </behavior>
  <action>
    Single-file change at `mcp/src/cli/hook-dispatch.ts`. Per PATTERNS.md lines 362-365 (the import) and lines 436-456 (the body). Add `import { readUserIdFromConfig } from "../capture/identity.js";` near the top alongside existing imports. Replace the literal at line 59 (`process.env.SYNAPSE_USER_ID ?? "default"`) with `process.env.SYNAPSE_USER_ID ?? readUserIdFromConfig()`. This is a one-line change in readHookPayloadFromStdin. NO git_remote_url addition (that's deliberately deferred to Plan 04 because plan-A and plan-B must not share file edits within the same wave — and they don't because A is Wave 2 and B is Wave 3, where Wave 3 builds on this).
  </action>
  <verify>
    <automated>cd mcp && npx vitest run test/cli/hook-dispatch.test.ts 2>&1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "process.env.SYNAPSE_USER_ID ?? \"default\"" mcp/src/cli/hook-dispatch.ts` returns 0 matches (the literal is gone)
    - `grep -n "readUserIdFromConfig()" mcp/src/cli/hook-dispatch.ts` returns at least 1 match
    - `grep -n "from \"../capture/identity" mcp/src/cli/hook-dispatch.ts` returns at least 1 match (the import)
    - Plan-01 RED cases in `mcp/test/cli/hook-dispatch.test.ts` flip GREEN: env wins, config fallback, placeholder fallback
    - hashCwd determinism test (existing) still PASSES
    - `cd mcp && npm run lint && cd mcp && npm run typecheck && cd mcp && npm test` — all pass
    - File DOES NOT yet capture git_remote_url (that's Plan 04): `grep -c "getGitRemoteUrl\|git_remote_url" mcp/src/cli/hook-dispatch.ts` == 0
  </acceptance_criteria>
  <done>hook-dispatch.ts uses the shared identity helper; the placeholder fallback chain is env > config > "local-user"; Plan-01 hook-dispatch tests flip GREEN; hashCwd regression guard still passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI → backend /me | User's api_key crosses HTTPS; auth-middleware validates |
| Daemon hook → events.jsonl | Local-only write; no network |
| Daemon flush → /api/events/batch | Backend overrides actor_user_id (events-batch.ts:60) regardless of payload |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04 | Denial of Service | New /me route accessible to authenticated users | mitigate | The existing global rate limit at backend/src/index.ts:46 (`app.use("*", rateLimit(...))`) covers /me automatically — no per-route bypass. /me is a single SELECT against c.var.user (already in-memory) — sub-ms response. Cannot be used to amplify load. |
| T-02-05 | Information Disclosure | ~/.synapse/config.json now contains user_id + email in addition to api_key | mitigate | config.json is gitignored (existing, verified in mcp/src/cli/init.ts editorIo path) and lives in synapseRoot() which is per-user ($HOME/.synapse). Init flow does NOT log user_id or email (verified by reading current init.ts — no console.log of either). Adding these fields does not change the file's sensitivity classification — api_key was already there. |
| T-02-PII | Information Disclosure | /me response leaks user identity over the wire | accept | The response is over HTTPS to api.synapsesync.app (existing). The user is authenticated; revealing their own id + email to themselves is the contract. Cross-user leak is impossible because user is scoped via authMiddleware. |
</threat_model>

<verification>
- `cd backend && npx vitest run test/api/auth-me.test.ts` — all structural tests GREEN (3 it() PASS, the .skip live-DB case stays skipped)
- `cd mcp && npx vitest run test/cli/init.test.ts test/cli/hook-dispatch.test.ts` — Plan-01 RED cases flip GREEN
- `cd backend && npm run lint && npm run typecheck && npm test` — passes
- `cd mcp && npm run lint && npm run typecheck && npm test` — passes
- Manual gate (deferred to verify-work): deploy backend to prod via wrangler from a CF-enabled machine, then `curl -H "Authorization: Bearer <real-key>" https://api.synapsesync.app/api/account/me` returns `{user_id, email, tier}` with user_id matching the user's row in public.users (not auth.users.id) — per RESEARCH.md Pitfall 6
- Manual gate: run `synapse init --api-key <valid-key>` locally with a real key — verify `~/.synapse/config.json` now contains `user_id` and `email` alongside `api_key`
</verification>

<success_criteria>
- IDENT-01 acceptance criterion satisfied for daemon-emitted events: "events flushed by the daemon for an authenticated user have `actor_user_id` equal to that user's UUID in `handoff_events`"
- All Plan-01 RED test cases for `mcp/test/cli/init.test.ts` and `mcp/test/cli/hook-dispatch.test.ts` and `backend/test/api/auth-me.test.ts` flip GREEN
- `backend/src/api/events-batch.ts:60` `actor_user_id: user.id` override line is UNCHANGED (regression guard — per RESEARCH Pitfall 9)
- `mcp/src/capture/identity.ts` is the single source of `readUserIdFromConfig` — `handlers.ts:90-103` inline copy is gone, `run-daemon.ts` uses the import
- runInit fails fast on /me failure — no half-written config.json after a thrown fetchMe
- writeConfig persists `user_id` and `email` to ~/.synapse/config.json while preserving existing fields
</success_criteria>

<output>
Create `.planning/phases/02-real-user-identity/02-02-SUMMARY.md` when done. Summary must:
- Confirm /me route lives in `backend/src/api/auth.ts` inside the `account` sub-app
- Confirm `mcp/src/capture/identity.ts` is the single source of readUserIdFromConfig (handlers.ts and run-daemon.ts both import it; no inline duplicates remain)
- Confirm fetchMe lives in `mcp/src/cli/api.ts` with the locked error messages
- Confirm runInit ordering: fetchMe FIRST, then disk writes
- Confirm hook-dispatch.ts uses the shared helper
- List which Plan-01 RED cases flipped GREEN (auth-me structural + init fail-fast + hook-dispatch env-precedence)
- Note that git_remote_url capture in hook-dispatch is DEFERRED to Plan 04 (Slice B)
- Flag the manual gates that must run on a CF-enabled machine after this lands (curl /me on prod after deploy; synapse init with real key)
</output>
