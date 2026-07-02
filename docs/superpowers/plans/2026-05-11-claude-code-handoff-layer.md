# Claude Code Handoff Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1 of Synapse as a Claude Code-first collaboration layer. Hooks observe a developer's work into a local append-only event log; an always-on daemon syncs to a Cloudflare Workers backend; the next session (same user or teammate) reads a pre-rendered brief with the previous session's `next_step_hint`.

**Architecture:** Local-first event log → background daemon → backend reducer → materialized `ProjectStatus`. Hooks are pure observers (local writes only); the `synapse` CLI handles deliberate authored actions; the daemon is the network boundary. MCP is de-scoped from the v1 critical path. See `docs/superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md` for the design spec.

**Tech Stack:**
- **MCP package (`mcp/`)** — TypeScript, Node ≥18, esbuild bundling. Hosts the daemon (`capture/daemon.ts`), CLI (`cli/commands.ts`), and the legacy MCP server (`index.ts`).
- **Backend (`backend/`)** — Cloudflare Workers + Hono. Supabase Postgres. Migrations in `supabase/migrations/`.
- **Shared types (`packages/shared/`)** — TypeScript-only, imported by both MCP and backend.
- **Lint/format** — Biome (`npm run lint`, `npm run format`).
- **Tests** — Vitest (per workspace). E2E uses a stub backend over loopback.

**Scope reminder:** v1 acceptance criteria are in §11 of the design spec. Every task in this plan should be traceable to one of those criteria. The daemon-fired CC path (Phase I) is the most novel piece — most other phases extend existing scaffolding in `mcp/src/capture/` and `backend/src/api/`.

---

## File map

**Create:**

| Path | Purpose |
|---|---|
| `packages/shared/src/handoff/types.ts` | Shared TS types: `Event`, `Issue`, `Session`, `ProjectStatus`, `Actor`, `Subtask` |
| `packages/shared/src/handoff/events.ts` | Event-kind enum + payload typing per kind |
| `packages/shared/src/handoff/reducer.ts` | Pure reducer: events → ProjectStatus (used by backend and daemon) |
| `mcp/src/capture/events-log.ts` | Local append-only `events.jsonl` writer + tailer |
| `mcp/src/capture/handoff-sync.ts` | Daemon: flusher + puller (push events, pull ProjectStatus) |
| `mcp/src/capture/handoff-brief.ts` | Daemon: writes `cache/brief.md` on every snapshot |
| `mcp/src/capture/daemon-cc.ts` | Daemon-fired Claude Code runner (Phase I) |
| `mcp/src/capture/os-service.ts` | OS service installer (launchd / systemd) |
| `mcp/src/hooks/session-start.ts` | SessionStart hook entry |
| `mcp/src/hooks/post-tool-use.ts` | PostToolUse hook entry |
| `mcp/src/hooks/user-prompt-submit.ts` | UserPromptSubmit hook entry (status-update injection) |
| `mcp/src/hooks/pre-compact.ts` | PreCompact hook entry |
| `mcp/src/hooks/session-end.ts` | SessionEnd hook entry |
| `mcp/src/hooks/subagent-stop.ts` | SubagentStop hook entry |
| `mcp/src/cli/handoff-commands.ts` | CLI: `handoff`, `set-focus`, `issue …`, `note`, `search` |
| `mcp/src/cli/doctor.ts` | `synapse doctor` — diagnostics |
| `mcp/src/cli/status.ts` | `synapse status` — one-liner |
| `mcp/src/cli/init.ts` | `synapse init` — installer (hooks + OS service) |
| `backend/src/api/events-batch.ts` | `POST /api/events/batch` |
| `backend/src/api/project-status.ts` | `GET /api/projects/:id/status` |
| `backend/src/api/project-events.ts` | `GET /api/projects/:id/events?since=` |
| `backend/src/lib/reducer.ts` | Backend wrapper for the shared reducer (loads from DB, applies events, persists) |
| `supabase/migrations/015_handoff_layer.sql` | Schema: `events`, `issues`, `sessions_handoff`, `project_status` |

**Modify:**

| Path | Change |
|---|---|
| `mcp/src/capture/daemon.ts` | Add lifecycle: start handoff-sync loop, watch hook events.jsonl, idle detection, daemon-cc trigger |
| `mcp/src/cli/commands.ts` | Register new CLI subcommands |
| `mcp/src/cli/brief-format.ts` | Extend to render `ProjectStatus` (in addition to existing project brief) |
| `mcp/src/capture/types.ts` | Add `Actor`, `EventKind` if not already shared |
| `mcp/src/cli/wizard.ts` | Add "install handoff hooks" step |
| `backend/src/index.ts` | Wire up new routes |
| `~/.claude/settings.json` | Installed by `synapse init` — chain hooks onto existing entries |

**Test:**

Per-task; tests sit next to implementation under `test/` directories that already exist in each workspace.

---

## Phase A — Foundation: schema and shared types

### Task 1: Define shared handoff types

**Files:**
- Create: `packages/shared/src/handoff/types.ts`
- Create: `packages/shared/src/handoff/events.ts`
- Test: `packages/shared/test/handoff/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/handoff/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Actor, Event, Issue, ProjectStatus, Session, Subtask } from "../../src/handoff/types.js";
import { EventKind } from "../../src/handoff/events.js";

describe("handoff types", () => {
  it("Actor with kind=human is valid", () => {
    const a: Actor = { user_id: "u1", kind: "human", device_id: "d1", hostname: "macbook", client: "claude-code" };
    expect(a.kind).toBe("human");
  });

  it("Event has all required fields and a known kind", () => {
    const e: Event = {
      event_id: "01HZ...",
      project_id: "p1",
      session_id: "s1",
      actor: { user_id: "u1", kind: "human", device_id: "d1", hostname: "h", client: "claude-code" },
      attached_to: null,
      kind: EventKind.SessionOpened,
      occurred_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      payload: {},
    };
    expect(e.kind).toBe("session_opened");
  });

  it("Issue.kind is one of decision | question", () => {
    const i: Issue = {
      id: "i1", number: 1, type: "issue", title: "x", body: "", state: "open",
      kind: "decision", author: { user_id: "u1", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
      assignees: [], labels: [], references: [], timeline: [],
      created_at: "t", updated_at: "t", closed_at: null,
      superseded_by: null, resolved_by: null, originated_in_session: null,
    };
    expect(["decision", "question"]).toContain(i.kind);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/test/handoff/types.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `events.ts`**

Create `packages/shared/src/handoff/events.ts`:

```ts
export const EventKind = {
  SessionOpened: "session_opened",
  SessionClosed: "session_closed",
  ToolUsed: "tool_used",
  FileTouched: "file_touched",
  CommitMade: "commit_made",
  BranchSwitched: "branch_switched",
  UserPrompted: "user_prompted",
  ContextCompacted: "context_compacted",
  SubtaskAdded: "subtask_added",
  SubtaskCompleted: "subtask_completed",
  IssueCreated: "issue_created",
  IssueStateChanged: "issue_state_changed",
  IssueNoted: "issue_noted",
  FocusSet: "focus_set",
  NextStepSet: "next_step_set",
  NextStepInferred: "next_step_inferred",
  DaemonRunStarted: "daemon_run_started",
  DaemonRunCompleted: "daemon_run_completed",
} as const;

export type EventKind = (typeof EventKind)[keyof typeof EventKind];
```

- [ ] **Step 4: Implement `types.ts`**

Create `packages/shared/src/handoff/types.ts`:

```ts
import type { EventKind } from "./events.js";

export interface Actor {
  user_id: string;
  kind: "human" | "synapse-daemon";
  device_id: string;
  hostname: string;
  client: string;
}

export interface CommitRef { sha: string; message: string }
export interface FileTouch { path: string; last_touched_at: string; operation: "edit" | "read" | "create" | "delete" }
export interface Reference { type: "session" | "issue" | "file" | "commit"; id: string }

export interface Event {
  event_id: string;
  project_id: string;
  session_id: string;
  actor: Actor;
  attached_to: Reference | null;
  kind: EventKind;
  occurred_at: string;
  received_at: string;
  payload: Record<string, unknown>;
}

export interface Subtask {
  id: string;
  text: string;
  state: "open" | "done";
  parent: Reference;
  done_at: string | null;
  done_by: Actor | null;
}

interface GHObject {
  id: string;
  number: number;
  title: string;
  body: string;
  author: Actor;
  assignees: Actor[];
  labels: string[];
  references: Reference[];
  timeline: Event[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Session extends GHObject {
  type: "session";
  project_id: string;
  actor: Actor;
  state: "open" | "closed";
  branch_at_start: string | null;
  base_commit: CommitRef | null;
  started_at: string;
  last_event_at: string;
}

export interface Issue extends GHObject {
  type: "issue";
  kind: "decision" | "question";
  state: "open" | "resolved" | "superseded";
  superseded_by: Reference | null;
  resolved_by: Actor | null;
  originated_in_session: Reference | null;
}

export interface ProjectStatus {
  project_id: string;
  current_next_step: {
    text: string;
    set_by: Actor;
    set_at: string;
    inferred: boolean;
  } | null;
  active_actors: Array<{
    actor: Actor;
    current_focus: string | null;
    branch: string | null;
    last_event_at: string;
    activity_state: "active" | "idle";
    recent_files: FileTouch[];
  }>;
  recent_activity: Event[];
  open_issues: { decisions: Issue[]; questions: Issue[] };
  open_subtasks: Subtask[];
  updated_at: string;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/shared/test/handoff/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add packages/shared/src/handoff packages/shared/test/handoff
git commit -m "feat(shared): add handoff layer types and event kinds"
```

---

### Task 2: Shared reducer (events → ProjectStatus)

**Files:**
- Create: `packages/shared/src/handoff/reducer.ts`
- Test: `packages/shared/test/handoff/reducer.test.ts`

- [ ] **Step 1: Write failing tests for reducer semantics**

Create `packages/shared/test/handoff/reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventKind } from "../../src/handoff/events.js";
import { reduce } from "../../src/handoff/reducer.js";
import type { Actor, Event } from "../../src/handoff/types.js";

const A1: Actor = { user_id: "tanmai", kind: "human", device_id: "d1", hostname: "mbp", client: "claude-code" };
const A2: Actor = { user_id: "alex",   kind: "human", device_id: "d2", hostname: "linux", client: "claude-code" };

function ev(over: Partial<Event>): Event {
  return {
    event_id: over.event_id ?? Math.random().toString(36).slice(2),
    project_id: "p", session_id: "s", actor: A1, attached_to: null,
    kind: EventKind.ToolUsed, occurred_at: "2026-05-11T09:00:00Z",
    received_at: "2026-05-11T09:00:00Z", payload: {},
    ...over,
  };
}

describe("reducer", () => {
  it("empty input → empty ProjectStatus", () => {
    const s = reduce([], "p");
    expect(s.active_actors).toEqual([]);
    expect(s.current_next_step).toBeNull();
  });

  it("LWW on next_step_set: latest occurred_at wins", () => {
    const earlier = ev({ kind: EventKind.NextStepSet, occurred_at: "2026-05-11T09:00:00Z", payload: { text: "older" } });
    const later   = ev({ kind: EventKind.NextStepSet, occurred_at: "2026-05-11T11:00:00Z", payload: { text: "newer" }, actor: A2 });
    const s = reduce([earlier, later], "p");
    expect(s.current_next_step?.text).toBe("newer");
    expect(s.current_next_step?.set_by.user_id).toBe("alex");
  });

  it("order-independence: same final state regardless of event order", () => {
    const events = [
      ev({ kind: EventKind.SessionOpened, occurred_at: "2026-05-11T09:00:00Z" }),
      ev({ kind: EventKind.FocusSet,      occurred_at: "2026-05-11T09:30:00Z", payload: { text: "OAuth" } }),
      ev({ kind: EventKind.NextStepSet,   occurred_at: "2026-05-11T17:00:00Z", payload: { text: "wire /callback" } }),
    ];
    const a = reduce(events, "p");
    const b = reduce([...events].reverse(), "p");
    expect(a.current_next_step?.text).toBe(b.current_next_step?.text);
    expect(a.active_actors[0]?.current_focus).toBe(b.active_actors[0]?.current_focus);
  });

  it("next_step_inferred sets inferred=true; next_step_set sets inferred=false", () => {
    const s1 = reduce([ev({ kind: EventKind.NextStepSet,      payload: { text: "x" } })], "p");
    expect(s1.current_next_step?.inferred).toBe(false);
    const s2 = reduce([ev({ kind: EventKind.NextStepInferred, payload: { text: "x" } })], "p");
    expect(s2.current_next_step?.inferred).toBe(true);
  });

  it("active vs idle: actor with last event >30 min ago → idle", () => {
    const now = new Date("2026-05-11T12:00:00Z");
    const events = [ev({ occurred_at: "2026-05-11T11:00:00Z" })];
    const s = reduce(events, "p", { now });
    expect(s.active_actors[0]?.activity_state).toBe("idle");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/shared/test/handoff/reducer.test.ts`
Expected: FAIL — `reduce` not exported.

- [ ] **Step 3: Implement `reducer.ts`**

Create `packages/shared/src/handoff/reducer.ts`:

```ts
import { EventKind } from "./events.js";
import type { Actor, Event, FileTouch, ProjectStatus } from "./types.js";

const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

export interface ReduceOptions { now?: Date }

export function reduce(events: Event[], project_id: string, opts: ReduceOptions = {}): ProjectStatus {
  const now = (opts.now ?? new Date()).toISOString();
  // Order by occurred_at (LWW), fall back to received_at if occurred_at is implausible (>5 min in future).
  const ordered = [...events].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));

  let next_step: ProjectStatus["current_next_step"] = null;
  const actors = new Map<string, ProjectStatus["active_actors"][number]>();
  const recent = ordered.slice(-50);

  for (const e of ordered) {
    const aKey = e.actor.user_id;
    const slot = actors.get(aKey) ?? {
      actor: e.actor, current_focus: null, branch: null,
      last_event_at: e.occurred_at, activity_state: "active" as const,
      recent_files: [] as FileTouch[],
    };
    slot.last_event_at = e.occurred_at;

    switch (e.kind) {
      case EventKind.NextStepSet:
        next_step = { text: String(e.payload.text ?? ""), set_by: e.actor, set_at: e.occurred_at, inferred: false };
        break;
      case EventKind.NextStepInferred:
        next_step = { text: String(e.payload.text ?? ""), set_by: e.actor, set_at: e.occurred_at, inferred: true };
        break;
      case EventKind.FocusSet:
        slot.current_focus = String(e.payload.text ?? "");
        break;
      case EventKind.UserPrompted:
        if (!slot.current_focus) {
          slot.current_focus = String(e.payload.prompt_excerpt ?? "").slice(0, 80);
        }
        break;
      case EventKind.BranchSwitched:
        slot.branch = String(e.payload.branch ?? slot.branch);
        break;
      case EventKind.FileTouched: {
        const f: FileTouch = {
          path: String(e.payload.path),
          last_touched_at: e.occurred_at,
          operation: (e.payload.operation as FileTouch["operation"]) ?? "edit",
        };
        slot.recent_files = [f, ...slot.recent_files.filter((x) => x.path !== f.path)].slice(0, 10);
        break;
      }
    }
    actors.set(aKey, slot);
  }

  const nowMs = new Date(now).getTime();
  for (const slot of actors.values()) {
    slot.activity_state = nowMs - new Date(slot.last_event_at).getTime() > IDLE_THRESHOLD_MS ? "idle" : "active";
  }

  return {
    project_id,
    current_next_step: next_step,
    active_actors: [...actors.values()].sort((a, b) => b.last_event_at.localeCompare(a.last_event_at)),
    recent_activity: recent,
    open_issues: { decisions: [], questions: [] }, // populated by Task 8 (issue handling)
    open_subtasks: [], // populated by Task 8 (subtask extraction)
    updated_at: now,
  };
}

function orderKey(e: Event): string {
  // Use received_at when occurred_at is implausibly far in the future
  const occMs = new Date(e.occurred_at).getTime();
  const recMs = new Date(e.received_at).getTime();
  if (occMs - recMs > 5 * 60 * 1000) return `${e.received_at}|${e.event_id}`;
  return `${e.occurred_at}|${e.event_id}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/shared/test/handoff/reducer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add packages/shared/src/handoff/reducer.ts packages/shared/test/handoff/reducer.test.ts
git commit -m "feat(shared): pure reducer for events → ProjectStatus with LWW semantics"
```

---

### Task 3: Database migration for handoff tables

**Files:**
- Create: `supabase/migrations/015_handoff_layer.sql`

- [ ] **Step 1: Inspect prior migration style**

Run: `head -40 supabase/migrations/014_robust_auth_user_trigger.sql`
Note the pattern (uses `create table if not exists`, RLS policies, indexes).

- [ ] **Step 2: Write the migration SQL**

Create `supabase/migrations/015_handoff_layer.sql`:

```sql
-- Handoff layer: events log, materialized ProjectStatus, sessions + issues

create table if not exists handoff_sessions (
  id text primary key,                       -- ULID
  number integer not null,
  project_id uuid not null references projects(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_device_id text not null,
  actor_hostname text,
  state text not null default 'open' check (state in ('open','closed')),
  branch_at_start text,
  base_commit_sha text,
  base_commit_message text,
  started_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  closed_at timestamptz
);

create index handoff_sessions_project_idx on handoff_sessions(project_id, last_event_at desc);
create unique index handoff_sessions_number_uq on handoff_sessions(project_id, number);

create table if not exists handoff_events (
  event_id text primary key,                 -- ULID, idempotency key
  project_id uuid not null references projects(id) on delete cascade,
  session_id text not null references handoff_sessions(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  actor_kind text not null check (actor_kind in ('human','synapse-daemon')),
  actor_device_id text not null,
  attached_to jsonb,
  kind text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index handoff_events_project_occurred_idx on handoff_events(project_id, occurred_at);
create index handoff_events_session_idx on handoff_events(session_id, occurred_at);

create table if not exists handoff_issues (
  id text primary key,
  number integer not null,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('decision','question')),
  state text not null default 'open' check (state in ('open','resolved','superseded')),
  title text not null,
  body text not null default '',
  author_user_id uuid not null references auth.users(id) on delete cascade,
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  superseded_by_id text references handoff_issues(id) on delete set null,
  originated_in_session_id text references handoff_sessions(id) on delete set null,
  labels text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index handoff_issues_number_uq on handoff_issues(project_id, number);

create table if not exists handoff_project_status (
  project_id uuid primary key references projects(id) on delete cascade,
  status jsonb not null,                     -- materialized ProjectStatus blob
  updated_at timestamptz not null default now()
);

-- RLS
alter table handoff_sessions enable row level security;
alter table handoff_events enable row level security;
alter table handoff_issues enable row level security;
alter table handoff_project_status enable row level security;

-- Mirror the access pattern used by project_members (see 009/recent commits)
create policy handoff_sessions_member_read on handoff_sessions for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_sessions.project_id and pm.user_id = auth.uid()));
create policy handoff_events_member_read on handoff_events for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_events.project_id and pm.user_id = auth.uid()));
create policy handoff_issues_member_read on handoff_issues for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_issues.project_id and pm.user_id = auth.uid()));
create policy handoff_project_status_member_read on handoff_project_status for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_project_status.project_id and pm.user_id = auth.uid()));

-- Writes only via service role (backend), not directly from clients
```

- [ ] **Step 3: Apply migration locally**

Run: `cd supabase && supabase db reset --local`
Expected: migration applies cleanly; no errors.

- [ ] **Step 4: Verify tables exist**

Run: `supabase db diff --local` (should show no drift) and `psql -h localhost -U postgres -d postgres -c "\\dt handoff_*"`
Expected: 4 tables listed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/015_handoff_layer.sql
git commit -m "feat(backend): migration for handoff layer tables (events, issues, sessions, project_status)"
```

---

## Phase B — Local event store and basic hooks

### Task 4: Local events.jsonl writer

**Files:**
- Create: `mcp/src/capture/events-log.ts`
- Test: `mcp/test/capture/events-log.test.ts`

- [ ] **Step 1: Write failing tests**

Create `mcp/test/capture/events-log.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { appendEvent, readEvents, watermark } from "../../src/capture/events-log.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-")); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("events-log", () => {
  it("appendEvent creates events.jsonl and writes one line", () => {
    appendEvent(tmp, { project_id: "p", session_id: "s", actor: actor(), kind: EventKind.SessionOpened, occurred_at: now(), payload: {} });
    const lines = fs.readFileSync(path.join(tmp, "events.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.kind).toBe("session_opened");
    expect(parsed.event_id).toMatch(/^[0-9A-Z]{26}$/); // ULID
  });

  it("readEvents returns all events as objects", () => {
    appendEvent(tmp, makeEv("session_opened"));
    appendEvent(tmp, makeEv("user_prompted"));
    const events = readEvents(tmp);
    expect(events.map(e => e.kind)).toEqual(["session_opened", "user_prompted"]);
  });

  it("watermark returns the last event_id", () => {
    appendEvent(tmp, makeEv("session_opened"));
    const lastId = appendEvent(tmp, makeEv("user_prompted"));
    expect(watermark(tmp)).toBe(lastId);
  });

  it("appendEvent is O_APPEND-safe with concurrent writers (simulated)", async () => {
    await Promise.all(Array.from({ length: 50 }, () => Promise.resolve().then(() => appendEvent(tmp, makeEv("tool_used")))));
    const events = readEvents(tmp);
    expect(events).toHaveLength(50);
  });
});

function actor() { return { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" }; }
function now() { return new Date().toISOString(); }
function makeEv(kind: string) { return { project_id: "p", session_id: "s", actor: actor(), kind: kind as any, occurred_at: now(), payload: {} }; }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run mcp/test/capture/events-log.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `events-log.ts`**

Create `mcp/src/capture/events-log.ts`:

```ts
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Event } from "@synapse/shared/handoff/types.js";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 0; i < 10; i++) { timeStr = ENCODING[t % 32] + timeStr; t = Math.floor(t / 32); }
  const rand = randomBytes(10);
  let randStr = "";
  for (let i = 0; i < 16; i++) randStr += ENCODING[rand[i % 10] % 32];
  return timeStr + randStr;
}

export function eventsPath(projectDir: string): string {
  return path.join(projectDir, "events.jsonl");
}

export function appendEvent(projectDir: string, partial: Omit<Event, "event_id" | "received_at">): string {
  fs.mkdirSync(projectDir, { recursive: true });
  const id = ulid();
  const event: Event = { ...partial, event_id: id, received_at: new Date().toISOString() };
  const fd = fs.openSync(eventsPath(projectDir), "a");
  try { fs.writeSync(fd, JSON.stringify(event) + "\n"); } finally { fs.closeSync(fd); }
  return id;
}

export function readEvents(projectDir: string): Event[] {
  const p = eventsPath(projectDir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Event);
}

export function watermark(projectDir: string): string | null {
  const events = readEvents(projectDir);
  return events.at(-1)?.event_id ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mcp/test/capture/events-log.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint
git add mcp/src/capture/events-log.ts mcp/test/capture/events-log.test.ts
git commit -m "feat(mcp): local append-only events.jsonl writer with ULID ids"
```

---

### Task 5: Session paths + actor resolution helpers

**Files:**
- Create: `mcp/src/capture/handoff-paths.ts`
- Create: `mcp/src/capture/actor.ts`
- Test: `mcp/test/capture/handoff-paths.test.ts`

- [ ] **Step 1: Write failing tests for path resolution**

```ts
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { briefCachePath, currentSessionPath, projectDir, statusCachePath } from "../../src/capture/handoff-paths.js";

describe("handoff-paths", () => {
  it("projectDir is under ~/.synapse/projects/<pid>", () => {
    expect(projectDir("p1")).toBe(path.join(os.homedir(), ".synapse", "projects", "p1"));
  });
  it("briefCachePath is <projectDir>/cache/brief.md", () => {
    expect(briefCachePath("p1")).toBe(path.join(projectDir("p1"), "cache", "brief.md"));
  });
  it("currentSessionPath and statusCachePath are wired correctly", () => {
    expect(currentSessionPath("p1")).toBe(path.join(projectDir("p1"), "current_session.json"));
    expect(statusCachePath("p1")).toBe(path.join(projectDir("p1"), "cache", "project_status.json"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mcp/test/capture/handoff-paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `handoff-paths.ts`**

```ts
import os from "node:os";
import path from "node:path";

export function synapseRoot(): string { return path.join(os.homedir(), ".synapse"); }
export function projectDir(project_id: string): string { return path.join(synapseRoot(), "projects", project_id); }
export function currentSessionPath(p: string): string { return path.join(projectDir(p), "current_session.json"); }
export function statusCachePath(p: string): string { return path.join(projectDir(p), "cache", "project_status.json"); }
export function briefCachePath(p: string): string { return path.join(projectDir(p), "cache", "brief.md"); }
export function healthcheckPath(): string { return path.join(synapseRoot(), "daemon.healthcheck"); }
export function flushNowSignalPath(): string { return path.join(synapseRoot(), "daemon-flush-now"); }
```

- [ ] **Step 4: Implement `actor.ts`**

```ts
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";
import type { Actor } from "@synapse/shared/handoff/types.js";

function readOrCreateDeviceId(): string {
  const idFile = path.join(synapseRoot(), "device_id");
  if (fs.existsSync(idFile)) return fs.readFileSync(idFile, "utf-8").trim();
  fs.mkdirSync(synapseRoot(), { recursive: true });
  const id = randomBytes(8).toString("hex");
  fs.writeFileSync(idFile, id);
  return id;
}

export function resolveActor(user_id: string, kind: Actor["kind"] = "human"): Actor {
  return { user_id, kind, device_id: readOrCreateDeviceId(), hostname: os.hostname(), client: "claude-code" };
}
```

- [ ] **Step 5: Run tests to verify path tests pass**

Run: `npx vitest run mcp/test/capture/handoff-paths.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
npm run lint
git add mcp/src/capture/handoff-paths.ts mcp/src/capture/actor.ts mcp/test/capture/handoff-paths.test.ts
git commit -m "feat(mcp): handoff path helpers and actor resolution"
```

---

### Task 6: SessionStart hook (basic — read brief, emit event)

**Files:**
- Create: `mcp/src/hooks/session-start.ts`
- Test: `mcp/test/hooks/session-start.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSessionStartHook } from "../../src/hooks/session-start.js";

// Tests run the hook with a stub project_id and check stdout + events.jsonl.
// Mock ~/.synapse via env override.

describe("SessionStart hook", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync("/tmp/synapse-test-");
    process.env.SYNAPSE_HOME = tmp;
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.SYNAPSE_HOME; });

  it("prints empty <synapse-brief> when no cache exists, still writes session_opened event", async () => {
    const out: string[] = [];
    const stdout = { write: (s: string) => { out.push(s); return true; } } as unknown as NodeJS.WriteStream;
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout, skipFallback: true });
    expect(out.join("")).toContain("<synapse-brief>");
    const events = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p1/events.jsonl"), "utf-8").trim());
    expect(events.kind).toBe("session_opened");
  });

  it("exits silently if SYNAPSE_DAEMON_SESSION env var is set (loop prevention)", async () => {
    process.env.SYNAPSE_DAEMON_SESSION = "1";
    const out: string[] = [];
    await runSessionStartHook({ project_id: "p1", user_id: "u1", stdout: { write: (s: string) => out.push(s) > 0 } as any });
    expect(out).toEqual([]);
    delete process.env.SYNAPSE_DAEMON_SESSION;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mcp/test/hooks/session-start.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `session-start.ts`**

```ts
import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { briefCachePath, currentSessionPath, projectDir } from "../capture/handoff-paths.js";

export interface SessionStartArgs {
  project_id: string;
  user_id: string;
  stdout: NodeJS.WriteStream;
  skipFallback?: boolean;
}

export async function runSessionStartHook(args: SessionStartArgs): Promise<void> {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const session_id = `s_${Date.now().toString(36)}`;
  const actor = resolveActor(args.user_id);

  // 1. Read brief from cache, or fall back to inline CLI render
  let brief = "";
  const bp = briefCachePath(args.project_id);
  if (fs.existsSync(bp)) {
    brief = fs.readFileSync(bp, "utf-8");
  } else if (!args.skipFallback) {
    // Fallback path (Task 22 implements `synapse brief --project ... --actor ...`)
    // For now, emit a minimal stub.
    brief = `Project: ${args.project_id}\n(no cached context — daemon will populate on next sync)`;
  }
  args.stdout.write(`<synapse-brief>\n${brief.trim()}\n</synapse-brief>\n`);

  // 2. Record event
  appendEvent(projectDir(args.project_id), {
    project_id: args.project_id, session_id, actor, attached_to: null,
    kind: EventKind.SessionOpened, occurred_at: new Date().toISOString(), payload: { hostname: actor.hostname },
  });

  // 3. Write current_session pointer
  fs.mkdirSync(projectDir(args.project_id), { recursive: true });
  fs.writeFileSync(currentSessionPath(args.project_id), JSON.stringify({ session_id, started_at: new Date().toISOString() }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mcp/test/hooks/session-start.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/hooks/session-start.ts mcp/test/hooks/session-start.test.ts
git commit -m "feat(mcp): SessionStart hook reads brief cache and emits session_opened"
```

---

### Task 7: PostToolUse hook (kind routing)

**Files:**
- Create: `mcp/src/hooks/post-tool-use.ts`
- Test: `mcp/test/hooks/post-tool-use.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPostToolUseHook } from "../../src/hooks/post-tool-use.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-test-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.SYNAPSE_HOME; });

describe("PostToolUse hook", () => {
  it("Edit tool → file_touched event with path", () => {
    runPostToolUseHook({ project_id: "p", user_id: "u", session_id: "s", tool: "Edit", input: { file_path: "/repo/src/x.ts" }, output: {} });
    const events = readJsonl(path.join(tmp, "projects/p/events.jsonl"));
    expect(events[0].kind).toBe("file_touched");
    expect(events[0].payload.path).toBe("/repo/src/x.ts");
  });

  it("Bash git commit → tool_used + commit_made", () => {
    runPostToolUseHook({ project_id: "p", user_id: "u", session_id: "s", tool: "Bash",
      input: { command: "git commit -m 'feat: x'" }, output: { stdout: "[main 4585dca] feat: x" } });
    const events = readJsonl(path.join(tmp, "projects/p/events.jsonl"));
    expect(events.map(e => e.kind)).toContain("commit_made");
  });

  it("Bash git checkout → branch_switched", () => {
    runPostToolUseHook({ project_id: "p", user_id: "u", session_id: "s", tool: "Bash",
      input: { command: "git checkout feature/oauth" }, output: { stdout: "Switched to branch 'feature/oauth'" } });
    expect(readJsonl(path.join(tmp, "projects/p/events.jsonl")).map(e => e.kind)).toContain("branch_switched");
  });

  it("TaskCreate → subtask_added", () => {
    runPostToolUseHook({ project_id: "p", user_id: "u", session_id: "s", tool: "TaskCreate",
      input: { subject: "Wire OAuth callback" }, output: { taskId: "12" } });
    expect(readJsonl(path.join(tmp, "projects/p/events.jsonl"))[0].kind).toBe("subtask_added");
  });
});

function readJsonl(p: string) { return fs.readFileSync(p, "utf-8").split("\n").filter(Boolean).map(JSON.parse); }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run mcp/test/hooks/post-tool-use.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `post-tool-use.ts`**

```ts
import { EventKind } from "@synapse/shared/handoff/events.js";
import type { EventKind as Kind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { projectDir } from "../capture/handoff-paths.js";

interface Args {
  project_id: string;
  user_id: string;
  session_id: string;
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export function runPostToolUseHook(a: Args): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const actor = resolveActor(a.user_id);
  const base = { project_id: a.project_id, session_id: a.session_id, actor, attached_to: null, occurred_at: new Date().toISOString() };
  const dir = projectDir(a.project_id);

  const events: Array<{ kind: Kind; payload: Record<string, unknown> }> = [];

  if (a.tool === "Edit" || a.tool === "Write" || a.tool === "MultiEdit") {
    const p = String(a.input.file_path ?? a.input.path ?? "");
    if (p) events.push({ kind: EventKind.FileTouched, payload: { path: p, operation: a.tool === "Write" ? "create" : "edit" } });
  } else if (a.tool === "TaskCreate") {
    events.push({ kind: EventKind.SubtaskAdded, payload: { text: String(a.input.subject ?? ""), task_id: String((a.output as any)?.taskId ?? "") } });
  } else if (a.tool === "TaskUpdate" && (a.input as any)?.status === "completed") {
    events.push({ kind: EventKind.SubtaskCompleted, payload: { task_id: String((a.input as any).taskId) } });
  } else if (a.tool === "Bash") {
    const cmd = String((a.input as any).command ?? "");
    const stdout = String((a.output as any)?.stdout ?? "");
    events.push({ kind: EventKind.ToolUsed, payload: { tool: "Bash", cmd_summary: cmd.slice(0, 120) } });
    const commitMatch = stdout.match(/\[[\w-]+\s+([a-f0-9]{6,40})\]/);
    if (/^git\s+commit/.test(cmd.trim()) && commitMatch) {
      events.push({ kind: EventKind.CommitMade, payload: { sha: commitMatch[1], message: cmd.match(/-m\s+['"]([^'"]+)['"]/)?.[1] ?? "" } });
    }
    const switchMatch = stdout.match(/Switched to (?:a new )?branch '([^']+)'/);
    if (switchMatch) events.push({ kind: EventKind.BranchSwitched, payload: { branch: switchMatch[1] } });
  } else {
    events.push({ kind: EventKind.ToolUsed, payload: { tool: a.tool } });
  }

  for (const e of events) appendEvent(dir, { ...base, ...e });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mcp/test/hooks/post-tool-use.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/src/hooks/post-tool-use.ts mcp/test/hooks/post-tool-use.test.ts
git commit -m "feat(mcp): PostToolUse hook routes tool calls to typed events"
```

---

### Task 8: Issue and Subtask handling in the reducer

**Files:**
- Modify: `packages/shared/src/handoff/reducer.ts` (extend)
- Extend: `packages/shared/test/handoff/reducer.test.ts`

- [ ] **Step 1: Write failing test for subtask aggregation**

Add to the existing reducer test file:

```ts
it("aggregates open subtasks from subtask_added / subtask_completed events", () => {
  const events = [
    ev({ kind: EventKind.SubtaskAdded, payload: { task_id: "t1", text: "Wire callback" } }),
    ev({ kind: EventKind.SubtaskAdded, payload: { task_id: "t2", text: "Write test" } }),
    ev({ kind: EventKind.SubtaskCompleted, payload: { task_id: "t1" } }),
  ];
  const s = reduce(events, "p");
  expect(s.open_subtasks.map(t => t.text)).toEqual(["Write test"]);
});

it("issues created via events appear in open_issues by kind", () => {
  const events = [
    ev({ kind: EventKind.IssueCreated, payload: { id: "i1", number: 1, kind: "decision", title: "Use JWT lib", body: "" } }),
    ev({ kind: EventKind.IssueCreated, payload: { id: "i2", number: 2, kind: "question", title: "PKCE?", body: "" } }),
    ev({ kind: EventKind.IssueStateChanged, payload: { id: "i1", state: "resolved" } }),
  ];
  const s = reduce(events, "p");
  expect(s.open_issues.questions.map(i => i.title)).toEqual(["PKCE?"]);
  expect(s.open_issues.decisions).toEqual([]); // resolved → no longer open
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/shared/test/handoff/reducer.test.ts`
Expected: FAIL on the two new tests.

- [ ] **Step 3: Extend reducer to handle subtasks and issues**

In `packages/shared/src/handoff/reducer.ts`, inside the for-of loop, add cases:

```ts
case EventKind.SubtaskAdded: {
  const id = String(e.payload.task_id ?? e.event_id);
  subtasks.set(id, {
    id, text: String(e.payload.text ?? ""), state: "open",
    parent: { type: "session", id: e.session_id }, done_at: null, done_by: null,
  });
  break;
}
case EventKind.SubtaskCompleted: {
  const id = String(e.payload.task_id);
  const t = subtasks.get(id);
  if (t) { t.state = "done"; t.done_at = e.occurred_at; t.done_by = e.actor; }
  break;
}
case EventKind.IssueCreated: {
  const p = e.payload as any;
  issues.set(p.id, {
    id: p.id, number: p.number, type: "issue", kind: p.kind, state: "open",
    title: p.title, body: p.body ?? "", author: e.actor, assignees: [], labels: [],
    references: [], timeline: [],
    created_at: e.occurred_at, updated_at: e.occurred_at, closed_at: null,
    superseded_by: null, resolved_by: null,
    originated_in_session: { type: "session", id: e.session_id },
  });
  break;
}
case EventKind.IssueStateChanged: {
  const p = e.payload as any;
  const it = issues.get(p.id);
  if (it) {
    it.state = p.state;
    it.updated_at = e.occurred_at;
    if (p.state === "resolved") it.resolved_by = e.actor;
    if (p.state === "superseded" && p.superseded_by) it.superseded_by = { type: "issue", id: p.superseded_by };
  }
  break;
}
```

At the top of `reduce`, initialize:

```ts
const subtasks = new Map<string, Subtask>();
const issues = new Map<string, Issue>();
```

At the return:

```ts
return {
  // ... existing fields ...
  open_issues: {
    decisions: [...issues.values()].filter(i => i.kind === "decision" && i.state === "open"),
    questions: [...issues.values()].filter(i => i.kind === "question" && i.state === "open"),
  },
  open_subtasks: [...subtasks.values()].filter(t => t.state === "open"),
  updated_at: now,
};
```

Import `Issue` and `Subtask` at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/shared/test/handoff/reducer.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add packages/shared/src/handoff/reducer.ts packages/shared/test/handoff/reducer.test.ts
git commit -m "feat(shared): reducer handles subtasks and issue state transitions"
```

---

## Phase C — Backend events API + reducer

### Task 9: POST /api/events/batch endpoint

**Files:**
- Create: `backend/src/api/events-batch.ts`
- Test: `backend/test/api/events-batch.test.ts`
- Modify: `backend/src/index.ts` (register route)

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { app } from "../../src/index.js";

describe("POST /api/events/batch", () => {
  it("inserts events idempotently", async () => {
    const events = [validEvent("01HZ001"), validEvent("01HZ001"), validEvent("01HZ002")];
    const res = await app.request("/api/events/batch", {
      method: "POST",
      headers: { Authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ events }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(2);              // dup ignored
    expect(body.duplicates).toBe(1);
  });

  it("rejects events with implausible occurred_at by clamping to received_at", async () => {
    const ev = validEvent("01HZ003", "2099-01-01T00:00:00Z");
    const res = await app.request("/api/events/batch", { method: "POST", headers: validHeaders(), body: JSON.stringify({ events: [ev] }) });
    const body = await res.json();
    expect(body.accepted).toBe(1);
    expect(body.adjusted).toContain("01HZ003");
  });
});

function validEvent(id: string, occurred_at = "2026-05-11T09:00:00Z") {
  return { event_id: id, project_id: "p", session_id: "s", actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null, kind: "session_opened", occurred_at, payload: {} };
}
function validHeaders() { return { Authorization: "Bearer test-key", "content-type": "application/json" }; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/test/api/events-batch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `events-batch.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "../lib/env.js";
import { getSupabase } from "../db/client.js";
import { recomputeProjectStatus } from "../lib/reducer.js";

const SKEW_LIMIT_MS = 5 * 60 * 1000;

export const eventsBatchRoute = new Hono<{ Bindings: Env; Variables: { user_id: string } }>();

eventsBatchRoute.post("/events/batch", async (c) => {
  const { events } = await c.req.json<{ events: any[] }>();
  if (!Array.isArray(events) || events.length === 0) return c.json({ error: "events array required" }, 400);

  const user_id = c.get("user_id");
  const supabase = getSupabase(c.env);
  const now = Date.now();
  const adjusted: string[] = [];

  const rows = events.map((e) => {
    const occurred = new Date(e.occurred_at).getTime();
    let occurred_at = e.occurred_at;
    if (Math.abs(occurred - now) > SKEW_LIMIT_MS && occurred > now) {
      adjusted.push(e.event_id);
      occurred_at = new Date(now).toISOString();
    }
    return {
      event_id: e.event_id,
      project_id: e.project_id,
      session_id: e.session_id,
      actor_user_id: user_id,
      actor_kind: e.actor.kind,
      actor_device_id: e.actor.device_id,
      attached_to: e.attached_to,
      kind: e.kind,
      occurred_at,
      received_at: new Date(now).toISOString(),
      payload: e.payload ?? {},
    };
  });

  const { error, count } = await supabase
    .from("handoff_events")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;

  const accepted = count ?? rows.length;
  const duplicates = rows.length - accepted;

  // Trigger reducer recompute per affected project (queued; not blocking)
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  await Promise.all(projectIds.map((pid) => recomputeProjectStatus(supabase, pid)));

  return c.json({ accepted, duplicates, adjusted });
});
```

- [ ] **Step 4: Implement `backend/src/lib/reducer.ts` stub**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { reduce } from "@synapse/shared/handoff/reducer.js";
import type { Event } from "@synapse/shared/handoff/types.js";

export async function recomputeProjectStatus(supabase: SupabaseClient, project_id: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from("handoff_events").select("*").eq("project_id", project_id).order("occurred_at", { ascending: true });
  if (error) throw error;
  const events: Event[] = rows.map(rowToEvent);
  const status = reduce(events, project_id);
  await supabase.from("handoff_project_status").upsert({ project_id, status, updated_at: new Date().toISOString() });
}

function rowToEvent(r: any): Event {
  return {
    event_id: r.event_id, project_id: r.project_id, session_id: r.session_id,
    actor: { user_id: r.actor_user_id, kind: r.actor_kind, device_id: r.actor_device_id, hostname: "", client: "claude-code" },
    attached_to: r.attached_to, kind: r.kind, occurred_at: r.occurred_at, received_at: r.received_at, payload: r.payload,
  };
}
```

- [ ] **Step 5: Register route in `backend/src/index.ts`**

Add:
```ts
import { eventsBatchRoute } from "./api/events-batch.js";
// ... existing imports
app.route("/api", eventsBatchRoute);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run backend/test/api/events-batch.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run lint
git add backend/src/api/events-batch.ts backend/src/lib/reducer.ts backend/src/index.ts backend/test/api/events-batch.test.ts
git commit -m "feat(backend): POST /api/events/batch with idempotent inserts and skew clamping"
```

---

### Task 10: GET /api/projects/:id/status endpoint

**Files:**
- Create: `backend/src/api/project-status.ts`
- Test: `backend/test/api/project-status.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { app } from "../../src/index.js";

describe("GET /api/projects/:id/status", () => {
  it("returns 200 with ProjectStatus shape", async () => {
    const res = await app.request("/api/projects/p1/status", { headers: { Authorization: "Bearer test-key" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("project_id");
    expect(body).toHaveProperty("active_actors");
    expect(body).toHaveProperty("current_next_step");
  });

  it("returns 404 when project not accessible", async () => {
    const res = await app.request("/api/projects/does-not-exist/status", { headers: { Authorization: "Bearer test-key" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/test/api/project-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { Hono } from "hono";
import type { Env } from "../lib/env.js";
import { getSupabase } from "../db/client.js";

export const projectStatusRoute = new Hono<{ Bindings: Env; Variables: { user_id: string } }>();

projectStatusRoute.get("/projects/:id/status", async (c) => {
  const project_id = c.req.param("id");
  const supabase = getSupabase(c.env);
  const { data, error } = await supabase.from("handoff_project_status").select("status").eq("project_id", project_id).maybeSingle();
  if (error) throw error;
  if (!data) return c.json({ error: "not found" }, 404);
  return c.json(data.status);
});
```

Register in `backend/src/index.ts`:
```ts
app.route("/api", projectStatusRoute);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/test/api/project-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint
git add backend/src/api/project-status.ts backend/src/index.ts backend/test/api/project-status.test.ts
git commit -m "feat(backend): GET /api/projects/:id/status returns materialized ProjectStatus"
```

---

### Task 11: GET /api/projects/:id/events?since= endpoint

**Files:**
- Create: `backend/src/api/project-events.ts`
- Test: `backend/test/api/project-events.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { app } from "../../src/index.js";

describe("GET /api/projects/:id/events?since=", () => {
  it("returns events newer than the watermark", async () => {
    const res = await app.request("/api/projects/p1/events?since=01HZ001&limit=100", { headers: { Authorization: "Bearer test-key" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body).toHaveProperty("next_since");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { Hono } from "hono";
import type { Env } from "../lib/env.js";
import { getSupabase } from "../db/client.js";

export const projectEventsRoute = new Hono<{ Bindings: Env; Variables: { user_id: string } }>();

projectEventsRoute.get("/projects/:id/events", async (c) => {
  const project_id = c.req.param("id");
  const since = c.req.query("since") ?? null;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200", 10), 1000);
  const supabase = getSupabase(c.env);
  let q = supabase.from("handoff_events").select("*").eq("project_id", project_id).order("event_id", { ascending: true }).limit(limit);
  if (since) q = q.gt("event_id", since);
  const { data, error } = await q;
  if (error) throw error;
  const next_since = data && data.length > 0 ? data[data.length - 1].event_id : since;
  return c.json({ events: data, next_since });
});
```

Register in `backend/src/index.ts`.

- [ ] **Step 3: Run test, commit**

```bash
npx vitest run backend/test/api/project-events.test.ts
npm run lint
git add backend/src/api/project-events.ts backend/src/index.ts backend/test/api/project-events.test.ts
git commit -m "feat(backend): GET /api/projects/:id/events?since= for incremental pull"
```

---

## Phase D — Daemon extensions

### Task 12: handoff-sync (push + pull loop)

**Files:**
- Create: `mcp/src/capture/handoff-sync.ts`
- Test: `mcp/test/capture/handoff-sync.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFlushCycle } from "../../src/capture/handoff-sync.js";

// Mock fetch — assert daemon POSTs the right batch and respects the watermark.

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-sync-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("runFlushCycle", () => {
  it("posts unflushed events and updates watermark", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"),
      [makeEv("01HZA"), makeEv("01HZB")].map(e => JSON.stringify(e)).join("\n") + "\n");

    const calls: any[] = [];
    global.fetch = vi.fn(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ accepted: 2, duplicates: 0 }), { status: 200 });
    });

    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(2);
    expect(calls[0].body.events).toHaveLength(2);

    // Watermark is persisted
    const wm = fs.readFileSync(path.join(tmp, "projects/p1/.watermark"), "utf-8").trim();
    expect(wm).toBe("01HZB");
  });

  it("does not re-flush events already past the watermark", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), JSON.stringify(makeEv("01HZA")) + "\n");
    fs.writeFileSync(path.join(tmp, "projects/p1/.watermark"), "01HZA");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await runFlushCycle({ project_id: "p1", api_key: "k", api_url: "https://api.test" });
    expect(result.flushed).toBe(0);
  });
});

function makeEv(id: string) {
  return { event_id: id, project_id: "p1", session_id: "s", actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null, kind: "session_opened", occurred_at: "2026-05-11T09:00:00Z", received_at: "2026-05-11T09:00:01Z", payload: {} };
}
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import path from "node:path";
import { readEvents } from "./events-log.js";
import { projectDir } from "./handoff-paths.js";

export interface FlushArgs { project_id: string; api_key: string; api_url: string }

export async function runFlushCycle(a: FlushArgs): Promise<{ flushed: number }> {
  const dir = projectDir(a.project_id);
  const wmPath = path.join(dir, ".watermark");
  const wm = fs.existsSync(wmPath) ? fs.readFileSync(wmPath, "utf-8").trim() : null;
  const all = readEvents(dir);
  const pending = wm ? all.filter((e) => e.event_id > wm) : all;
  if (pending.length === 0) return { flushed: 0 };

  const res = await fetch(`${a.api_url}/api/events/batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${a.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ events: pending }),
  });
  if (!res.ok) throw new Error(`batch failed: ${res.status}`);

  fs.writeFileSync(wmPath, pending[pending.length - 1].event_id);
  return { flushed: pending.length };
}

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

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/capture/handoff-sync.test.ts
git add mcp/src/capture/handoff-sync.ts mcp/test/capture/handoff-sync.test.ts
git commit -m "feat(mcp): daemon handoff-sync push/pull with watermark"
```

---

### Task 13: handoff-brief (render brief from local cache)

**Files:**
- Create: `mcp/src/capture/handoff-brief.ts`
- Test: `mcp/test/capture/handoff-brief.test.ts`

- [ ] **Step 1: Write failing snapshot test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderBriefFromCache } from "../../src/capture/handoff-brief.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-brief-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("renderBriefFromCache", () => {
  it("renders 'you are returning' framing when actor matches latest activity", () => {
    setupStatus(tmp, "p1", {
      project_id: "p1",
      current_next_step: { text: "wire /callback", set_by: { user_id: "tanmai", kind: "human", device_id: "d", hostname: "mbp", client: "claude-code" }, set_at: "2026-05-11T17:00:00Z", inferred: false },
      active_actors: [{ actor: { user_id: "tanmai", kind: "human", device_id: "d", hostname: "mbp", client: "claude-code" }, current_focus: "OAuth", branch: "feature/oauth", last_event_at: "2026-05-11T17:00:00Z", activity_state: "idle", recent_files: [] }],
      recent_activity: [], open_issues: { decisions: [], questions: [] }, open_subtasks: [], updated_at: "2026-05-11T17:00:01Z",
    });
    const brief = renderBriefFromCache("p1", "tanmai");
    expect(brief).toContain("Your last activity");
    expect(brief).toContain("wire /callback");
  });

  it("renders 'teammate handoff' framing when actor differs", () => {
    setupStatus(tmp, "p1", makeStatusFromActor("tanmai", "wire /callback"));
    const brief = renderBriefFromCache("p1", "alex");
    expect(brief).toContain("Most recent activity");
    expect(brief).toContain("tanmai");
    expect(brief).toContain("wire /callback");
  });

  it("labels inferred next-steps explicitly", () => {
    const status = makeStatusFromActor("tanmai", "wire /callback");
    status.current_next_step!.inferred = true;
    setupStatus(tmp, "p1", status);
    const brief = renderBriefFromCache("p1", "alex");
    expect(brief).toMatch(/Next step \(inferred/);
  });
});

function setupStatus(home: string, pid: string, status: any) {
  const dir = path.join(home, "projects", pid, "cache");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "project_status.json"), JSON.stringify(status));
}
function makeStatusFromActor(uid: string, nextStep: string): any {
  return {
    project_id: "p1",
    current_next_step: { text: nextStep, set_by: { user_id: uid, kind: "human", device_id: "d", hostname: "h", client: "claude-code" }, set_at: "2026-05-11T17:00:00Z", inferred: false },
    active_actors: [{ actor: { user_id: uid, kind: "human", device_id: "d", hostname: "h", client: "claude-code" }, current_focus: "OAuth", branch: "feature/oauth", last_event_at: "2026-05-11T17:00:00Z", activity_state: "idle", recent_files: [] }],
    recent_activity: [], open_issues: { decisions: [], questions: [] }, open_subtasks: [], updated_at: "2026-05-11T17:00:01Z",
  };
}
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import { statusCachePath } from "./handoff-paths.js";
import type { ProjectStatus } from "@synapse/shared/handoff/types.js";

const MAX_BRIEF_LINES = 30;

export function renderBriefFromCache(project_id: string, viewer_user_id: string): string {
  const p = statusCachePath(project_id);
  if (!fs.existsSync(p)) return `Project: ${project_id}\n(no cached context yet — daemon will populate on next sync)`;
  const status: ProjectStatus = JSON.parse(fs.readFileSync(p, "utf-8"));
  return render(status, viewer_user_id);
}

function render(s: ProjectStatus, viewer: string): string {
  const lines: string[] = [];
  lines.push(`Project: ${s.project_id}`);
  if (s.current_next_step) {
    const provenance = s.current_next_step.inferred ? "inferred from activity" : `set by ${s.current_next_step.set_by.user_id}`;
    lines.push(`Next step (${provenance}): "${s.current_next_step.text}"`);
  }
  const mostRecent = s.active_actors[0];
  if (mostRecent) {
    if (mostRecent.actor.user_id === viewer) {
      lines.push(`Your last activity: ${mostRecent.current_focus ?? "(no focus)"} on ${mostRecent.branch ?? "(no branch)"}`);
    } else {
      lines.push(`Most recent activity (${mostRecent.actor.user_id}, ${mostRecent.activity_state}): ${mostRecent.current_focus ?? "(no focus)"} on ${mostRecent.branch ?? "(no branch)"}`);
    }
  }
  if (s.open_subtasks.length > 0) {
    lines.push(`Open subtasks: ${s.open_subtasks.slice(0, 5).map(t => `[${t.text}]`).join(", ")}`);
  }
  if (s.open_issues.questions.length > 0) {
    lines.push(`Open questions: ${s.open_issues.questions.slice(0, 3).map(q => `#${q.number} ${q.title}`).join("; ")}`);
  }
  return lines.slice(0, MAX_BRIEF_LINES).join("\n");
}

export function writeBrief(project_id: string, viewer_user_id: string): void {
  const brief = renderBriefFromCache(project_id, viewer_user_id);
  const { briefCachePath } = require("./handoff-paths.js");
  fs.mkdirSync(require("node:path").dirname(briefCachePath(project_id)), { recursive: true });
  fs.writeFileSync(briefCachePath(project_id), brief);
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/capture/handoff-brief.test.ts
git add mcp/src/capture/handoff-brief.ts mcp/test/capture/handoff-brief.test.ts
git commit -m "feat(mcp): brief renderer reads ProjectStatus from local cache"
```

---

### Task 14: Daemon main loop integration

**Files:**
- Modify: `mcp/src/capture/daemon.ts`
- Test: `mcp/test/capture/daemon.test.ts`

- [ ] **Step 1: Read existing daemon.ts to understand the loop**

Run: `head -80 mcp/src/capture/daemon.ts`

- [ ] **Step 2: Write failing integration test**

```ts
// Simulates a daemon that watches events.jsonl, runs flush/pull every N seconds,
// touches healthcheck file. Stops gracefully.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHandoffLoop } from "../../src/capture/daemon.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-daemon-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("handoff daemon loop", () => {
  it("touches healthcheck file periodically", async () => {
    const stop = startHandoffLoop({ projects: ["p1"], api_key: "k", api_url: "https://api.test", pull_ms: 100, healthcheck_ms: 100 });
    await new Promise((r) => setTimeout(r, 250));
    expect(fs.existsSync(path.join(tmp, "daemon.healthcheck"))).toBe(true);
    stop();
  });

  it("processes flush-now signal immediately", async () => {
    global.fetch = vi.fn(async () => new Response('{"accepted":0}', { status: 200 })) as any;
    fs.mkdirSync(path.join(tmp, "projects/p1"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p1/events.jsonl"), JSON.stringify(makeEv()) + "\n");
    const stop = startHandoffLoop({ projects: ["p1"], api_key: "k", api_url: "https://api.test", pull_ms: 10000, healthcheck_ms: 1000 });
    fs.writeFileSync(path.join(tmp, "daemon-flush-now"), "");
    await new Promise((r) => setTimeout(r, 200));
    expect((global.fetch as any).mock.calls.length).toBeGreaterThan(0);
    stop();
  });
});

function makeEv() {
  return { event_id: "01HZA", project_id: "p1", session_id: "s", actor: { user_id: "u", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null, kind: "session_opened", occurred_at: "2026-05-11T09:00:00Z", received_at: "2026-05-11T09:00:01Z", payload: {} };
}
```

- [ ] **Step 3: Add `startHandoffLoop` to daemon.ts**

Append to `mcp/src/capture/daemon.ts`:

```ts
import { runFlushCycle, runPullCycle } from "./handoff-sync.js";
import { writeBrief } from "./handoff-brief.js";
import { flushNowSignalPath, healthcheckPath } from "./handoff-paths.js";
import fs from "node:fs";

export interface HandoffLoopArgs {
  projects: string[];
  api_key: string;
  api_url: string;
  user_id?: string;            // viewer identity used for brief framing
  pull_ms?: number;            // default 15000
  flush_ms?: number;           // default 10000
  healthcheck_ms?: number;     // default 10000
}

export function startHandoffLoop(a: HandoffLoopArgs): () => void {
  const pull_ms = a.pull_ms ?? 15000;
  const flush_ms = a.flush_ms ?? 10000;
  const hc_ms = a.healthcheck_ms ?? 10000;
  let stopped = false;

  async function cycle() {
    if (stopped) return;
    for (const project_id of a.projects) {
      try {
        await runFlushCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        await runPullCycle({ project_id, api_key: a.api_key, api_url: a.api_url });
        if (a.user_id) writeBrief(project_id, a.user_id);
      } catch (err) {
        console.error("[handoff] cycle error", project_id, err);
      }
    }
  }

  // Flush signal watcher
  const signalCheck = setInterval(async () => {
    if (fs.existsSync(flushNowSignalPath())) {
      try { fs.unlinkSync(flushNowSignalPath()); } catch {}
      await cycle();
    }
  }, 100);

  const cycleTimer = setInterval(cycle, Math.min(pull_ms, flush_ms));

  const hcTimer = setInterval(() => {
    fs.mkdirSync(require("node:path").dirname(healthcheckPath()), { recursive: true });
    fs.writeFileSync(healthcheckPath(), new Date().toISOString());
  }, hc_ms);

  cycle(); // initial run

  return () => {
    stopped = true;
    clearInterval(signalCheck);
    clearInterval(cycleTimer);
    clearInterval(hcTimer);
  };
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run mcp/test/capture/daemon.test.ts
git add mcp/src/capture/daemon.ts mcp/test/capture/daemon.test.ts
git commit -m "feat(mcp): startHandoffLoop integrates flush+pull+brief+watchdog"
```

---

## Phase E — OS service installation

### Task 15: launchd + systemd installers

**Files:**
- Create: `mcp/src/capture/os-service.ts`
- Test: `mcp/test/capture/os-service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderLaunchdPlist, renderSystemdUnit, writeServiceFile } from "../../src/capture/os-service.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-os-"); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("os-service installers", () => {
  it("launchd plist contains synapse binary path and RunAtLoad=true", () => {
    const plist = renderLaunchdPlist({ bin: "/usr/local/bin/synapse", log: "/tmp/x.log" });
    expect(plist).toContain("/usr/local/bin/synapse");
    expect(plist).toContain("<key>RunAtLoad</key>");
  });

  it("systemd unit has the right Restart and ExecStart", () => {
    const unit = renderSystemdUnit({ bin: "/usr/local/bin/synapse", log: "/tmp/x.log" });
    expect(unit).toContain("ExecStart=/usr/local/bin/synapse daemon");
    expect(unit).toContain("Restart=always");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function renderLaunchdPlist(a: { bin: string; log: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyLists-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.synapsesync.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${a.bin}</string><string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>${a.log}</string>
  <key>StandardOutPath</key><string>${a.log}</string>
</dict>
</plist>`;
}

export function renderSystemdUnit(a: { bin: string; log: string }): string {
  return `[Unit]
Description=Synapse capture and handoff daemon
After=network.target

[Service]
ExecStart=${a.bin} daemon
Restart=always
RestartSec=5
StandardOutput=append:${a.log}
StandardError=append:${a.log}

[Install]
WantedBy=default.target
`;
}

export function writeServiceFile(): { platform: string; path: string } {
  const bin = process.execPath; // node binary; CLI is via `node /path/to/cli`
  // For production install, prefer the linked global bin from npm install -g
  const synapseBin = `node ${path.resolve(__dirname, "../cli/commands.js")}`;
  const log = path.join(os.homedir(), ".synapse", "daemon.log");

  if (process.platform === "darwin") {
    const p = path.join(os.homedir(), "Library/LaunchAgents/app.synapsesync.daemon.plist");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderLaunchdPlist({ bin: synapseBin, log }));
    return { platform: "darwin", path: p };
  }
  if (process.platform === "linux") {
    const p = path.join(os.homedir(), ".config/systemd/user/synapsesync.service");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, renderSystemdUnit({ bin: synapseBin, log }));
    return { platform: "linux", path: p };
  }
  throw new Error(`Unsupported platform: ${process.platform}. Run \`synapse daemon\` manually until Windows service support lands.`);
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/capture/os-service.test.ts
git add mcp/src/capture/os-service.ts mcp/test/capture/os-service.test.ts
git commit -m "feat(mcp): generate launchd/systemd unit files for daemon"
```

---

### Task 16: `synapse init` installer

**Files:**
- Create: `mcp/src/cli/init.ts`
- Test: `mcp/test/cli/init.test.ts`
- Modify: `mcp/src/cli/commands.ts` to register

- [ ] **Step 1: Write failing test**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../../src/cli/init.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-init-");
  process.env.HOME = tmp;
  process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("synapse init", () => {
  it("creates ~/.claude/settings.json with handoff hooks chained", async () => {
    await runInit({ api_key: "k", skip_service: true });
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf-8"));
    expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);
    expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("synapse");
  });

  it("preserves existing hooks (chains new ones, does not replace)", async () => {
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".claude/settings.json"), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo existing" }] }] },
    }));
    await runInit({ api_key: "k", skip_service: true });
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, ".claude/settings.json"), "utf-8"));
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("echo existing");
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("synapse");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeServiceFile } from "../capture/os-service.js";

interface InitArgs { api_key: string; skip_service?: boolean }

const HOOK_BIN = "synapse";  // assumes PATH; in dev, replace with absolute node invocation

const HOOK_DEFS = {
  SessionStart: { command: `${HOOK_BIN} hook session-start` },
  UserPromptSubmit: { command: `${HOOK_BIN} hook user-prompt-submit` },
  PostToolUse: { command: `${HOOK_BIN} hook post-tool-use`, matcher: "Bash|Edit|Write|MultiEdit|TaskCreate|TaskUpdate|Agent" },
  PreCompact: { command: `${HOOK_BIN} hook pre-compact` },
  SessionEnd: { command: `${HOOK_BIN} hook session-end` },
  SubagentStop: { command: `${HOOK_BIN} hook subagent-stop` },
};

export async function runInit(a: InitArgs): Promise<void> {
  installHooks();
  writeConfig(a.api_key);
  if (!a.skip_service) {
    const svc = writeServiceFile();
    console.log(`[synapse init] OS service registered: ${svc.path}`);
  }
}

function installHooks(): void {
  const settingsPath = path.join(os.homedir(), ".claude/settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf-8")) : {};
  settings.hooks ??= {};

  for (const [event, def] of Object.entries(HOOK_DEFS)) {
    settings.hooks[event] ??= [];
    const alreadyInstalled = JSON.stringify(settings.hooks[event]).includes(`${HOOK_BIN} hook ${def.command.split(" ").slice(-1)[0]}`);
    if (alreadyInstalled) continue;
    const block: any = { hooks: [{ type: "command", command: def.command }] };
    if ("matcher" in def) block.matcher = def.matcher;
    settings.hooks[event].push(block);
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function writeConfig(api_key: string): void {
  const dir = path.join(os.homedir(), ".synapse");
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {};
  existing.api_key = api_key;
  existing.daemon ??= { ai_enabled: false, monthly_budget_usd: 5, model: "haiku" };
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
```

- [ ] **Step 3: Wire into commands.ts**

In `mcp/src/cli/commands.ts`, add an `init` subcommand that prompts for or accepts an API key and calls `runInit`.

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run mcp/test/cli/init.test.ts
git add mcp/src/cli/init.ts mcp/src/cli/commands.ts mcp/test/cli/init.test.ts
git commit -m "feat(mcp): synapse init installs hooks and OS service"
```

---

## Phase F — Full hook implementations

### Task 17: UserPromptSubmit with status-update injection

**Files:**
- Create: `mcp/src/hooks/user-prompt-submit.ts`
- Test: `mcp/test/hooks/user-prompt-submit.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUserPromptSubmitHook } from "../../src/hooks/user-prompt-submit.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-ups-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("UserPromptSubmit hook", () => {
  it("emits user_prompted event with truncated excerpt", () => {
    runUserPromptSubmitHook({ project_id: "p", user_id: "u", session_id: "s", prompt: "a".repeat(200), stdout: nullStream() });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("user_prompted");
    expect((ev.payload.prompt_excerpt as string).length).toBe(80);
  });

  it("injects <synapse-status-update> when gap exceeds threshold", () => {
    fs.mkdirSync(path.join(tmp, "projects/p/cache"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/cache/project_status.json"), JSON.stringify(stubStatus()));
    fs.writeFileSync(path.join(tmp, "projects/p/last_injection.txt"), new Date(Date.now() - 90 * 60 * 1000).toISOString());

    const out: string[] = [];
    runUserPromptSubmitHook({ project_id: "p", user_id: "u", session_id: "s", prompt: "ok", stdout: writeStream(out) });
    expect(out.join("")).toContain("<synapse-status-update>");
  });

  it("does NOT inject when gap is below threshold", () => {
    fs.mkdirSync(path.join(tmp, "projects/p/cache"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/cache/project_status.json"), JSON.stringify(stubStatus()));
    fs.writeFileSync(path.join(tmp, "projects/p/last_injection.txt"), new Date().toISOString());
    const out: string[] = [];
    runUserPromptSubmitHook({ project_id: "p", user_id: "u", session_id: "s", prompt: "ok", stdout: writeStream(out) });
    expect(out.join("")).not.toContain("<synapse-status-update>");
  });
});

function nullStream() { return { write: () => true } as unknown as NodeJS.WriteStream; }
function writeStream(arr: string[]) { return { write: (s: string) => { arr.push(s); return true; } } as unknown as NodeJS.WriteStream; }
function stubStatus() { return { project_id: "p", current_next_step: null, active_actors: [], recent_activity: [], open_issues: { decisions: [], questions: [] }, open_subtasks: [], updated_at: "t" }; }
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { projectDir, statusCachePath } from "../capture/handoff-paths.js";
import { renderBriefFromCache } from "../capture/handoff-brief.js";

const INJECTION_THRESHOLD_MS = 60 * 60 * 1000; // 60 min

interface Args { project_id: string; user_id: string; session_id: string; prompt: string; stdout: NodeJS.WriteStream }

export function runUserPromptSubmitHook(a: Args): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  const actor = resolveActor(a.user_id);
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor, attached_to: null,
    kind: EventKind.UserPrompted, occurred_at: new Date().toISOString(),
    payload: { prompt_excerpt: a.prompt.slice(0, 80) },
  });

  const injectPath = path.join(projectDir(a.project_id), "last_injection.txt");
  const last = fs.existsSync(injectPath) ? new Date(fs.readFileSync(injectPath, "utf-8").trim()).getTime() : 0;
  if (Date.now() - last < INJECTION_THRESHOLD_MS) return;

  if (!fs.existsSync(statusCachePath(a.project_id))) return;
  const brief = renderBriefFromCache(a.project_id, a.user_id);
  a.stdout.write(`<synapse-status-update>\n${brief}\n</synapse-status-update>\n`);
  fs.writeFileSync(injectPath, new Date().toISOString());
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/hooks/user-prompt-submit.test.ts
git add mcp/src/hooks/user-prompt-submit.ts mcp/test/hooks/user-prompt-submit.test.ts
git commit -m "feat(mcp): UserPromptSubmit hook emits user_prompted and injects status updates after idle"
```

---

### Task 18: PreCompact, SessionEnd, SubagentStop hooks

**Files:**
- Create: `mcp/src/hooks/pre-compact.ts`
- Create: `mcp/src/hooks/session-end.ts`
- Create: `mcp/src/hooks/subagent-stop.ts`
- Test: `mcp/test/hooks/lifecycle.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPreCompactHook } from "../../src/hooks/pre-compact.js";
import { runSessionEndHook } from "../../src/hooks/session-end.js";
import { runSubagentStopHook } from "../../src/hooks/subagent-stop.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-lc-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("PreCompact hook", () => {
  it("emits context_compacted event and touches daemon-flush-now signal", () => {
    runPreCompactHook({ project_id: "p", user_id: "u", session_id: "s" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("context_compacted");
    expect(fs.existsSync(path.join(tmp, "daemon-flush-now"))).toBe(true);
  });
});

describe("SessionEnd hook", () => {
  it("emits session_closed event and touches flush signal", () => {
    runSessionEndHook({ project_id: "p", user_id: "u", session_id: "s" });
    const events = fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").split("\n").filter(Boolean);
    expect(JSON.parse(events[0]).kind).toBe("session_closed");
    expect(fs.existsSync(path.join(tmp, "daemon-flush-now"))).toBe(true);
  });
});

describe("SubagentStop hook", () => {
  it("emits tool_used event tagged with subagent name", () => {
    runSubagentStopHook({ project_id: "p", user_id: "u", session_id: "s", subagent: "Explore" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.payload.tool).toBe("Agent");
    expect(ev.payload.subagent).toBe("Explore");
  });
});
```

- [ ] **Step 2: Implement each hook**

`mcp/src/hooks/pre-compact.ts`:

```ts
import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

export function runPreCompactHook(a: { project_id: string; user_id: string; session_id: string }): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: null,
    kind: EventKind.ContextCompacted, occurred_at: new Date().toISOString(), payload: {},
  });
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}
```

`mcp/src/hooks/session-end.ts`:

```ts
import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

export function runSessionEndHook(a: { project_id: string; user_id: string; session_id: string }): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: null,
    kind: EventKind.SessionClosed, occurred_at: new Date().toISOString(), payload: { clean: true },
  });
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}
```

`mcp/src/hooks/subagent-stop.ts`:

```ts
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { projectDir } from "../capture/handoff-paths.js";

export function runSubagentStopHook(a: { project_id: string; user_id: string; session_id: string; subagent: string }): void {
  if (process.env.SYNAPSE_DAEMON_SESSION === "1") return;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: null,
    kind: EventKind.ToolUsed, occurred_at: new Date().toISOString(),
    payload: { tool: "Agent", subagent: a.subagent },
  });
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/hooks/lifecycle.test.ts
git add mcp/src/hooks/pre-compact.ts mcp/src/hooks/session-end.ts mcp/src/hooks/subagent-stop.ts mcp/test/hooks/lifecycle.test.ts
git commit -m "feat(mcp): PreCompact, SessionEnd, SubagentStop hooks"
```

---

## Phase G — CLI authored commands

### Task 19: `synapse handoff`, `set-focus`, `note`

**Files:**
- Create: `mcp/src/cli/handoff-commands.ts`
- Test: `mcp/test/cli/handoff-commands.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffCmd, runSetFocusCmd, runNoteCmd } from "../../src/cli/handoff-commands.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-hc-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("handoff CLI", () => {
  it("synapse handoff writes next_step_set event", async () => {
    await runHandoffCmd({ project_id: "p", user_id: "u", session_id: "s", text: "wire /callback" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("next_step_set");
    expect(ev.payload.text).toBe("wire /callback");
  });

  it("synapse set-focus writes focus_set event", async () => {
    await runSetFocusCmd({ project_id: "p", user_id: "u", session_id: "s", text: "OAuth wiring" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("focus_set");
  });

  it("synapse note writes issue_noted event with object ref", async () => {
    await runNoteCmd({ project_id: "p", user_id: "u", session_id: "s", target: "issue:12", text: "FYI" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("issue_noted");
    expect(ev.payload.target).toBe("issue:12");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { resolveActor } from "../capture/actor.js";
import { appendEvent } from "../capture/events-log.js";
import { flushNowSignalPath, projectDir, synapseRoot } from "../capture/handoff-paths.js";

function signalFlush(): void {
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(flushNowSignalPath(), "");
}

interface Base { project_id: string; user_id: string; session_id: string }

export async function runHandoffCmd(a: Base & { text: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: null,
    kind: EventKind.NextStepSet, occurred_at: new Date().toISOString(), payload: { text: a.text },
  });
  signalFlush();
}

export async function runSetFocusCmd(a: Base & { text: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: null,
    kind: EventKind.FocusSet, occurred_at: new Date().toISOString(), payload: { text: a.text },
  });
  signalFlush();
}

export async function runNoteCmd(a: Base & { target: string; text: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: parseRef(a.target),
    kind: EventKind.IssueNoted, occurred_at: new Date().toISOString(), payload: { target: a.target, text: a.text },
  });
  signalFlush();
}

function parseRef(s: string): { type: "session" | "issue" | "file" | "commit"; id: string } | null {
  const m = s.match(/^(session|issue|file|commit):(.+)$/);
  return m ? { type: m[1] as any, id: m[2] } : null;
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/cli/handoff-commands.test.ts
git add mcp/src/cli/handoff-commands.ts mcp/test/cli/handoff-commands.test.ts
git commit -m "feat(mcp): synapse handoff / set-focus / note CLI subcommands"
```

---

### Task 20: `synapse issue` subcommands

**Files:**
- Extend: `mcp/src/cli/handoff-commands.ts` (add `runIssueCreate`, `runIssueResolve`, `runIssueSupersede`)
- Test: `mcp/test/cli/issue-commands.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIssueCreate, runIssueResolve, runIssueSupersede } from "../../src/cli/handoff-commands.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-issue-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("synapse issue", () => {
  it("create emits issue_created with kind and title", async () => {
    await runIssueCreate({ project_id: "p", user_id: "u", session_id: "s", kind: "decision", title: "Use JWT", body: "" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").trim());
    expect(ev.kind).toBe("issue_created");
    expect(ev.payload.kind).toBe("decision");
  });

  it("resolve emits issue_state_changed → resolved", async () => {
    await runIssueResolve({ project_id: "p", user_id: "u", session_id: "s", issue_id: "i1", resolution: "going with JWT" });
    const lines = fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").split("\n").filter(Boolean);
    const ev = JSON.parse(lines[lines.length - 1]);
    expect(ev.kind).toBe("issue_state_changed");
    expect(ev.payload.state).toBe("resolved");
  });

  it("supersede emits issue_state_changed → superseded with replacement ref", async () => {
    await runIssueSupersede({ project_id: "p", user_id: "u", session_id: "s", issue_id: "i1", superseded_by: "i2" });
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, "projects/p/events.jsonl"), "utf-8").split("\n").filter(Boolean).at(-1)!);
    expect(ev.payload.state).toBe("superseded");
    expect(ev.payload.superseded_by).toBe("i2");
  });
});
```

- [ ] **Step 2: Implement**

Append to `mcp/src/cli/handoff-commands.ts`:

```ts
import { randomBytes } from "node:crypto";

function issueId(): string { return `iss_${randomBytes(6).toString("hex")}`; }

export async function runIssueCreate(a: Base & { kind: "decision" | "question"; title: string; body: string }): Promise<void> {
  const id = issueId();
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: { type: "issue", id },
    kind: EventKind.IssueCreated, occurred_at: new Date().toISOString(),
    payload: { id, number: 0 /* server assigns */, kind: a.kind, title: a.title, body: a.body },
  });
  signalFlush();
}

export async function runIssueResolve(a: Base & { issue_id: string; resolution: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: { type: "issue", id: a.issue_id },
    kind: EventKind.IssueStateChanged, occurred_at: new Date().toISOString(),
    payload: { id: a.issue_id, state: "resolved", resolution: a.resolution },
  });
  signalFlush();
}

export async function runIssueSupersede(a: Base & { issue_id: string; superseded_by: string }): Promise<void> {
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: a.session_id, actor: resolveActor(a.user_id), attached_to: { type: "issue", id: a.issue_id },
    kind: EventKind.IssueStateChanged, occurred_at: new Date().toISOString(),
    payload: { id: a.issue_id, state: "superseded", superseded_by: a.superseded_by },
  });
  signalFlush();
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/cli/issue-commands.test.ts
git add mcp/src/cli/handoff-commands.ts mcp/test/cli/issue-commands.test.ts
git commit -m "feat(mcp): synapse issue create/resolve/supersede CLI subcommands"
```

---

### Task 21: `synapse status` and `synapse doctor`

**Files:**
- Create: `mcp/src/cli/status.ts`
- Create: `mcp/src/cli/doctor.ts`
- Test: `mcp/test/cli/status.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStatus, runDoctor } from "../../src/cli/status.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-status-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("synapse status", () => {
  it("shows healthy when healthcheck is fresh", async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date().toISOString());
    const out = await runStatus();
    expect(out).toContain("Daemon: healthy");
  });

  it("shows stale when healthcheck is older than 60s", async () => {
    fs.writeFileSync(path.join(tmp, "daemon.healthcheck"), new Date(Date.now() - 120_000).toISOString());
    const out = await runStatus();
    expect(out).toContain("Daemon: STALE");
  });
});

describe("synapse doctor", () => {
  it("reports project count, last push, last pull, queued events", async () => {
    fs.mkdirSync(path.join(tmp, "projects/p"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "projects/p/events.jsonl"), JSON.stringify({ event_id: "x" }) + "\n");
    const out = await runDoctor();
    expect(out).toContain("Projects tracked: 1");
    expect(out).toContain("Queued events");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// status.ts
import fs from "node:fs";
import path from "node:path";
import { healthcheckPath, synapseRoot } from "../capture/handoff-paths.js";

export async function runStatus(): Promise<string> {
  const hcPath = healthcheckPath();
  let line = "Daemon: not running";
  if (fs.existsSync(hcPath)) {
    const ts = new Date(fs.readFileSync(hcPath, "utf-8").trim()).getTime();
    const age = Date.now() - ts;
    line = age < 60_000 ? "Daemon: healthy" : "Daemon: STALE";
  }
  const projects = listProjects();
  return `${line}. Projects tracked: ${projects.length}.`;
}

export async function runDoctor(): Promise<string> {
  const lines: string[] = [];
  lines.push(await runStatus());
  lines.push(`Projects tracked: ${listProjects().length}`);
  for (const p of listProjects()) {
    const eventsPath = path.join(synapseRoot(), "projects", p, "events.jsonl");
    const wmPath = path.join(synapseRoot(), "projects", p, ".watermark");
    const queued = countQueued(eventsPath, wmPath);
    lines.push(`  ${p}: Queued events: ${queued}`);
  }
  return lines.join("\n");
}

function listProjects(): string[] {
  const dir = path.join(synapseRoot(), "projects");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

function countQueued(events: string, watermark: string): number {
  if (!fs.existsSync(events)) return 0;
  const all = fs.readFileSync(events, "utf-8").split("\n").filter(Boolean);
  if (!fs.existsSync(watermark)) return all.length;
  const wm = fs.readFileSync(watermark, "utf-8").trim();
  return all.filter((line) => JSON.parse(line).event_id > wm).length;
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/cli/status.test.ts
git add mcp/src/cli/status.ts mcp/test/cli/status.test.ts
git commit -m "feat(mcp): synapse status and synapse doctor commands"
```

---

## Phase H — Daemon-fired Claude Code

### Task 22: Sandbox profile and CC spawner

**Files:**
- Create: `mcp/src/capture/daemon-cc.ts`
- Test: `mcp/test/capture/daemon-cc.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeDaemonCcProfile, spawnInferNextStep } from "../../src/capture/daemon-cc.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-cc-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("daemon-cc", () => {
  it("writeDaemonCcProfile produces a profile that disables file-mutating tools", () => {
    const p = writeDaemonCcProfile();
    const profile = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(profile.permissions.deny).toContain("Edit");
    expect(profile.permissions.deny).toContain("Write");
    expect(profile.permissions.deny).toContain("Bash");
  });

  it("spawnInferNextStep invokes child with SYNAPSE_DAEMON_SESSION=1 env", async () => {
    const calls: any[] = [];
    const fakeSpawn = vi.fn((cmd: string, args: string[], opts: any) => {
      calls.push({ cmd, args, env: opts.env });
      return { on: (event: string, cb: any) => { if (event === "close") setImmediate(() => cb(0)); }, stdout: { on: () => {} }, stderr: { on: () => {} }, stdin: { end: () => {} } } as any;
    });
    await spawnInferNextStep({ project_id: "p", recent_events_summary: "foo", spawn: fakeSpawn });
    expect(calls[0].env.SYNAPSE_DAEMON_SESSION).toBe("1");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { synapseRoot } from "./handoff-paths.js";

export function writeDaemonCcProfile(): string {
  const p = path.join(synapseRoot(), "daemon-cc-profile.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const profile = {
    permissions: { deny: ["Edit", "Write", "MultiEdit", "Bash", "NotebookEdit", "Agent", "WebFetch"], allow: ["Read"] },
    model: "claude-haiku-4-5-20251001",
  };
  fs.writeFileSync(p, JSON.stringify(profile, null, 2));
  return p;
}

interface SpawnArgs {
  project_id: string;
  recent_events_summary: string;
  spawn?: typeof nodeSpawn;
  bin?: string;
  on_stdout?: (chunk: string) => void;
}

export async function spawnInferNextStep(a: SpawnArgs): Promise<string> {
  const spawnFn = a.spawn ?? nodeSpawn;
  const bin = a.bin ?? "claude";
  const profile = writeDaemonCcProfile();
  const prompt = `Given the following recent activity on this project, write ONE concise sentence describing what a teammate would need to do next to continue. Reply with the sentence and nothing else.\n\n---\n${a.recent_events_summary}\n---`;
  return await new Promise((resolve, reject) => {
    const child = spawnFn(bin, ["-p", prompt, "--config", profile, "--max-turns", "1"], {
      env: { ...process.env, SYNAPSE_DAEMON_SESSION: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString(); a.on_stdout?.(chunk.toString()); });
    child.on("error", reject);
    child.on("close", (code: number) => code === 0 ? resolve(out.trim()) : reject(new Error(`claude exited ${code}`)));
  });
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/capture/daemon-cc.test.ts
git add mcp/src/capture/daemon-cc.ts mcp/test/capture/daemon-cc.test.ts
git commit -m "feat(mcp): daemon-fired Claude Code with sandbox profile and loop-prevention env"
```

---

### Task 23: Idle detection + auto next_step_inferred trigger

**Files:**
- Modify: `mcp/src/capture/daemon.ts` (extend handoff loop)
- Test: `mcp/test/capture/idle-trigger.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// Place a project with events showing actor idle >30 min and no explicit next_step_set.
// Run a cycle. Assert daemon-cc was invoked, output written as next_step_inferred event.

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeFireInferNextStep } from "../../src/capture/daemon.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-idle-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("auto-infer next_step", () => {
  it("does not fire when ai_enabled=false", async () => {
    const spy = vi.fn();
    await maybeFireInferNextStep({ project_id: "p1", ai_enabled: false, idle_threshold_ms: 1000, spawnFn: spy as any });
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not fire when an explicit next_step_set was made within idle window", async () => {
    setupEvents(tmp, "p2", [
      { kind: "user_prompted", occurred_at: minutesAgo(45) },
      { kind: "next_step_set", occurred_at: minutesAgo(40), payload: { text: "explicit" } },
    ]);
    const spy = vi.fn();
    await maybeFireInferNextStep({ project_id: "p2", ai_enabled: true, idle_threshold_ms: 30 * 60_000, spawnFn: spy as any });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fires when idle >threshold and no explicit handoff", async () => {
    setupEvents(tmp, "p3", [{ kind: "user_prompted", occurred_at: minutesAgo(45) }]);
    const stub = vi.fn(async () => "wire /callback");
    await maybeFireInferNextStep({ project_id: "p3", ai_enabled: true, idle_threshold_ms: 30 * 60_000, spawnFn: stub as any });
    expect(stub).toHaveBeenCalled();
    const events = fs.readFileSync(path.join(tmp, "projects/p3/events.jsonl"), "utf-8").split("\n").filter(Boolean).map(JSON.parse);
    expect(events.at(-1).kind).toBe("next_step_inferred");
  });
});

function minutesAgo(m: number) { return new Date(Date.now() - m * 60_000).toISOString(); }
function setupEvents(home: string, pid: string, events: any[]) {
  const dir = path.join(home, "projects", pid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "events.jsonl"), events.map(e => JSON.stringify({
    event_id: Math.random().toString(36).slice(2), project_id: pid, session_id: "s",
    actor: { user_id: "tanmai", kind: "human", device_id: "d", hostname: "h", client: "claude-code" },
    attached_to: null, payload: {}, received_at: e.occurred_at, ...e,
  })).join("\n") + "\n");
}
```

- [ ] **Step 2: Implement `maybeFireInferNextStep` in daemon.ts**

```ts
import { EventKind } from "@synapse/shared/handoff/events.js";
import { spawnInferNextStep } from "./daemon-cc.js";
import { appendEvent, readEvents } from "./events-log.js";
import { projectDir } from "./handoff-paths.js";

export interface FireArgs {
  project_id: string;
  ai_enabled: boolean;
  idle_threshold_ms: number;
  spawnFn?: typeof spawnInferNextStep;
}

export async function maybeFireInferNextStep(a: FireArgs): Promise<void> {
  if (!a.ai_enabled) return;
  const events = readEvents(projectDir(a.project_id));
  if (events.length === 0) return;

  const lastEvent = events.at(-1)!;
  const lastEventTime = new Date(lastEvent.occurred_at).getTime();
  if (Date.now() - lastEventTime < a.idle_threshold_ms) return;

  const sinceIdle = events.filter((e) => new Date(e.occurred_at).getTime() >= lastEventTime - a.idle_threshold_ms);
  if (sinceIdle.some((e) => e.kind === EventKind.NextStepSet)) return;

  const summary = events.slice(-30).map((e) => `${e.kind}: ${JSON.stringify(e.payload).slice(0, 80)}`).join("\n");
  const fn = a.spawnFn ?? spawnInferNextStep;
  const text = await fn({ project_id: a.project_id, recent_events_summary: summary });

  if (!text || text.length === 0) return;

  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: "daemon", attached_to: null,
    actor: { user_id: lastEvent.actor.user_id, kind: "synapse-daemon", device_id: "daemon", hostname: "daemon", client: "claude-code" },
    kind: EventKind.NextStepInferred, occurred_at: new Date().toISOString(),
    payload: { text, on_behalf_of: lastEvent.actor.user_id },
  });
}
```

Wire it into `startHandoffLoop` cycle: after each pull, call `maybeFireInferNextStep` if config has `daemon.ai_enabled = true`.

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/capture/idle-trigger.test.ts
git add mcp/src/capture/daemon.ts mcp/test/capture/idle-trigger.test.ts
git commit -m "feat(mcp): daemon fires CC to infer next_step after actor idle threshold"
```

---

### Task 24: Cost tracking and budget cap

**Files:**
- Modify: `mcp/src/capture/daemon-cc.ts` (record cost via events)
- Modify: `mcp/src/cli/status.ts` (surface monthly cost)
- Test: `mcp/test/capture/cost.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordRunStart, recordRunComplete, getMonthlyCostUsd } from "../../src/capture/daemon-cc.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/synapse-cost-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("cost tracking", () => {
  it("recordRunStart + recordRunComplete write events; getMonthlyCostUsd sums them", () => {
    const id = recordRunStart({ project_id: "p", purpose: "next_step_inferred" });
    recordRunComplete({ project_id: "p", run_id: id, input_tokens: 1000, output_tokens: 200, model: "haiku" });
    const cost = getMonthlyCostUsd();
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// Add to daemon-cc.ts

const HAIKU_INPUT_PER_MTOK = 0.80;
const HAIKU_OUTPUT_PER_MTOK = 4.00;
const SONNET_INPUT_PER_MTOK = 3.00;
const SONNET_OUTPUT_PER_MTOK = 15.00;

export function recordRunStart(a: { project_id: string; purpose: string }): string {
  const run_id = Math.random().toString(36).slice(2);
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: "daemon", actor: daemonActor(), attached_to: null,
    kind: EventKind.DaemonRunStarted, occurred_at: new Date().toISOString(),
    payload: { run_id, purpose: a.purpose },
  });
  return run_id;
}

export function recordRunComplete(a: { project_id: string; run_id: string; input_tokens: number; output_tokens: number; model: "haiku" | "sonnet" }): void {
  const inputRate = a.model === "haiku" ? HAIKU_INPUT_PER_MTOK : SONNET_INPUT_PER_MTOK;
  const outputRate = a.model === "haiku" ? HAIKU_OUTPUT_PER_MTOK : SONNET_OUTPUT_PER_MTOK;
  const cost = (a.input_tokens / 1_000_000) * inputRate + (a.output_tokens / 1_000_000) * outputRate;
  appendEvent(projectDir(a.project_id), {
    project_id: a.project_id, session_id: "daemon", actor: daemonActor(), attached_to: null,
    kind: EventKind.DaemonRunCompleted, occurred_at: new Date().toISOString(),
    payload: { run_id: a.run_id, input_tokens: a.input_tokens, output_tokens: a.output_tokens, model: a.model, cost_usd: cost },
  });
}

export function getMonthlyCostUsd(): number {
  const dir = path.join(synapseRoot(), "projects");
  if (!fs.existsSync(dir)) return 0;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  let total = 0;
  for (const p of fs.readdirSync(dir)) {
    const events = readEvents(path.join(dir, p));
    for (const e of events) {
      if (e.kind === EventKind.DaemonRunCompleted && new Date(e.occurred_at).getTime() >= monthStart) {
        total += Number((e.payload as any).cost_usd ?? 0);
      }
    }
  }
  return total;
}

function daemonActor() { return { user_id: "daemon", kind: "synapse-daemon" as const, device_id: "daemon", hostname: "daemon", client: "claude-code" }; }
```

In `maybeFireInferNextStep` (Task 23), wrap the spawn:

```ts
const run_id = recordRunStart({ project_id: a.project_id, purpose: "next_step_inferred" });
const text = await fn({ project_id: a.project_id, recent_events_summary: summary });
// Token-count estimation for v1: ~4 chars per token (industry rule-of-thumb).
// Replace with real counts once claude --output-format stream-json wiring is added.
recordRunComplete({ project_id: a.project_id, run_id, input_tokens: estimateTokens(summary), output_tokens: estimateTokens(text), model: "haiku" });
```

And before spawning: check `getMonthlyCostUsd() < budget`.

- [ ] **Step 3: Update `runDoctor` to show cost**

In `mcp/src/cli/status.ts`, add: `lines.push(`Monthly daemon cost: $${getMonthlyCostUsd().toFixed(4)}`);`

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run mcp/test/capture/cost.test.ts
git add mcp/src/capture/daemon-cc.ts mcp/src/capture/daemon.ts mcp/src/cli/status.ts mcp/test/capture/cost.test.ts
git commit -m "feat(mcp): track daemon-fired CC cost and enforce monthly budget cap"
```

---

## Phase I — Migration & E2E

### Task 25: Verify save_insight legacy path still functions

**Files:**
- Test: `backend/test/api/insights-compat.test.ts`

- [ ] **Step 1: Write the compatibility test**

```ts
import { describe, expect, it } from "vitest";
import { app } from "../../src/index.js";

describe("save_insight legacy compatibility", () => {
  it("save_insight endpoint still accepts the legacy payload and returns 200", async () => {
    const res = await app.request("/api/insights", {
      method: "POST",
      headers: { Authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ project: "p", type: "decision", summary: "x", detail: "y" }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run, fix any drift, commit**

```bash
npx vitest run backend/test/api/insights-compat.test.ts
git add backend/test/api/insights-compat.test.ts
git commit -m "test(backend): assert save_insight legacy compatibility under handoff schema additions"
```

---

### Task 26: End-to-end two-device handoff scenario

**Files:**
- Create: `mcp/test/e2e/handoff.e2e.test.ts`

- [ ] **Step 1: Write the E2E test (the literal §11.4 acceptance criterion)**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSessionStartHook } from "../../src/hooks/session-start.js";
import { runPostToolUseHook } from "../../src/hooks/post-tool-use.js";
import { runHandoffCmd } from "../../src/cli/handoff-commands.js";
import { runFlushCycle, runPullCycle } from "../../src/capture/handoff-sync.js";
import { writeBrief } from "../../src/capture/handoff-brief.js";
import { startStubBackend } from "./stub-backend.js"; // helper that runs the reducer in-process

let stubUrl: string; let stop: () => void;
let tanmaiHome: string; let alexHome: string;

beforeEach(async () => {
  ({ url: stubUrl, stop } = await startStubBackend());
  tanmaiHome = fs.mkdtempSync("/tmp/syn-tanmai-");
  alexHome = fs.mkdtempSync("/tmp/syn-alex-");
});

afterEach(() => {
  stop();
  for (const h of [tanmaiHome, alexHome]) fs.rmSync(h, { recursive: true, force: true });
});

describe("E2E: Tanmai-Monday → Alex-Tuesday handoff", () => {
  it("Alex's brief contains Tanmai's authored next_step", async () => {
    // -------- Monday: Tanmai --------
    process.env.SYNAPSE_HOME = tanmaiHome;
    const tanmaiStdout: string[] = [];
    await runSessionStartHook({ project_id: "p1", user_id: "tanmai",
      stdout: { write: (s) => tanmaiStdout.push(s) > 0 } as any, skipFallback: true });

    runPostToolUseHook({ project_id: "p1", user_id: "tanmai", session_id: "s1", tool: "Edit", input: { file_path: "auth/oauth-callback.ts" }, output: {} });
    runPostToolUseHook({ project_id: "p1", user_id: "tanmai", session_id: "s1", tool: "Bash", input: { command: "git checkout feature/oauth" }, output: { stdout: "Switched to branch 'feature/oauth'" } });

    await runHandoffCmd({ project_id: "p1", user_id: "tanmai", session_id: "s1", text: "wire /callback to user repo; tests pass at HEAD" });
    await runFlushCycle({ project_id: "p1", api_key: "k", api_url: stubUrl });

    // -------- Tuesday: Alex --------
    process.env.SYNAPSE_HOME = alexHome;
    await runPullCycle({ project_id: "p1", api_key: "k", api_url: stubUrl });
    writeBrief("p1", "alex");

    const alexStdout: string[] = [];
    await runSessionStartHook({ project_id: "p1", user_id: "alex",
      stdout: { write: (s) => alexStdout.push(s) > 0 } as any });
    const brief = alexStdout.join("");

    expect(brief).toContain("wire /callback to user repo");
    expect(brief).toContain("tanmai");
    expect(brief).toMatch(/feature\/oauth|OAuth/);
  });
});
```

Also create `mcp/test/e2e/stub-backend.ts` — a tiny in-process HTTP server that:
- Exposes `POST /api/events/batch` and `GET /api/projects/:id/status`
- Maintains an in-memory event store
- Runs the shared `reduce()` to compute ProjectStatus on demand

```ts
import http from "node:http";
import { reduce } from "@synapse/shared/handoff/reducer.js";
import type { Event } from "@synapse/shared/handoff/types.js";

export async function startStubBackend(): Promise<{ url: string; stop: () => void }> {
  const events: Event[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url?.endsWith("/api/events/batch") && req.method === "POST") {
      const body = await readBody(req);
      const { events: batch } = JSON.parse(body);
      for (const e of batch) events.push({ ...e, received_at: new Date().toISOString() });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: batch.length, duplicates: 0 }));
      return;
    }
    const m = req.url?.match(/\/api\/projects\/([^/]+)\/status$/);
    if (m && req.method === "GET") {
      const status = reduce(events.filter((e) => e.project_id === m[1]), m[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(status));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  return { url: `http://127.0.0.1:${port}`, stop: () => server.close() };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });
}
```

- [ ] **Step 2: Run E2E, fix issues, commit**

```bash
npx vitest run mcp/test/e2e/handoff.e2e.test.ts
git add mcp/test/e2e
git commit -m "test(mcp): E2E two-device handoff scenario (§11.4 acceptance criterion)"
```

---

### Task 27: Daemon crash resilience test

**Files:**
- Test: `mcp/test/capture/crash-resilience.test.ts`

- [ ] **Step 1: Write the test (§11.5 acceptance criterion)**

```ts
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent } from "../../src/capture/events-log.js";
import { runFlushCycle } from "../../src/capture/handoff-sync.js";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync("/tmp/syn-crash-"); process.env.SYNAPSE_HOME = tmp; });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("crash resilience", () => {
  it("survives interrupted flush and resumes from watermark on next cycle", async () => {
    const flushed: any[] = [];
    let callCount = 0;
    global.fetch = (async () => {
      callCount++;
      if (callCount === 1) throw new Error("network kill");
      return new Response(JSON.stringify({ accepted: 2 }), { status: 200 });
    }) as any;

    const dir = path.join(tmp, "projects/p");
    fs.mkdirSync(dir, { recursive: true });
    appendEvent(dir, makeEv("a"));
    appendEvent(dir, makeEv("b"));

    await expect(runFlushCycle({ project_id: "p", api_key: "k", api_url: "http://x" })).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, ".watermark"))).toBe(false);

    await runFlushCycle({ project_id: "p", api_key: "k", api_url: "http://x" });
    const wm = fs.readFileSync(path.join(dir, ".watermark"), "utf-8").trim();
    expect(wm).toMatch(/.+/); // some event id is now the watermark; nothing was lost
  });
});

function makeEv(id: string) { return { project_id: "p", session_id: "s", actor: actor(), attached_to: null, kind: "tool_used" as const, occurred_at: new Date().toISOString(), payload: {} }; }
function actor() { return { user_id: "u", kind: "human" as const, device_id: "d", hostname: "h", client: "claude-code" }; }
```

- [ ] **Step 2: Run, commit**

```bash
npx vitest run mcp/test/capture/crash-resilience.test.ts
git add mcp/test/capture/crash-resilience.test.ts
git commit -m "test(mcp): daemon survives mid-flush failure and resumes from watermark"
```

---

### Task 28: Sandbox enforcement test

**Files:**
- Test: `mcp/test/capture/sandbox.test.ts`

- [ ] **Step 1: Write the test (§11.7 acceptance criterion)**

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeDaemonCcProfile } from "../../src/capture/daemon-cc.js";

describe("daemon-CC sandbox profile", () => {
  it("denies all file-mutating tools and allows only Read", () => {
    const p = writeDaemonCcProfile();
    const profile = JSON.parse(fs.readFileSync(p, "utf-8"));
    const mutators = ["Edit", "Write", "MultiEdit", "Bash", "NotebookEdit", "Agent"];
    for (const m of mutators) expect(profile.permissions.deny).toContain(m);
    expect(profile.permissions.allow).toEqual(["Read"]);
  });
});
```

- [ ] **Step 2: Run, commit**

```bash
npx vitest run mcp/test/capture/sandbox.test.ts
git add mcp/test/capture/sandbox.test.ts
git commit -m "test(mcp): daemon-CC sandbox profile denies file mutation"
```

---

### Task 29: Performance benchmarks (§11.1, §11.2, §11.3)

**Files:**
- Test: `mcp/test/perf/hook-latency.bench.test.ts`
- Test: `mcp/test/perf/brief-render.bench.test.ts`
- Test: `mcp/test/perf/init-time.bench.test.ts`

- [ ] **Step 1: Write hook latency benchmark (§11.3)**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { runPostToolUseHook } from "../../src/hooks/post-tool-use.js";

describe("hook latency", () => {
  it("PostToolUse completes 100 invocations in <5s (avg <50ms)", () => {
    const tmp = fs.mkdtempSync("/tmp/syn-perf-");
    process.env.SYNAPSE_HOME = tmp;
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      runPostToolUseHook({ project_id: "p", user_id: "u", session_id: "s", tool: "Edit", input: { file_path: `f${i}.ts` }, output: {} });
    }
    const elapsed = Date.now() - start;
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(elapsed).toBeLessThan(5000);
    expect(elapsed / 100).toBeLessThan(50);
  });
});
```

- [ ] **Step 2: Write brief-render benchmark (§11.2)**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderBriefFromCache } from "../../src/capture/handoff-brief.js";

describe("brief render latency", () => {
  it("renders from warm cache in <100ms", () => {
    const tmp = fs.mkdtempSync("/tmp/syn-brief-perf-");
    process.env.SYNAPSE_HOME = tmp;
    const cacheDir = path.join(tmp, "projects/p/cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "project_status.json"), JSON.stringify({
      project_id: "p", current_next_step: null, active_actors: [],
      recent_activity: [], open_issues: { decisions: [], questions: [] }, open_subtasks: [], updated_at: "t",
    }));
    const start = Date.now();
    for (let i = 0; i < 50; i++) renderBriefFromCache("p", "alex");
    const avg = (Date.now() - start) / 50;
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(avg).toBeLessThan(100);
  });
});
```

- [ ] **Step 3: Write init-time benchmark (§11.1)**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runInit } from "../../src/cli/init.js";

describe("synapse init time", () => {
  it("completes installer (without OS service registration) in <30s", async () => {
    const tmp = fs.mkdtempSync("/tmp/syn-init-perf-");
    process.env.HOME = tmp;
    process.env.SYNAPSE_HOME = path.join(tmp, ".synapse");
    const start = Date.now();
    await runInit({ api_key: "k", skip_service: true });
    const elapsed = Date.now() - start;
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(elapsed).toBeLessThan(30_000);
  });
});
```

- [ ] **Step 4: Run, commit**

```bash
npx vitest run mcp/test/perf/
git add mcp/test/perf
git commit -m "test(mcp): perf benchmarks for hooks, brief render, init (§11.1-11.3)"
```

---

## Phase J — Final integration

### Task 30: Hook command dispatcher

**Files:**
- Create: `mcp/src/cli/hook-dispatch.ts`
- Modify: `mcp/src/cli/commands.ts`
- Test: `mcp/test/cli/hook-dispatch.test.ts`

The hook commands wired into `~/.claude/settings.json` look like `synapse hook session-start`. This task creates the dispatcher that reads the hook event JSON from stdin (Claude Code's hook protocol) and routes to the right handler.

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { dispatchHook } from "../../src/cli/hook-dispatch.js";

describe("hook dispatch", () => {
  it("routes session-start hook payload to runSessionStartHook", async () => {
    const out: string[] = [];
    await dispatchHook("session-start", {
      project_id: "p", user_id: "u",
      stdout: { write: (s: string) => out.push(s) > 0 } as any,
    } as any);
    expect(out.join("")).toContain("<synapse-brief>");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { runSessionStartHook } from "../hooks/session-start.js";
import { runUserPromptSubmitHook } from "../hooks/user-prompt-submit.js";
import { runPostToolUseHook } from "../hooks/post-tool-use.js";
import { runPreCompactHook } from "../hooks/pre-compact.js";
import { runSessionEndHook } from "../hooks/session-end.js";
import { runSubagentStopHook } from "../hooks/subagent-stop.js";

export async function dispatchHook(kind: string, payload: any): Promise<void> {
  switch (kind) {
    case "session-start": return runSessionStartHook(payload);
    case "user-prompt-submit": return runUserPromptSubmitHook(payload);
    case "post-tool-use": return runPostToolUseHook(payload);
    case "pre-compact": return runPreCompactHook(payload);
    case "session-end": return runSessionEndHook(payload);
    case "subagent-stop": return runSubagentStopHook(payload);
    default: process.stderr.write(`unknown hook: ${kind}\n`); process.exit(0);
  }
}

export async function readHookPayloadFromStdin(): Promise<any> {
  // Claude Code sends a JSON object on stdin. Fields per event kind:
  //   SessionStart      → { session_id, cwd, source }
  //   UserPromptSubmit  → { session_id, cwd, prompt }
  //   PostToolUse       → { session_id, cwd, tool_name, tool_input, tool_response }
  //   PreCompact        → { session_id, cwd, trigger }
  //   SessionEnd        → { session_id, cwd, reason }
  //   SubagentStop      → { session_id, cwd, subagent_type }
  // The dispatcher reads stdin, resolves the project_id from cwd, and
  // populates the per-handler args.
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const parsed = JSON.parse(raw);
  // Resolve project_id from cwd using existing project-map (mcp/src/cli/project-map.ts).
  // Fallback: use the cwd hash itself so events still flow when unmapped.
  const { resolveProjectIdFromCwd } = await import("./project-map.js");
  const project_id = await resolveProjectIdFromCwd(parsed.cwd) ?? hashCwd(parsed.cwd);
  return {
    project_id,
    user_id: process.env.SYNAPSE_USER_ID ?? "default",
    session_id: parsed.session_id,
    tool: parsed.tool_name,
    input: parsed.tool_input,
    output: parsed.tool_response,
    prompt: parsed.prompt,
    subagent: parsed.subagent_type,
    stdout: process.stdout,
  };
}

function hashCwd(cwd: string): string {
  // Simple deterministic fallback id — first 12 hex chars of cwd's sha1
  const { createHash } = require("node:crypto");
  return `cwd_${createHash("sha1").update(cwd).digest("hex").slice(0, 12)}`;
}
```

In `mcp/src/cli/commands.ts`, add the `hook` subcommand that reads stdin and calls `dispatchHook`.

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run mcp/test/cli/hook-dispatch.test.ts
git add mcp/src/cli/hook-dispatch.ts mcp/src/cli/commands.ts mcp/test/cli/hook-dispatch.test.ts
git commit -m "feat(mcp): hook command dispatcher reads stdin payload and routes to handlers"
```

---

### Task 31: README + docs update

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update README MCP section**

Replace the existing "MCP setup" section's framing to:
- Lead with `synapse init` as the primary install
- Describe the handoff scenario as the headline use case
- Move MCP setup to a "For other hosts (Cursor, Windsurf)" sub-section
- Note `daemon.ai_enabled` opt-in

- [ ] **Step 2: Update ARCHITECTURE.md**

Add the component diagram from the design spec and a one-paragraph description of the local-first event log + daemon sync model.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ARCHITECTURE.md
git commit -m "docs: reframe Synapse as a Claude Code-first handoff layer with daemon"
```

---

### Task 32: Final verification — run full acceptance criteria

- [ ] **Step 1: Run the full test suite**

Run: `npm run verify`
Expected: all tests pass; biome clean; typecheck clean.

- [ ] **Step 2: Manual smoke test on macOS**

1. `npm run build` and `npm install -g .` to install the CLI globally.
2. `synapse init` with a fresh API key.
3. Verify `~/.claude/settings.json` has hook entries.
4. Verify `~/Library/LaunchAgents/app.synapsesync.daemon.plist` exists and `launchctl list | grep synapse` shows it loaded.
5. `synapse status` reports daemon healthy.
6. Open Claude Code, do some edits, run `synapse handoff "test next step"`.
7. `/clear` to start a new session. Verify the brief contains "test next step."

- [ ] **Step 3: Update the design spec status**

Edit `docs/superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md` and change the header from `Status: Draft — pending review` to `Status: Implemented`.

- [ ] **Step 4: Commit and tag**

```bash
git add docs/superpowers/specs/2026-05-11-claude-code-handoff-layer-design.md
git commit -m "docs: mark handoff layer design as Implemented"
git tag v1.0.0-handoff
```

---

## Out-of-scope (explicitly deferred to v1.5 or beyond)

- Windows service installer (Task 15 only covers macOS + Linux)
- `synapse mcp-serve` legacy adapter clean-up (the existing MCP server keeps working; not refactored)
- Daemon-fired CC use cases 2–6 (decision extraction, digests, onboarding, focus refresh, smart conflicts)
- `synapse issue merge` for deduplication
- WebSocket/SSE upgrade path for B3
- Frontend dashboard changes (this v1 ships backend + daemon only; existing dashboard sees the new tables read-only)
- Migration of old `save_insight` data into `Issue` records
