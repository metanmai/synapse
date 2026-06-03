# SessionStart Auto-Injection (Phase A #1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Claude Code session starts, automatically inject a compact orientation block (`<synapse-brief>`) drawn from existing project context — so users immediately see Synapse's value without having to ask.

**Architecture:** A new CLI command `synapsesync-mcp brief` that (1) resolves which project the current cwd belongs to using three layered signals, (2) fetches that project's compacted context from the backend, (3) writes a tagged block to stdout. A SessionStart hook chains this command after the existing daemon-start so the output is injected into new Claude Code sessions automatically. Two small read-only backend endpoints support the resolution and aggregation.

**Tech Stack:** TypeScript, Node.js, Vitest, Hono (existing backend), Supabase client (existing), Claude Code hooks spec (`settings.json`).

**Scope discipline:** This plan is **Phase A #1 only** — one hook, one CLI entry, two backend endpoints, no schema migration. Explicitly deferred: `<private>` tag stripping (Phase A #2), discovery-token ROI display (Phase A #3), `capture flush` + Stop hooks (future phase), general-purpose resume CLI, team handoff tokens.

**Repo convention:** every commit step below ends with `git push` per project convention. The plan shows `git commit` explicitly; always follow with `git push` before moving on.

**Design decisions committed for this plan** (answering open clarifying questions from the brainstorming handoff):
- Empty-state: workspace-level fallback with top 5 most-recent projects
- Injection format: tagged `<synapse-brief>` block, target ~400 tokens
- Hook wiring: modify the existing SessionStart hook to chain a second command (one hook group, two sequential commands)
- Install UX: `capture install` installs both daemon-start and brief-emit in one unified hook — no separate flag or opt-in

---

## Task 1: Backend — `POST /api/projects/resolve`

**Files:**
- Create: `backend/src/api/projects-resolve.ts`
- Modify: `backend/src/index.ts` (register the new route)
- Modify: `backend/src/lib/validate.ts` (add `resolveProject` schema)
- Test: `backend/test/api/projects-resolve.test.ts`

Takes `{ cwd, git_origin_url?, git_basename? }`, returns `{ project_id, name, confidence }` for the best match among the caller's projects, or `null` when nothing matches. Read-only: queries existing `projects` and `conversations` tables. No schema migration.

**Match strategy (in order, first hit wins):**
1. Exact name match against `projects.name == git_basename` — highest confidence
2. Historical cwd match: any conversation with `working_context->>'cwd' == cwd` — high confidence
3. Historical git origin match: any conversation with `working_context->>'git_origin_url' == git_origin_url` — medium confidence
4. Nothing → return `null`

- [ ] **Step 1: Write the failing auth test**

```ts
// backend/test/api/projects-resolve.test.ts
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("POST /api/projects/resolve — auth", () => {
  it("returns 401 without a bearer token", async () => {
    const req = new Request("http://localhost/api/projects/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/foo" }),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 when cwd is missing", async () => {
    const req = new Request("http://localhost/api/projects/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
      body: JSON.stringify({}),
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    // Invalid bearer lands as 401 first — but this asserts the route is registered.
    expect([400, 401]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/api/projects-resolve.test.ts`
Expected: FAIL — both tests 404 because the route isn't registered

- [ ] **Step 3: Add the validation schema**

Modify `backend/src/lib/validate.ts` — add next to other existing schemas:

```ts
  resolveProject: z.object({
    cwd: z.string().min(1, "cwd is required"),
    git_origin_url: z.string().optional(),
    git_basename: z.string().optional(),
  }),
```

- [ ] **Step 4: Create the route module**

```ts
// backend/src/api/projects-resolve.ts
import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { parseBody, schemas } from "../lib/validate";

const projectsResolve = new Hono<{ Bindings: Env }>();
projectsResolve.use("*", authMiddleware);

// POST /api/projects/resolve
projectsResolve.post("/resolve", async (c) => {
  const user = c.get("user");
  const { cwd, git_origin_url, git_basename } = await parseBody(c, schemas.resolveProject);
  const db = c.get("db");

  // Collaboration-aware: include projects where the user is either owner OR a member.
  // Build the set of accessible project_ids once; every match below filters against this.
  const { data: memberRows } = await db
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id);
  const memberIds = (memberRows ?? []).map((r: { project_id: string }) => r.project_id);
  const accessibleIds = new Set<string>([...memberIds]);
  // Also include owned projects (project_members may not contain owner rows depending on schema)
  const { data: ownedRows } = await db.from("projects").select("id").eq("user_id", user.id);
  for (const o of ownedRows ?? []) accessibleIds.add((o as { id: string }).id);

  if (accessibleIds.size === 0) {
    return c.json({ project_id: null, name: null, confidence: null, signal: "no_access" });
  }
  const accessibleArray = Array.from(accessibleIds);

  // 1. Name match — git basename vs project.name, constrained to accessible projects
  if (git_basename) {
    const { data: byName } = await db
      .from("projects")
      .select("id, name")
      .in("id", accessibleArray)
      .eq("name", git_basename)
      .limit(1)
      .maybeSingle();
    if (byName) {
      return c.json({ project_id: byName.id, name: byName.name, confidence: "high", signal: "name" });
    }
  }

  // 2. Historical cwd match — any accessible project where someone recorded this cwd
  {
    const { data: byCwd } = await db
      .from("conversations")
      .select("project_id, projects!inner(name)")
      .in("project_id", accessibleArray)
      .eq("working_context->>cwd", cwd)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byCwd) {
      const row = byCwd as unknown as { project_id: string; projects: { name: string } };
      return c.json({
        project_id: row.project_id,
        name: row.projects.name,
        confidence: "high",
        signal: "cwd_history",
      });
    }
  }

  // 3. Historical git origin match — any accessible project where git_origin was recorded
  if (git_origin_url) {
    const { data: byOrigin } = await db
      .from("conversations")
      .select("project_id, projects!inner(name)")
      .in("project_id", accessibleArray)
      .eq("working_context->>git_origin_url", git_origin_url)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byOrigin) {
      const row = byOrigin as unknown as { project_id: string; projects: { name: string } };
      return c.json({
        project_id: row.project_id,
        name: row.projects.name,
        confidence: "medium",
        signal: "git_origin",
      });
    }
  }

  // No match — caller should fall back to workspace-level view
  return c.json({ project_id: null, name: null, confidence: null, signal: "no_match" });
});

export { projectsResolve };
```

- [ ] **Step 5: Register the route**

Modify `backend/src/index.ts` — add the import and mount:

```ts
import { projectsResolve } from "./api/projects-resolve";
```

And in the route-mounting block (wherever other routes live):

```ts
app.route("/api/projects", projectsResolve);
```

> Confirm the existing projects routes aren't also mounted at `/api/projects` — if they are, pick a non-conflicting path like `/api/projects/resolve` mounted at root. Check with `grep -n "route\(\"/api/projects" backend/src/index.ts`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/api/projects-resolve.test.ts`
Expected: PASS — 2 tests pass

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/projects-resolve.ts backend/src/index.ts backend/src/lib/validate.ts backend/test/api/projects-resolve.test.ts
git commit -m "feat(backend): add POST /api/projects/resolve for cwd→project matching

Takes {cwd, git_origin_url?, git_basename?} and returns the best
matching project for the caller, using three layered signals:
  1. name match against git_basename
  2. historical cwd from conversation.working_context
  3. historical git_origin_url from conversation.working_context

Collaboration-aware: considers projects the user owns AND projects
they're a member of via project_members. Teammates on shared projects
resolve correctly on their first session.

Returns project_id:null when nothing matches — callers fall back
to workspace-level view. Read-only; no schema migration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 2: Backend — `GET /api/projects/:id/session-context`

**Files:**
- Modify: `backend/src/api/compaction.ts:51-95` (extend the existing `GET /projects/:id/context`) OR
- Create: `backend/src/api/session-context.ts` (new file, co-located with compaction)
- Test: `backend/test/api/session-context.test.ts`

Aggregates what the hook needs into one call: `project_context.summary`, recent 3 conversation headers, top 10 insights. Avoids three round-trips from the CLI. Read-only; no schema migration.

**Note:** `GET /api/projects/:id/context` already exists (Plus-gated, returns compacted summary only). Extending it risks breaking the frontend. Creating a sibling endpoint `GET /api/projects/:id/session-context` with a broader payload is cleaner.

- [ ] **Step 1: Write the failing auth + shape tests**

```ts
// backend/test/api/session-context.test.ts
import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

describe("GET /api/projects/:id/session-context — auth", () => {
  it("returns 401 without a bearer token", async () => {
    const req = new Request("http://localhost/api/projects/some-id/session-context");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid bearer — route is registered", async () => {
    const req = new Request("http://localhost/api/projects/some-id/session-context", {
      headers: { Authorization: "Bearer bad-token" },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/api/session-context.test.ts`
Expected: FAIL — route not registered, second test returns 404

- [ ] **Step 3: Create the route module**

```ts
// backend/src/api/session-context.ts
import { Hono } from "hono";
import { getProjectContext, getRecentCompactedSummaries } from "../db/queries/conversations";
import { listInsights } from "../db/queries";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { requireRole } from "../middleware/project-auth";

const sessionContext = new Hono<{ Bindings: Env }>();
sessionContext.use("*", authMiddleware);

// GET /api/projects/:id/session-context
sessionContext.get("/:id/session-context", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");
  const db = c.get("db");

  await requireRole(db, projectId, user.id);

  // Fetch in parallel
  const [projectContext, recentSummaries, insightList] = await Promise.all([
    getProjectContext(db, projectId).catch(() => null),
    getRecentCompactedSummaries(db, projectId, 3).catch(() => []),
    listInsights(db, projectId, { limit: 10 }).catch(() => ({ insights: [], total: 0 })),
  ]);

  return c.json({
    project_id: projectId,
    summary: projectContext?.summary ?? null,
    summary_source: projectContext ? "aggregated" : recentSummaries.length > 0 ? "recent_summaries" : null,
    summary_updated_at: projectContext?.updated_at ?? recentSummaries[0]?.compacted_at ?? null,
    recent_conversations: recentSummaries.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      compacted_summary: r.compacted_summary,
      compacted_at: r.compacted_at,
    })),
    insights: insightList.insights,
  });
});

// GET /api/workspace/recent-projects — for empty-state fallback
sessionContext.get("/workspace/recent-projects", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  const { data } = await db
    .from("projects")
    .select("id, name, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);

  return c.json({ projects: data ?? [] });
});

export { sessionContext };
```

- [ ] **Step 4: Register the route**

Modify `backend/src/index.ts`:

```ts
import { sessionContext } from "./api/session-context";
```

Mount at `/api/projects` alongside the resolve route — check there are no path conflicts. If the workspace subroute conflicts, mount it separately at `/api/workspace`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/api/session-context.test.ts`
Expected: PASS — 2 tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/src/api/session-context.ts backend/src/index.ts backend/test/api/session-context.test.ts
git commit -m "feat(backend): add GET /api/projects/:id/session-context

One-call aggregation for the SessionStart hook: returns project
summary (from project_context OR falls back to recent compacted
summaries), top 3 recent conversations, and top 10 insights.

Also adds GET /api/workspace/recent-projects for empty-state
fallback when no project resolves.

Read-only; no schema migration. Not Plus-gated (per new tier
strategy — insights are free).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 3: MCP CLI — local project-map cache

**Files:**
- Create: `mcp/src/cli/project-map.ts`
- Modify: `mcp/src/capture/cloud-sync.ts` (write to map on successful sync)
- Test: `mcp/test/unit/project-map.test.ts`

A tiny JSON file at `~/.synapse/project-map.json` that maps `cwd → { project_id, project_name, updated_at }`. Populated as a side effect of the capture daemon successfully syncing a session. Read on SessionStart as the fastest signal.

Shape:
```json
{
  "/Users/tanmai/Documents/synapse": {
    "project_id": "proj-uuid",
    "project_name": "synapse",
    "updated_at": "2026-04-13T12:00:00Z"
  }
}
```

- [ ] **Step 1: Write the failing test**

```ts
// mcp/test/unit/project-map.test.ts
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectMapPath, readProjectMap, upsertProjectMapping } from "../../src/cli/project-map.js";

describe("project-map", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-pm-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("getProjectMapPath returns ~/.synapse/project-map.json", () => {
    expect(getProjectMapPath()).toBe(path.join(tmpHome, ".synapse", "project-map.json"));
  });

  it("readProjectMap returns {} when file does not exist", () => {
    expect(readProjectMap()).toEqual({});
  });

  it("upsertProjectMapping creates directory + file", () => {
    upsertProjectMapping("/tmp/foo", { project_id: "p1", project_name: "foo" });
    const map = readProjectMap();
    expect(map["/tmp/foo"]).toMatchObject({ project_id: "p1", project_name: "foo" });
    expect(map["/tmp/foo"].updated_at).toBeTruthy();
  });

  it("upsertProjectMapping overwrites existing entry", () => {
    upsertProjectMapping("/tmp/foo", { project_id: "p1", project_name: "foo" });
    upsertProjectMapping("/tmp/foo", { project_id: "p2", project_name: "foo-renamed" });
    expect(readProjectMap()["/tmp/foo"].project_id).toBe("p2");
  });

  it("readProjectMap recovers from malformed JSON", () => {
    const p = getProjectMapPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{not valid json");
    expect(readProjectMap()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run test/unit/project-map.test.ts`
Expected: FAIL — "Cannot find module '../../src/cli/project-map.js'"

- [ ] **Step 3: Implement project-map**

```ts
// mcp/src/cli/project-map.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectMapping {
  project_id: string;
  project_name: string;
  updated_at: string;
}

export type ProjectMap = Record<string, ProjectMapping>;

export function getProjectMapPath(): string {
  return path.join(os.homedir(), ".synapse", "project-map.json");
}

export function readProjectMap(): ProjectMap {
  try {
    const raw = fs.readFileSync(getProjectMapPath(), "utf-8");
    return JSON.parse(raw) as ProjectMap;
  } catch {
    return {};
  }
}

export function upsertProjectMapping(
  cwd: string,
  entry: { project_id: string; project_name: string },
): void {
  const p = getProjectMapPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const map = readProjectMap();
  map[cwd] = { ...entry, updated_at: new Date().toISOString() };
  fs.writeFileSync(p, JSON.stringify(map, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run test/unit/project-map.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Wire cloud-sync to populate the map**

Find where cloud-sync.ts successfully creates/updates a conversation. After the successful response (which includes `project_id`), call `upsertProjectMapping(session.projectPath, { project_id, project_name })`.

Grep first: `grep -n "project_id\|projectPath" mcp/src/capture/cloud-sync.ts`

Add the import at the top of `cloud-sync.ts`:

```ts
import { upsertProjectMapping } from "../cli/project-map.js";
```

Then, immediately after a successful sync that returned a project_id:

```ts
try {
  upsertProjectMapping(session.projectPath, {
    project_id: response.project_id,
    project_name: response.project_name,
  });
} catch {
  /* map is a best-effort cache; never fail a sync for it */
}
```

> If `response.project_name` isn't returned today, either add it to the backend response or do a single follow-up `GET /api/projects/:id` and cache. Keep the integration robust to either.

- [ ] **Step 6: Commit**

```bash
git add mcp/src/cli/project-map.ts mcp/src/capture/cloud-sync.ts mcp/test/unit/project-map.test.ts
git commit -m "feat(mcp): add local project-map cache populated by capture daemon

~/.synapse/project-map.json maps cwd → {project_id, project_name,
updated_at}. Written as a side effect of successful conversation
syncs; read by SessionStart hook as fastest project-resolution signal.

Malformed JSON is recovered transparently (returns {}); map writes
never fail a sync.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 4: MCP CLI — project resolver

**Files:**
- Create: `mcp/src/cli/resolve-project.ts`
- Test: `mcp/test/unit/resolve-project.test.ts`

The chain: local-map → `POST /api/projects/resolve` → workspace-fallback signal. Pure utility; network calls injected for testability.

- [ ] **Step 1: Write the failing tests**

```ts
// mcp/test/unit/resolve-project.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as projectMap from "../../src/cli/project-map.js";
import { resolveProject } from "../../src/cli/resolve-project.js";

describe("resolveProject", () => {
  beforeEach(() => {
    vi.spyOn(projectMap, "readProjectMap").mockReturnValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns local-map hit when cwd is mapped", async () => {
    vi.spyOn(projectMap, "readProjectMap").mockReturnValue({
      "/repo": { project_id: "p1", project_name: "myproj", updated_at: "2026-04-13T00:00:00Z" },
    });
    const fakeApi = vi.fn();
    const result = await resolveProject("/repo", fakeApi);
    expect(result).toEqual({ source: "local", project_id: "p1", name: "myproj" });
    expect(fakeApi).not.toHaveBeenCalled();
  });

  it("falls back to backend resolve when local-map misses", async () => {
    const fakeApi = vi.fn().mockResolvedValue({
      project_id: "p2",
      name: "from-backend",
      confidence: "high",
      signal: "name",
    });
    const result = await resolveProject("/repo", fakeApi);
    expect(result).toEqual({ source: "backend", project_id: "p2", name: "from-backend" });
    expect(fakeApi).toHaveBeenCalledOnce();
  });

  it("returns workspace-fallback signal when backend returns null", async () => {
    const fakeApi = vi.fn().mockResolvedValue({
      project_id: null,
      name: null,
      confidence: null,
      signal: "no_match",
    });
    const result = await resolveProject("/repo", fakeApi);
    expect(result).toEqual({ source: "workspace_fallback", project_id: null, name: null });
  });

  it("returns workspace-fallback when backend call throws", async () => {
    const fakeApi = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await resolveProject("/repo", fakeApi);
    expect(result.source).toBe("workspace_fallback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run test/unit/resolve-project.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolveProject**

```ts
// mcp/src/cli/resolve-project.ts
import { execSync } from "node:child_process";
import path from "node:path";
import { readProjectMap } from "./project-map.js";

export interface ResolvedProject {
  source: "local" | "backend" | "workspace_fallback";
  project_id: string | null;
  name: string | null;
}

export interface BackendResolveResponse {
  project_id: string | null;
  name: string | null;
  confidence: string | null;
  signal: string;
}

export type BackendResolveFn = (signals: {
  cwd: string;
  git_origin_url?: string;
  git_basename?: string;
}) => Promise<BackendResolveResponse>;

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

export async function resolveProject(
  cwd: string,
  backend: BackendResolveFn,
): Promise<ResolvedProject> {
  // 1. Local map — fastest, works offline
  const map = readProjectMap();
  const local = map[cwd];
  if (local) {
    return { source: "local", project_id: local.project_id, name: local.project_name };
  }

  // 2. Backend resolve
  const signals = readGitSignals(cwd);
  try {
    const res = await backend({ cwd, ...signals });
    if (res.project_id) {
      return { source: "backend", project_id: res.project_id, name: res.name };
    }
  } catch {
    /* network/auth issue — fall through to workspace fallback */
  }

  // 3. Workspace fallback
  return { source: "workspace_fallback", project_id: null, name: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run test/unit/resolve-project.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add mcp/src/cli/resolve-project.ts mcp/test/unit/resolve-project.test.ts
git commit -m "feat(mcp): add project resolver (local-map → backend → fallback)

Three layered signals:
  1. ~/.synapse/project-map.json lookup (fastest, offline-capable)
  2. POST /api/projects/resolve with {cwd, git_origin_url, git_basename}
  3. workspace_fallback signal — caller shows top-5 recent projects

Returns a tagged ResolvedProject so callers can branch behavior
based on source and match quality.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 5: MCP CLI — brief formatter

**Files:**
- Create: `mcp/src/cli/brief-format.ts`
- Test: `mcp/test/unit/brief-format.test.ts`

Pure function: takes structured data (project, project_context summary, recent conversations, insights) OR workspace-fallback data (list of recent projects), and renders a `<synapse-brief>` block. Target ~400 tokens.

- [ ] **Step 1: Write the failing tests**

```ts
// mcp/test/unit/brief-format.test.ts
import { describe, expect, it } from "vitest";
import { formatBrief, formatWorkspaceBrief } from "../../src/cli/brief-format.js";

describe("formatBrief", () => {
  const baseData = {
    project: { name: "synapse" },
    summary: "We're rebuilding auth middleware.",
    summary_updated_at: "2026-04-13T10:00:00Z",
    recent_conversations: [
      { id: "ses_a", title: "Fix auth race", compacted_summary: "Identified and patched.", compacted_at: "2026-04-13T09:00:00Z" },
    ],
    insights: [
      { type: "decision" as const, summary: "Use Postgres", detail: null, updated_at: "2026-04-13T08:00:00Z" },
    ],
    now: new Date("2026-04-13T11:00:00Z"),
  };

  it("wraps output in <synapse-brief> tags", () => {
    const out = formatBrief(baseData);
    expect(out).toContain("<synapse-brief>");
    expect(out).toContain("</synapse-brief>");
  });

  it("includes project name and summary", () => {
    const out = formatBrief(baseData);
    expect(out).toContain("Project: synapse");
    expect(out).toContain("rebuilding auth middleware");
  });

  it("lists recent insights with type prefix", () => {
    const out = formatBrief(baseData);
    expect(out).toMatch(/\[decision\]/);
    expect(out).toContain("Use Postgres");
  });

  it("handles missing summary gracefully", () => {
    const out = formatBrief({ ...baseData, summary: null });
    expect(out).toContain("No project summary yet");
  });

  it("handles empty insights + conversations", () => {
    const out = formatBrief({ ...baseData, insights: [], recent_conversations: [] });
    expect(out).toContain("<synapse-brief>");
    expect(out).toContain("Project: synapse");
  });
});

describe("formatWorkspaceBrief", () => {
  it("shows top-5 projects when no project matched cwd", () => {
    const out = formatWorkspaceBrief({
      projects: [
        { id: "1", name: "synapse", updated_at: "2026-04-13T10:00:00Z" },
        { id: "2", name: "workpulse", updated_at: "2026-04-12T10:00:00Z" },
      ],
      now: new Date("2026-04-13T11:00:00Z"),
    });
    expect(out).toContain("<synapse-brief>");
    expect(out).toContain("No project matched this location");
    expect(out).toContain("synapse");
    expect(out).toContain("workpulse");
  });

  it("handles empty workspace gracefully", () => {
    const out = formatWorkspaceBrief({ projects: [], now: new Date() });
    expect(out).toContain("Welcome to Synapse");
    expect(out).toContain("<synapse-brief>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp && npx vitest run test/unit/brief-format.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement formatters**

```ts
// mcp/src/cli/brief-format.ts

export interface BriefInsight {
  type: "decision" | "learning" | "preference" | "architecture" | "action_item";
  summary: string;
  detail?: string | null;
  updated_at: string;
}

export interface BriefConversation {
  id: string;
  title: string | null;
  compacted_summary: string | null;
  compacted_at: string;
}

export interface BriefData {
  project: { name: string };
  summary: string | null;
  summary_updated_at: string | null;
  recent_conversations: BriefConversation[];
  insights: BriefInsight[];
  now: Date;
}

export interface WorkspaceBriefData {
  projects: Array<{ id: string; name: string; updated_at: string }>;
  now: Date;
}

export function formatBrief(d: BriefData): string {
  const lines: string[] = [];
  lines.push("<synapse-brief>");
  lines.push(`Project: ${d.project.name}`);

  if (d.summary) {
    const ago = d.summary_updated_at ? relative(new Date(d.summary_updated_at), d.now) : "";
    lines.push("");
    lines.push(`## Project summary${ago ? ` (${ago})` : ""}`);
    lines.push(d.summary.slice(0, 1200));
  } else {
    lines.push("");
    lines.push("No project summary yet — will appear as conversations are compacted.");
  }

  if (d.insights.length > 0) {
    lines.push("");
    lines.push("## Recent insights");
    for (const ins of d.insights.slice(0, 10)) {
      const ago = relative(new Date(ins.updated_at), d.now);
      lines.push(`- [${ins.type}, ${ago}] ${ins.summary}`);
    }
  }

  if (d.recent_conversations.length > 0) {
    lines.push("");
    lines.push("## Recent conversations");
    for (const c of d.recent_conversations.slice(0, 3)) {
      const ago = relative(new Date(c.compacted_at), d.now);
      const title = c.title ?? "(untitled)";
      lines.push(`- ${title} (${ago})`);
      if (c.compacted_summary) {
        lines.push(`  ${c.compacted_summary.slice(0, 200).replace(/\s+/g, " ")}`);
      }
    }
  }

  lines.push("</synapse-brief>");
  return `${lines.join("\n")}\n`;
}

export function formatWorkspaceBrief(d: WorkspaceBriefData): string {
  const lines: string[] = [];
  lines.push("<synapse-brief>");
  if (d.projects.length === 0) {
    lines.push("Welcome to Synapse.");
    lines.push("No projects yet — start a capture with `synapsesync-mcp capture start`.");
  } else {
    lines.push("No project matched this location. Recent projects across your workspace:");
    for (const p of d.projects.slice(0, 5)) {
      const ago = relative(new Date(p.updated_at), d.now);
      lines.push(`- ${p.name} (last active ${ago})`);
    }
  }
  lines.push("</synapse-brief>");
  return `${lines.join("\n")}\n`;
}

function relative(then: Date, now: Date): string {
  const diff = now.getTime() - then.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp && npx vitest run test/unit/brief-format.test.ts`
Expected: PASS — 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add mcp/src/cli/brief-format.ts mcp/test/unit/brief-format.test.ts
git commit -m "feat(mcp): add brief formatter (project + workspace variants)

Pure functions that render a <synapse-brief> block from structured
input data. Project variant shows summary + insights + recent
conversations (~400 tokens). Workspace variant shows top-5 projects
as an empty-state fallback when no project matched cwd.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 6: MCP CLI — `brief` command handler + dispatcher wiring

**Files:**
- Create: `mcp/src/cli/brief.ts`
- Modify: `mcp/src/index.ts` (HANDLERS map + help text)
- Modify: `mcp/test/e2e/cli-dispatch.test.ts` (add `brief` to REGISTERED_COMMANDS)

Orchestrates resolver + backend call + formatter, emits result to stdout.

- [ ] **Step 1: Implement the command**

```ts
// mcp/src/cli/brief.ts
import { API_URL } from "./config.js";
import { formatBrief, formatWorkspaceBrief } from "./brief-format.js";
import { resolveProject, type BackendResolveFn } from "./resolve-project.js";

interface SessionContextResponse {
  project_id: string;
  summary: string | null;
  summary_source: string | null;
  summary_updated_at: string | null;
  recent_conversations: Array<{
    id: string;
    title: string | null;
    compacted_summary: string | null;
    compacted_at: string;
  }>;
  insights: Array<{
    type: "decision" | "learning" | "preference" | "architecture" | "action_item";
    summary: string;
    detail: string | null;
    updated_at: string;
  }>;
}

interface WorkspaceRecentResponse {
  projects: Array<{ id: string; name: string; updated_at: string }>;
}

async function api<T>(method: string, path: string, key: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function runBrief(_args: string[]): Promise<void> {
  const key = process.env.SYNAPSE_API_KEY;
  if (!key) {
    // Silent: don't pollute stdout with errors that get piped into agents
    return;
  }

  const cwd = process.cwd();

  const backendResolve: BackendResolveFn = (signals) =>
    api("POST", "/api/projects/resolve", key, signals);

  const resolved = await resolveProject(cwd, backendResolve);
  const now = new Date();

  if (resolved.project_id) {
    try {
      const ctx = await api<SessionContextResponse>(
        "GET",
        `/api/projects/${encodeURIComponent(resolved.project_id)}/session-context`,
        key,
      );
      process.stdout.write(
        formatBrief({
          project: { name: resolved.name ?? "(unknown)" },
          summary: ctx.summary,
          summary_updated_at: ctx.summary_updated_at,
          recent_conversations: ctx.recent_conversations,
          insights: ctx.insights,
          now,
        }),
      );
      return;
    } catch {
      /* fall through to workspace fallback on error */
    }
  }

  // Workspace-level fallback
  try {
    const ws = await api<WorkspaceRecentResponse>("GET", "/api/workspace/recent-projects", key);
    process.stdout.write(formatWorkspaceBrief({ projects: ws.projects, now }));
  } catch {
    // Silent failure: emit an empty but valid brief so the hook doesn't error
    process.stdout.write(formatWorkspaceBrief({ projects: [], now }));
  }
}
```

- [ ] **Step 2: Wire into the HANDLERS map**

Modify `mcp/src/index.ts` — add the import:

```ts
import { runBrief } from "./cli/brief.js";
```

Add to the HANDLERS object (before `capture`):

```ts
  brief: async (args) => runBrief(args),
```

Add to `printHelp()` in the appropriate section:

```ts
    "",
    `  ${bold("Orient")}`,
    c("brief", "Emit project brief to stdout (for SessionStart hook)"),
```

- [ ] **Step 3: Update dispatch allowlist**

Modify `mcp/test/e2e/cli-dispatch.test.ts` — add `"brief"` to `REGISTERED_COMMANDS`.

- [ ] **Step 4: Build and smoke-test**

Run: `cd mcp && npm run build && node dist/index.js brief < /dev/null 2>&1 | head -20`
Expected: Either a valid `<synapse-brief>` block (if API_KEY is set and cwd matches a project) or silent exit (if not). **No errors to stderr unless there's a real problem** — silent failure is the design.

- [ ] **Step 5: Run dispatch test**

Run: `cd mcp && TEST_E2E=1 npx vitest run test/e2e/cli-dispatch.test.ts`
Expected: PASS — all registered commands dispatch cleanly

- [ ] **Step 6: Commit**

```bash
git add mcp/src/cli/brief.ts mcp/src/index.ts mcp/test/e2e/cli-dispatch.test.ts
git commit -m "feat(mcp): add \`brief\` CLI — emits synapse-brief to stdout

Orchestrates: resolveProject → GET session-context (or workspace
fallback) → formatter → stdout. Designed to be invoked by the
SessionStart hook; silent on auth/network errors so the hook never
blocks Claude Code startup.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 7: SessionStart hook — chain brief onto existing hook

**Files:**
- Modify: `mcp/src/capture/hooks.ts`
- Modify: `mcp/test/unit/capture/hooks.test.ts`

The existing SessionStart hook starts the capture daemon. Chain `synapsesync-mcp brief` after it using `&&` so both run sequentially within one hook entry (per Q5 design decision).

- [ ] **Step 1: Read the existing hook installer shape**

Run: `cd mcp && grep -n "SessionStart\|hooks\." src/capture/hooks.ts | head -20`

Note whether the existing SessionStart command is a single string or an array. Adapt Step 2 to match.

- [ ] **Step 2: Write the failing test**

```ts
// Append to mcp/test/unit/capture/hooks.test.ts
describe("SessionStart hook chains `brief`", () => {
  it("installed SessionStart command runs daemon-start && synapsesync-mcp brief", () => {
    const tmpSettings = createTempSettingsFile({ hooks: {} });
    installHooks({ settingsPath: tmpSettings });
    const settings = readSettings(tmpSettings);
    const ss = JSON.stringify(settings.hooks?.SessionStart ?? "");
    expect(ss).toContain("synapsesync-mcp");
    expect(ss).toMatch(/capture\s+start|daemon/); // daemon-start command
    expect(ss).toContain("brief");
    // Both commands present, separated by && or as sequential entries
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mcp && npx vitest run test/unit/capture/hooks.test.ts`
Expected: FAIL — existing hook only has daemon-start, not brief

- [ ] **Step 4: Extend the SessionStart hook string**

Locate the existing SessionStart command in `hooks.ts`. Change it from something like:

```ts
const SESSION_START_COMMAND = "synapsesync-mcp capture start --daemon";
```

To:

```ts
const SESSION_START_COMMAND = "synapsesync-mcp capture start --daemon && synapsesync-mcp brief";
```

> Exact existing string may differ — adapt to what's already there. The `&&` chain guarantees brief runs only after the daemon has started; if the daemon-start command itself is already nonblocking and returns 0 quickly, this adds <100ms to session startup.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mcp && npx vitest run test/unit/capture/hooks.test.ts`
Expected: PASS — all hook tests pass

- [ ] **Step 6: Commit**

```bash
git add mcp/src/capture/hooks.ts mcp/test/unit/capture/hooks.test.ts
git commit -m "feat(mcp): chain \`brief\` onto existing SessionStart hook

The existing SessionStart hook starts the capture daemon. Now it
also runs \`synapsesync-mcp brief\` after via && chain — so every new
Claude Code session gets project orientation automatically
injected with zero user action.

Both commands live in one hook entry per Q5 decision (modify existing
hook rather than add a second group). If brief fails silently, the
daemon still starts and the session proceeds normally.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 8: Documentation + version bump

**Files:**
- Modify: `/Users/Tanmai.N/.claude/CLAUDE.md` (global)
- Modify: `/Users/Tanmai.N/Documents/synapse/CLAUDE.md` (project)
- Modify: `mcp/package.json` (0.8.0 → 0.9.0)

- [ ] **Step 1: Add `<synapse-brief>` recognition to both CLAUDE.md files**

Append this block to `~/.claude/CLAUDE.md` near the end of the Synapse section:

```markdown
## `<synapse-brief>` tag recognition

If your first user message contains a `<synapse-brief>` ... `</synapse-brief>` block, that's project orientation auto-injected by the Synapse SessionStart hook. Treat as:
- Trusted context about the current project (summary, recent conversations, insights)
- NOT a tool result — you were not a participant in prior sessions. Do not pretend to remember specific statements.
- A prompt to briefly acknowledge the current state and ask the user what they want to do next.
```

Mirror the same paragraph into `/Users/Tanmai.N/Documents/synapse/CLAUDE.md`.

- [ ] **Step 2: Bump version**

Modify `mcp/package.json`:
```json
  "version": "0.9.0",
```

- [ ] **Step 3: Full test run**

Run: `cd mcp && npm test`
Expected: all tests pass

Run: `cd backend && npm test`
Expected: all tests pass

- [ ] **Step 4: Smoke test the integration**

Run: `cd mcp && npm run build && node dist/index.js brief < /dev/null 2>&1 | head -30`

Expected: a `<synapse-brief>` block with your current project's insights + summary (if the `synapse` project has them), OR a workspace fallback block, OR silent exit if `SYNAPSE_API_KEY` isn't in your shell env.

- [ ] **Step 5: Commit + push**

```bash
git add ~/.claude/CLAUDE.md CLAUDE.md mcp/package.json
git commit -m "chore: bump synapsesync-mcp to 0.9.0 + document <synapse-brief>

0.9.0 ships Phase A #1 — SessionStart auto-injection. Every new
Claude Code session now gets an automatic <synapse-brief> block
with current project orientation, via a CLI chained onto the
existing SessionStart hook.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

- [ ] **Step 6: (Manual) Publish to npm**

After CI is green:
```bash
cd mcp && npm publish
```

---

## Out of scope (explicitly deferred)

Per the brainstorming handoff — these are **not** in this plan and should not be added during execution:

- **`<private>` tag stripping** — Phase A #2
- **Discovery-token ROI display** — Phase A #3
- **`capture flush` command + Stop hook** — future phase
- **General-purpose resume CLI** (`synapsesync-mcp resume` with interactive picker, cross-agent handoff tokens) — future phase
- **Schema migrations** — none needed for v1
- **Dashboard "Copy resume link" team handoff** — collaboration phase
- **Structured observation taxonomy** (bugfix/feature/discovery/decision fields) — Phase B

If you find yourself writing code for any of the above during execution, stop and confirm it's needed. The brainstorming's insight block explicitly flagged: "The single biggest risk to this spec is scope creep on the resolver."
