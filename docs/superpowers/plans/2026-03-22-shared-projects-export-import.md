# Shared Projects, Export & Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub-style project sharing (shared projects appear with owner attribution), zip export of project entries, and zip import from Synapse exports.

**Architecture:** Existing `project_members` system is extended with owner attribution and `~` separator disambiguation. Export/import use `fflate` for zip operations with YAML frontmatter for entry metadata.

**Tech Stack:** Hono (backend), Supabase PostgreSQL, SvelteKit 5 (frontend), fflate (zip)

**Spec:** `docs/superpowers/specs/2026-03-22-shared-projects-export-import-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/src/db/queries/projects.ts` | Modify: update listProjectsForUser and getProjectByName for owner attribution + disambiguation |
| `backend/src/lib/export.ts` | New: build zip from project entries |
| `backend/src/lib/import.ts` | New: parse zip and upsert entries |
| `backend/src/api/projects.ts` | Modify: update GET /projects response, add export/import endpoints |
| `frontend/src/lib/types.ts` | Modify: add owner_email, role to Project type |
| `frontend/src/lib/server/api.ts` | Modify: add exportProject URL helper |
| `frontend/src/routes/(app)/projects/[name]/+layout.server.ts` | Modify: match shared projects by owner attribution |
| `frontend/src/routes/(app)/projects/[name]/+page.svelte` | Modify: add Export/Import buttons |
| `frontend/src/routes/(app)/projects/[name]/+page.server.ts` | Modify: add import action |
| `frontend/src/routes/(app)/+page.server.ts` | Modify: handle shared projects in redirect |
| `frontend/src/routes/(app)/projects/[name]/api/export/+server.ts` | New: proxy export endpoint with auth |

---

### Task 1: Install fflate

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install fflate**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm install fflate`

- [ ] **Step 2: Commit**

```bash
git add backend/package.json
git commit -m "chore: add fflate for zip operations"
```

---

### Task 2: Query Layer — Owner Attribution and Disambiguation

**Files:**
- Modify: `backend/src/db/queries/projects.ts`

- [ ] **Step 1: Update `listProjectsForUser`**

Replace the existing function. The new version joins to `users` for owner email and to `project_members` for the user's role:

```typescript
export async function listProjectsForUser(
  db: SupabaseClient,
  userId: string
): Promise<(Project & { owner_email: string; role: string })[]> {
  const { data, error } = await db
    .from("project_members")
    .select("role, projects(*, users!projects_owner_id_fkey(email))")
    .eq("user_id", userId)
    .order("role", { ascending: true }); // owner first (alphabetically before editor/viewer)

  if (error) throw error;
  if (!data) return [];

  return data.map((row: any) => ({
    ...row.projects,
    owner_email: row.projects.users?.email ?? "",
    role: row.role,
  }));
}
```

Note: The join `users!projects_owner_id_fkey` tells Supabase to join via the `owner_id` foreign key specifically. If this FK hint doesn't work with the existing schema, the implementer should try `users!owner_id` or query users separately. Verify by running the typecheck.

- [ ] **Step 2: Update `getProjectByName`**

Replace the existing function. Supports `~` separator for disambiguation:

```typescript
export async function getProjectByName(
  db: SupabaseClient,
  nameOrQualified: string,
  userId: string
): Promise<Project | null> {
  // Check for qualified name format: owner-email~project-name
  if (nameOrQualified.includes("~")) {
    const tildeIdx = nameOrQualified.indexOf("~");
    const ownerEmail = nameOrQualified.slice(0, tildeIdx);
    const name = nameOrQualified.slice(tildeIdx + 1);

    const { data, error } = await db
      .from("projects")
      .select("*, project_members!inner(user_id), users!projects_owner_id_fkey(email)")
      .eq("name", name)
      .eq("users.email", ownerEmail)
      .eq("project_members.user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data as Project | null;
  }

  // Unqualified name — try owned project first, then fall back to any membership
  const { data: owned, error: ownedErr } = await db
    .from("projects")
    .select("*, project_members!inner(user_id, role)")
    .eq("name", nameOrQualified)
    .eq("project_members.user_id", userId)
    .eq("project_members.role", "owner")
    .limit(1)
    .maybeSingle();

  if (ownedErr) throw ownedErr;
  if (owned) return owned as Project;

  // Fall back to any project the user is a member of with this name
  const { data: shared, error: sharedErr } = await db
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("name", nameOrQualified)
    .eq("project_members.user_id", userId)
    .limit(1)
    .maybeSingle();

  if (sharedErr) throw sharedErr;
  return shared as Project | null;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 4: Run tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/queries/projects.ts
git commit -m "feat: add owner attribution and tilde disambiguation to project queries"
```

---

### Task 3: Update GET /api/projects Response

**Files:**
- Modify: `backend/src/api/projects.ts`

- [ ] **Step 1: Update the GET handler**

In `backend/src/api/projects.ts`, the `GET /` handler currently returns the raw list. Update it to use the new response shape:

```typescript
// GET /api/projects
projects.get("/", async (c) => {
  const user = c.get("user");
  const db = createSupabaseClient(c.env);
  const list = await listProjectsForUser(db, user.id);
  return c.json(list);
});
```

The `listProjectsForUser` function now returns objects with `owner_email` and `role` fields included, so this handler doesn't need to change much — just verify the import still works since the return type changed.

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/projects.ts
git commit -m "feat: GET /api/projects returns owner_email and role"
```

---

### Task 4: Export Endpoint

**Files:**
- Create: `backend/src/lib/export.ts`
- Modify: `backend/src/api/projects.ts`

- [ ] **Step 1: Create `backend/src/lib/export.ts`**

```typescript
import { zipSync, strToU8 } from "fflate";
import type { Entry } from "../db/types";

function buildFrontmatter(entry: Entry): string {
  const lines: string[] = ["---"];
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`tags: [${entry.tags.join(", ")}]`);
  }
  if (entry.source) {
    lines.push(`source: ${entry.source}`);
  }
  lines.push(`content_type: ${entry.content_type || "markdown"}`);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

export function buildProjectZip(
  projectName: string,
  entries: Entry[]
): Uint8Array {
  const files: Record<string, Uint8Array> = {};

  // Add metadata file
  const meta = JSON.stringify({
    version: 1,
    project_name: projectName,
    exported_at: new Date().toISOString(),
    entry_count: entries.length,
  }, null, 2);
  files["_synapse_meta.json"] = strToU8(meta);

  // Add each entry as a file
  for (const entry of entries) {
    if (entry.content_type === "json") {
      // JSON entries: raw content, .json extension
      const path = entry.path.endsWith(".json") ? entry.path : `${entry.path}.json`;
      files[path] = strToU8(entry.content);
    } else {
      // Markdown entries: YAML frontmatter + content
      const path = entry.path.endsWith(".md") ? entry.path : `${entry.path}.md`;
      const frontmatter = buildFrontmatter(entry);
      files[path] = strToU8(frontmatter + entry.content);
    }
  }

  return zipSync(files);
}
```

- [ ] **Step 2: Add export endpoint to `backend/src/api/projects.ts`**

Add the import at the top:

```typescript
import { buildProjectZip } from "../lib/export";
import { getAllEntries } from "../db/queries";
```

Add the endpoint before the `export { projects }` line:

```typescript
// GET /api/projects/:id/export
projects.get("/:id/export", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole) throw new NotFoundError("Project not found");

  // Get project name for the zip filename
  const { data: project } = await db
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  const entries = await getAllEntries(db, projectId);
  const zip = buildProjectZip(project?.name ?? "export", entries);

  const filename = `${(project?.name ?? "export").replace(/[^a-zA-Z0-9-_]/g, "_")}.zip`;

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 4: Run tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/export.ts backend/src/api/projects.ts
git commit -m "feat: add project export as zip endpoint"
```

---

### Task 5: Import Endpoint

**Files:**
- Create: `backend/src/lib/import.ts`
- Modify: `backend/src/api/projects.ts`

- [ ] **Step 1: Create `backend/src/lib/import.ts`**

```typescript
import { unzipSync, strFromU8 } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertEntry, getEntry } from "../db/queries";

interface ParsedEntry {
  path: string;
  content: string;
  content_type: "markdown" | "json";
  tags: string[];
  source: string;
}

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const fm: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse array: [tag1, tag2]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim()).filter(Boolean);
    }

    fm[key] = value;
  }

  return { frontmatter: fm, content: match[2] };
}

export function parseZipEntries(zipData: Uint8Array): { meta: Record<string, unknown>; entries: ParsedEntry[] } {
  const files = unzipSync(zipData);
  let meta: Record<string, unknown> = {};
  const entries: ParsedEntry[] = [];

  for (const [path, data] of Object.entries(files)) {
    const content = strFromU8(data);

    if (path === "_synapse_meta.json") {
      meta = JSON.parse(content);
      continue;
    }

    // Skip directories (fflate may include empty dir entries)
    if (path.endsWith("/")) continue;

    try {
      if (path.endsWith(".json")) {
        // JSON file — no frontmatter
        const entryPath = path.replace(/\.json$/, "");
        entries.push({
          path: entryPath,
          content,
          content_type: "json",
          tags: [],
          source: "human",
        });
      } else {
        // Markdown file — parse frontmatter
        const entryPath = path.replace(/\.md$/, "");
        const { frontmatter, content: body } = parseFrontmatter(content);
        entries.push({
          path: entryPath,
          content: body,
          content_type: (frontmatter.content_type as "markdown" | "json") ?? "markdown",
          tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
          source: (frontmatter.source as string) ?? "human",
        });
      }
    } catch {
      // Skip unparseable files — counted as skipped
    }
  }

  return { meta, entries };
}

export async function importEntries(
  db: SupabaseClient,
  projectId: string,
  entries: ParsedEntry[],
  authorId: string
): Promise<ImportResult> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    try {
      const existing = await getEntry(db, projectId, entry.path);

      await upsertEntry(db, {
        project_id: projectId,
        path: entry.path,
        content: entry.content,
        content_type: entry.content_type,
        tags: entry.tags,
        source: entry.source,
        author_id: authorId,
      });

      if (existing) {
        updated++;
      } else {
        imported++;
      }
    } catch {
      skipped++;
    }
  }

  return { imported, updated, skipped };
}
```

- [ ] **Step 2: Add import endpoint to `backend/src/api/projects.ts`**

Add the import at the top:

```typescript
import { parseZipEntries, importEntries } from "../lib/import";
import { countEntries } from "../db/queries";
import { getTierLimits } from "../lib/tier";
```

Add the endpoint:

```typescript
// POST /api/projects/:id/import
projects.post("/:id/import", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("id");

  const db = createSupabaseClient(c.env);
  const callerRole = await getMemberRole(db, projectId, user.id);
  if (!callerRole || callerRole === "viewer") {
    throw new ForbiddenError("Only owners and editors can import");
  }

  // Parse multipart form data
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    throw new AppError("file is required", 400, "VALIDATION_ERROR");
  }

  const arrayBuffer = await file.arrayBuffer();
  const zipData = new Uint8Array(arrayBuffer);

  let parsed;
  try {
    parsed = parseZipEntries(zipData);
  } catch {
    throw new AppError("Invalid zip file", 400, "VALIDATION_ERROR");
  }

  // Validate Synapse export
  if (!parsed.meta || parsed.meta.version !== 1) {
    throw new AppError("Not a valid Synapse export (missing or invalid _synapse_meta.json)", 400, "VALIDATION_ERROR");
  }

  // Tier enforcement: check if import would exceed file limit
  const currentCount = await countEntries(db, projectId);
  const existingPaths = new Set<string>();
  const { data: existingEntries } = await db
    .from("entries")
    .select("path")
    .eq("project_id", projectId);
  if (existingEntries) {
    for (const e of existingEntries) existingPaths.add(e.path);
  }

  const newEntryCount = parsed.entries.filter((e) => !existingPaths.has(e.path)).length;
  const limits = getTierLimits(c);
  if (currentCount + newEntryCount > limits.maxFiles) {
    throw new AppError(
      `Import would exceed file limit (${currentCount} existing + ${newEntryCount} new = ${currentCount + newEntryCount}, limit: ${limits.maxFiles})`,
      403,
      "TIER_LIMIT"
    );
  }

  const result = await importEntries(db, projectId, parsed.entries, user.id);

  return c.json(result);
});
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 4: Run tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/import.ts backend/src/api/projects.ts
git commit -m "feat: add project import from zip endpoint"
```

---

### Task 6: Frontend — Types and API Methods

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/server/api.ts`

- [ ] **Step 1: Update `frontend/src/lib/types.ts`**

Add `owner_email` and `role` to the `Project` interface:

```typescript
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
```

- [ ] **Step 2: Add API method for import to `frontend/src/lib/server/api.ts`**

Add to the `createApi` return object:

```typescript
    // Import
    importProject: async (projectId: string, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      // Can't use the request() helper — it forces Content-Type: application/json.
      // For multipart, we must let the browser set Content-Type with the boundary.
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const url = `${API_URL}/api/projects/${projectId}/import`;
      const res = await fetch(url, { method: "POST", headers, body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new ApiError(res.status, body.error || `Import failed: ${res.status}`);
      }
      return res.json() as Promise<{ imported: number; updated: number; skipped: number }>;
    },
```

Note: This bypasses the `request()` helper because it forces `Content-Type: application/json`. The `API_URL` import already exists at the top of the file. The `ApiError` class is also already defined.

The export endpoint doesn't need an API method — it's a direct download URL: `/api/projects/${projectId}/export` with Bearer auth header. The frontend can either:
- Use a hidden `<a>` tag (won't work with Bearer auth)
- Use fetch + blob download

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/server/api.ts
git commit -m "feat: add owner_email/role to Project type, add import API method"
```

---

### Task 7: Frontend — Project List and Shared Project Display

**Files:**
- Modify: `frontend/src/routes/(app)/projects/[name]/+layout.server.ts`
- Modify: `frontend/src/routes/(app)/+page.server.ts`

- [ ] **Step 1: Update `+layout.server.ts` to handle shared projects**

The layout currently matches projects by `p.name === params.name`. For shared projects, the URL might contain the `~` qualified name or just the project name. Update the matching:

```typescript
import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
  depends("app:project");

  const api = createApi(locals.token);
  const projects = await api.listProjects();

  // Match by name — handle both plain name and owner~name format
  const decodedName = decodeURIComponent(params.name);
  let project = projects.find((p) => p.name === decodedName);

  // If not found by plain name, try matching as owner~name
  if (!project && decodedName.includes("~")) {
    const tildeIdx = decodedName.indexOf("~");
    const ownerEmail = decodedName.slice(0, tildeIdx);
    const name = decodedName.slice(tildeIdx + 1);
    project = projects.find((p) => p.name === name && p.owner_email === ownerEmail);
  }

  // If still not found, try matching shared projects by name
  if (!project) {
    project = projects.find((p) => p.name === decodedName && p.role !== "owner");
  }

  if (!project) error(404, "Project not found");

  const [entries, shareLinks, activity] = await Promise.all([
    api.listEntries(params.name),
    api.listShareLinks(project.id).catch(() => []),
    api.getActivity(project.id, 50, 0).catch(() => []),
  ]);

  return { project, entries, shareLinks, activity };
};
```

- [ ] **Step 2: Update `+page.server.ts` redirect for shared projects**

The app homepage auto-redirects to the first project. Update to show the correct URL for shared projects:

```typescript
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();

  if (projects.length > 0) {
    const first = projects[0];
    const slug = first.role === "owner" ? first.name : `${first.owner_email}~${first.name}`;
    redirect(303, `/projects/${encodeURIComponent(slug)}`);
  }

  // Auto-create a default project for the user
  await api.createProject("My Workspace");
  redirect(303, `/projects/${encodeURIComponent("My Workspace")}`);
};
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/routes/(app)/projects/[name]/+layout.server.ts" "frontend/src/routes/(app)/+page.server.ts"
git commit -m "feat: handle shared projects in layout and homepage redirect"
```

---

### Task 8: Frontend — Export/Import Buttons

**Files:**
- Modify: `frontend/src/routes/(app)/projects/[name]/+page.svelte`
- Modify: `frontend/src/routes/(app)/projects/[name]/+page.server.ts`

- [ ] **Step 1: Add import action to `+page.server.ts`**

Add the import action to the existing actions object in `frontend/src/routes/(app)/projects/[name]/+page.server.ts`:

```typescript
  importProject: async ({ request, locals }) => {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const projectId = formData.get("projectId") as string;

    if (!file || !projectId) return fail(400, { error: "File and project ID required" });

    const api = createApi(locals.token);
    try {
      const result = await api.importProject(projectId, file);
      return { importResult: result };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Import failed" });
    }
  },
```

- [ ] **Step 2: Add Export/Import buttons to `+page.svelte`**

In the sidebar header area of the page (where the "Files" label and "+ New" button are), add Export and Import buttons. Find the sidebar header section and add:

The backend export endpoint requires Bearer auth, so a simple `<a>` download link won't work. Instead, add a SvelteKit proxy route (follows the existing pattern in `api/entry/+server.ts` and `api/search/+server.ts`).

Create `frontend/src/routes/(app)/projects/[name]/api/export/+server.ts`:

```typescript
import type { RequestHandler } from "./$types";
import { API_URL } from "$env/static/private";

export const GET: RequestHandler = async ({ locals, params }) => {
  const projects = await (await fetch(`${API_URL}/api/projects`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  })).json();

  const project = projects.find((p: any) => p.name === params.name);
  if (!project) return new Response("Not found", { status: 404 });

  const res = await fetch(`${API_URL}/api/projects/${project.id}/export`, {
    headers: { Authorization: `Bearer ${locals.token}` },
  });

  return new Response(res.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": res.headers.get("Content-Disposition") ?? `attachment; filename="export.zip"`,
    },
  });
};
```

Update the sidebar header in `+page.svelte` to replace the existing `+ New` button area with:

```svelte
<div class="flex items-center gap-1">
  <button onclick={() => startNew()}
    class="cursor-pointer" style="color: var(--color-link); font-size: 10px;">+ New</button>
  <a href={`/projects/${encodeURIComponent(data.project.name)}/api/export`}
    class="cursor-pointer" style="color: var(--color-link); font-size: 10px;"
    download>Export</a>
  <button onclick={() => importInput?.click()}
    class="cursor-pointer" style="color: var(--color-link); font-size: 10px;">Import</button>
</div>
```

Add to the script section:

```typescript
let importInput: HTMLInputElement;
let importForm: HTMLFormElement;
```

Add a hidden import form at the end of the component (before the closing `</div>`):

```svelte
<form method="POST" action="?/importProject" enctype="multipart/form-data" use:enhance
  class="hidden" bind:this={importForm}>
  <input type="hidden" name="projectId" value={data.project.id} />
  <input type="file" name="file" accept=".zip" bind:this={importInput}
    onchange={() => importForm?.requestSubmit()} />
</form>
```

The export link points to the SvelteKit proxy route (created above), which handles auth transparently. The import form submits to the `importProject` server action.

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -40`

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/routes/(app)/projects/[name]/+page.svelte" "frontend/src/routes/(app)/projects/[name]/+page.server.ts" "frontend/src/routes/(app)/projects/[name]/api/export/+server.ts"
git commit -m "feat: add export/import buttons to project page"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full backend type check**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 2: Run full backend tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 3: Run full frontend check**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-kit sync && npx svelte-check 2>&1 | head -50`

- [ ] **Step 4: Verify clean working tree**

Run: `git status`
