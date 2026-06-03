# Known Bugs and Follow-ups

This file is the canonical "what's still broken" list for the project. It's tracked here (rather than as GitHub issues) because the repo lives on two remotes — `tanmain/synapse` (primary, where work happens) and `metanmai/synapse` (where CI runs, kept in sync by a bot) — and a markdown file in the repo gets mirrored automatically. Issues filed on one side wouldn't be visible from the other.

When closing an entry, move it to the `## Closed` section at the bottom with the commit SHA that fixed it. Keep the close note in case the bug returns later — the original symptoms + diagnostic notes are useful for "didn't we see this before?" moments.

---

## P0 — Blocks core feature

### 1. Backend `/api/events/batch` throws Worker exception (Cloudflare 1101)

The daemon's flush cycle to `https://api.synapsesync.app/api/events/batch` fails with HTTP 500 and Cloudflare error code 1101 on real event payloads. Sessions are captured locally to `~/.synapse/projects/<id>/events.jsonl` but never reach the backend — the dashboard, cross-device handoff, and conversation list all stay empty until this is fixed.

**Forensic detail:** 1101 escapes Hono's `app.onError` catch boundary. Regular `throw error` paths in `events-batch.ts` (createErr at line 108, memberErr at 113, upsert error at 126) would surface as JSON 500s, not 1101. Whatever's throwing is happening somewhere `app.onError` can't reach — likely candidates:

- Unhandled rejection in `Promise.all(projectIds.map(pid => recomputeProjectStatus(db, pid)))` at `backend/src/api/events-batch.ts:132`
- CPU time limit (Workers free tier: 50ms wall-clock for the entry path)
- Subrequest count limit
- Streaming-response error after headers sent

`recomputeProjectStatus` reads ALL events for the project and calls `reduce()` from `@synapse/shared/handoff/reducer.js`. If `reduce()` throws on an unexpected payload shape (`tool_used` events with surprising fields aren't handled in the switch — they fall through silently, but downstream code that reads `slot.recent_files` or similar might break), the rejection inside a Promise.all could escape.

**No data lost meanwhile:** `events.jsonl` is append-only on the client, the `.watermark` file only advances on full-batch success, and the backend upserts on `event_id` with `ignoreDuplicates: true`. Once fixed, the next flush will catch up everything since the last successful batch.

**Diagnostic plan:**
- Live worker logs: `cd backend && wrangler tail --name synapse --format pretty`, then send one event via curl. Real stack trace will print.
- Or stand up `wrangler dev` locally with real Supabase env vars in `backend/.dev.vars` and reproduce.

**Code locations:** `backend/src/api/events-batch.ts:37-140`, `backend/src/lib/handoff-reducer.ts`, `packages/shared/src/handoff/reducer.ts`

---

## P1 — Install-time UX

### 2. `synapse capture status` reports "stopped" when daemon is running under launchd

After installing via `synapse init`, the daemon is alive under launchd (verifiable via `launchctl list app.synapsesync.daemon` showing a real PID), but `synapse capture status` shows "Daemon: stopped" with PID null. Misleading — users assume capture isn't running.

**Root cause:** `DaemonManager.isRunning()` at `mcp/src/capture/daemon.ts:40-50` only consults `~/.synapse/capture.pid`. The old wizard's fire-and-forget `spawn(capture-worker.js)` wrote this file, but that path was removed in `d3cd771`. The launchd-supervised daemon never writes `capture.pid` — it's supervised externally.

**Fix sketch:** `isRunning()` should also consult `launchctl list app.synapsesync.daemon` (macOS), `systemctl --user is-active synapsesync.service` (Linux), or a process-name check. The PID file path becomes a non-OS-service fallback.

**Code locations:** `mcp/src/capture/daemon.ts:40-50`, `mcp/src/cli/commands.ts` (`runCaptureStatus`)

### 3. Wizard writes `npx synapsesync` configs that may be blocked by corporate proxies

In `mcp/src/cli/editors/io.ts:95`, the MCP server config for Cursor / Windsurf uses `"command": "npx", "args": ["synapsesync"]`. On networks where `npx` is blocked (e.g. Netskope), the configs are written correctly but the MCP server fails to start.

**Fix sketch:** Detect if the package is globally available and prefer `synapsesync` (resolves via `/opt/homebrew/bin/synapsesync` symlink) over `npx`. Or fall back to `node <abs-path>/dist/index.js` like `synapse init` does for hooks. Or surface the workaround in the post-wizard outro.

**Code location:** `mcp/src/cli/editors/io.ts:95`

### 4. `synapse init` doesn't write `.mcp.json` for the current project

`init` installs hooks, service, slash commands, and config — but the local project's `.mcp.json` (which Claude Code reads for MCP server config) is only written by the wizard's `writeClaudeCodeLocal` adapter. A user who runs `init` directly (e.g. from `--api-key` flow or a script) gets hooks but no MCP server access in this project.

The wizard fix in `d3cd771` partially closes this — `wizard` now calls `runInit` when capture is opted in — but `init` itself remains incomplete for the "Claude Code in this project" use case.

**Fix sketch:** Add `--scope local|global` flag to `init` (or always write `.mcp.json` to cwd) so it's a complete one-shot replacement for the wizard.

**Code location:** `mcp/src/cli/init.ts`

---

## P2 — Per-device CLI keys (a8ecf98 scope completion)

### 5. 409 `DEVICE_LIMIT_REACHED` has no UI in frontend

Free-tier users at the 3-device limit get a generic 500 from the wizard's "Continue as…" button, with no path to revoke an old device.

**Backend:** returns 409 with JSON body containing the device list (id, name, last_used_at, created_at) — fully implemented at `backend/src/api/auth.ts:277-293`. Endpoint that wraps the picker action: `POST /auth/cli-revoke-and-session` (also implemented, untested in production since Plus tier doesn't trigger the picker).

**Frontend gap:** `frontend/src/routes/cli-auth/+page.server.ts` `continueAs` action treats any non-OK as `fail(500, "Failed to create CLI session")`. Needs to branch on 409, parse the device list, set form state to render a picker.

**Picker UI:** new code in `cli-auth/+page.svelte` — list devices with radio buttons, show last_used relative time, on submit call a new `revokeAndContinue` action that POSTs to `/auth/cli-revoke-and-session`.

### 6. Dashboard rename UI for `cli-*` keys not built

Account page lists keys but doesn't let users rename them. Backend endpoint exists: `PATCH /api/account/keys/:id` at `backend/src/api/auth.ts:508` (strips `cli-` prefix for display, re-adds on save). Frontend account page needs inline-edit on key labels for keys whose label starts with `cli-`.

### 7. Legacy `cli`-labeled keys never get migrated to `cli-<device>` shape

Accounts that predate the per-device feature have keys labeled just `cli` (or worse, ad-hoc names like `M4 Pro` from manual creation). They show up in the dashboard as an indistinguishable pile.

**Phase 5 of original plan:** a one-shot rename script that turns legacy `cli` labels into `cli-legacy-<created_date>` so they're identifiable. Could be a SQL migration or a self-service "clean up old keys" button in the dashboard.

---

## P3 — Repo hygiene

### 8. Unmerged `worktree-agent-*` remote branches need triage

As of 2026-05-18, 8 unmerged on the remote: `worktree-agent-{a2a33b8a, a5f2f162, a8687b78, a95cfd91, a99a87ae, ada9ffce, ae176e01, ae93c2a6}`. Each is 1-385 commits ahead of main. Likely scratch from abandoned agent runs but each contains unique commits — can't bulk-delete without losing work.

Per-branch `git log origin/main..<branch>` diff needed before deletion.

### 9. `feat/oss-readiness` branch — 242 commits ahead, unmerged, status unclear

Substantial in-flight feature. Needs human triage: still active? Abandoned? Worth resurrecting or splitting up?

### 10. No backend auto-deploy on push

Frontend auto-deploys via Vercel/Cloudflare Pages. Backend Worker requires manual `wrangler deploy` from a machine with the Cloudflare API token. main can drift from what's actually serving requests.

**Fix sketch:** GitHub Actions workflow that runs `wrangler deploy` on push to main, with CF API token in repo secrets. Already a `.github/workflows/publish.yml` for npm publishing — same pattern.

---

## P4 — Performance / correctness, no user impact yet

### 11. `recomputeProjectStatus` reads all events per batch

`backend/src/lib/handoff-reducer.ts:6-19` — on every `/api/events/batch` POST, for every distinct `project_id` in the batch, the full event history is fetched and reduced. O(events_per_project) cost per flush cycle (every 10 seconds via the daemon).

**Fix sketch:** Maintain `ProjectStatus` incrementally — apply only the new events to the existing materialized status. The reducer is structured as a left fold, so this is feasible.

---

## Closed

Fixed in the 2026-05-18 session:

- **CLI didn't pass `device_name` through OAuth-style auth URL** — fixed in `34de058`
- **Wizard's "Start capturing" prompt didn't actually install Claude Code hooks** — fixed in `d3cd771`
- **Launchd plist argv mangled** (single string `"node /path/to/commands.js"` instead of separate `<string>` elements) — fixed in `d3cd771`
- **Service file written but never `launchctl load`ed** — fixed in `d3cd771`
- **Service file pointed at `dist/cli/commands.js`** (a helper module with no main) **instead of `dist/index.js`** (the dispatcher entry) — fixed in `025a814`
