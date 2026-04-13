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
  const { data: memberRows } = await db.from("project_members").select("project_id").eq("user_id", user.id);
  const memberIds = (memberRows ?? []).map((r: { project_id: string }) => r.project_id);
  const accessibleIds = new Set<string>([...memberIds]);
  // Also include owned projects
  const { data: ownedRows } = await db.from("projects").select("id").eq("user_id", user.id);
  for (const o of ownedRows ?? []) accessibleIds.add((o as { id: string }).id);

  if (accessibleIds.size === 0) {
    return c.json({ project_id: null, name: null, confidence: null, signal: "no_access" });
  }
  const accessibleArray = Array.from(accessibleIds);

  // 1. Name match
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

  // 2. Historical cwd match
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

  // 3. Historical git origin match
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

  return c.json({ project_id: null, name: null, confidence: null, signal: "no_match" });
});

export { projectsResolve };
