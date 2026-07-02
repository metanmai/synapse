# Phase 2: Real User Identity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `02-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 02-real-user-identity
**Areas discussed:** Identity bootstrap path, Cross-device project discovery

---

## Identity bootstrap path

### Q1: When/how should the daemon learn the user's UUID?

| Option | Description | Selected |
|--------|-------------|----------|
| synapse init + persist | init flow calls GET /api/account/me, persists UUID to ~/.synapse/config.json. Daemon reads from config on every actor.resolve(). One-shot at install; deterministic; survives daemon restarts. | ✓ |
| Daemon lazy-bootstrap | First daemon cycle calls /me, caches UUID in memory + writes to config.json. Resilient to scripts that bypass the wizard. Slightly slower first cycle. | |
| Don't bootstrap at all | Leave local actor.user_id as 'default' permanently. Backend already overrides at upsert; handoff_events rows are correct already. Zero new code, zero new endpoint. | |

**User's choice:** synapse init + persist
**Notes:** Anchors identity at install-time; deterministic; matches the "init is the canonical install surface" pattern.

### Q2: What endpoint shape does the daemon call?

| Option | Description | Selected |
|--------|-------------|----------|
| New GET /api/account/me | Dedicated endpoint returning { user_id, email } (+tier). Clean URL; matches existing single-purpose conventions in backend/src/api/auth.ts. ~15 LOC. | (Claude's lean) |
| Extend GET /api/account/keys response | Add `viewer: { user_id, email }` to existing keys-list response. Saves one route + one round-trip. Couples two concerns. | |
| You decide | Punt to planner / research. | ✓ |

**User's choice:** You decide (Claude's discretion)
**Notes:** Captured under D-02 with the new `GET /api/account/me` lean documented in CONTEXT.md.

### Q3: Once the daemon has the real UUID, what does local events.jsonl carry?

| Option | Description | Selected |
|--------|-------------|----------|
| Real UUID from now on | Update hook-dispatch.ts:59 to read from config. New events carry real UUID. Old 'default' rows stay (backend ignores actor.user_id anyway). | ✓ |
| Real UUID + one-shot backfill | Same as above, plus init rewrites existing events.jsonl rows. Symmetric local + remote state. Extra ~20 LOC + file-rewrite risk. | |
| Leave local as 'default' | Treat local jsonl as opaque pre-flush state. user_id only authoritative server-side. | |

**User's choice:** Real UUID from now on
**Notes:** Forward-only write keeps the change atomic and avoids backfill risk.

### Q4: If `synapse init`'s /api/account/me call fails, what's the behavior?

| Option | Description | Selected |
|--------|-------------|----------|
| Abort init with clear error | Fail-fast: init refuses to write config.json without a verified UUID. User must fix network and re-run. | ✓ |
| Defer to daemon, mark as pending | Write config.json with api_key but no user_id. Daemon's first cycle calls /me, persists then. | |
| Use placeholder + refresh on first cycle | Init writes 'pending-resolve'; daemon detects and triggers one-shot /me. | |

**User's choice:** Abort init with clear error
**Notes:** Clean state always; no in-between states the daemon has to handle.

---

## Cross-device project discovery

### Q0 (clarification): Same user or different user on machine B?

The user clarified the framing before the substantive question: same-user multi-device is the Phase 2 scope (IDENT-02 explicitly says "same-user cross-device sync"). Different-user / forked-project / shared-project is Phase 4 scope (COLLAB-01..03). The Phase 4 case was noted as deferred and excluded from this discussion.

### Q1: What signal links a local folder to an existing project from the other machine?

| Option | Description | Selected |
|--------|-------------|----------|
| Git remote URL (with basename fallback) | `git remote get-url origin` first, fall back to `git_basename` for non-git/no-remote. Adds `git_remote_url` column. | |
| Git basename only (status quo) | Keep today's (user_id, name) matching. Cheap, no schema change. Collides for common names like 'scratch'. | |
| Manual link from dashboard | No auto-linking. User merges via dashboard action. Predictable; pushes work onto the user. | |
| Both: auto + manual override | Auto by git remote (with basename fallback) AND dashboard override for mis-matches. Belt-and-suspenders. | ✓ |

**User's choice:** Both: auto + manual override
**Notes:** Captures both the cheap-automation and the safety-valve cases. The original framing of the question (when discovery happens) was replaced by the user's better framing (what signal recognizes the match).

### Q2: Where does the manual-override UI land?

| Option | Description | Selected |
|--------|-------------|----------|
| In Phase 2 | Small "merge into existing project" action on the existing dashboard project list. Crosses 'UI hint: no' but keeps feature complete. | ✓ |
| Defer to Phase 3 | Auto-link only in Phase 2; manual override absorbed by Phase 3 (Telemetry, UI hint: yes). Respects original UI scoping. | |
| Defer until needed | Auto-link only; add override only if dogfood surfaces real mismatches. YAGNI. | |

**User's choice:** In Phase 2
**Notes:** Phase 2's UI scope expands from "no" to "minimal" (one button + one modal + one endpoint) to keep IDENT-02 reliable.

### Q3: Once linked, what does machine B's daemon pull and when?

| Option | Description | Selected |
|--------|-------------|----------|
| Eager full sync on link | One-shot pull of ProjectStatus + last N events (suggest 500). Brief fully populated immediately. Heavier initial network. | ✓ |
| Status only, lazy events | Pull ProjectStatus only (<30KB JSON). Brief renders from that alone. Cheap; covers what the brief needs. | |
| Status quo + faster catch-up | No pull on link. Rely on existing daemon cycle. May show one empty brief on machine B. Zero new code. | |

**User's choice:** Eager full sync on link
**Notes:** First brief is populated as soon as link is established; subsumes the "First-brief-on-machine-B" gray area.

### Q4: How does the brief surface device origin when activity came from another machine?

| Option | Description | Selected |
|--------|-------------|----------|
| Show device name explicitly | "Most recent activity (on MacBook Pro): ..." using per-device CLI key label. | ✓ |
| Show 'on another device' when not local | Single-bit indicator: same-device vs other-device. Less precise but privacy-friendly. | |
| Don't distinguish | Today's renderer behavior. Sync is invisible; user sees unified context. Simplest. | |

**User's choice:** Show device name explicitly
**Notes:** Piggybacks on the existing per-device CLI key feature (shipped at `46bdabb`). Tiny renderer change in `handoff-brief.ts`.

---

## Claude's Discretion

- Endpoint shape for the bootstrap call (Q2 in Identity bootstrap path). Recommended: new `GET /api/account/me` per single-purpose convention.
- N for "last N events" on eager sync (D-08). Suggest 500; planner decides.
- Test organization, file placement, concurrency/throttle of eager sync — planner's call within the constraints in CONTEXT.md.

## Deferred Ideas

- **Phase 4 (Cross-User Collaboration):** different user with shared / forked / invited access to a project. The "user 2 has a fork of user 1's project with write access" scenario.
- **Key-invalidation / 401 recovery** — out of scope here; revisit during dogfood if re-auth pain surfaces.
- **Per-project sync opt-out** — host-specific projects (secrets, scratchpads); not selected as a real need yet.
- **First-brief-on-machine-B explicit behavior** — substantially subsumed by D-08's eager full sync on link.
- **N for "last N events" sizing experiments** — tune after dogfood observations.
- **Eager-sync throttle / parallelism** — single-threaded sequential is fine at expected scale.
