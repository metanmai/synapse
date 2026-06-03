import { Hono } from "hono";
import { countOwnedProjects, findOrCreateProjectByGit } from "../db/queries/projects";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { recomputeProjectStatus } from "../lib/handoff-reducer";
import { enforceProjectQuota } from "../lib/tier";
import {
  type BatchEvent,
  applyIdMapping,
  extractCwdHashes,
  prepareEventRows,
  validateEventsBatchBody,
} from "./events-batch-pure";

const eventsBatch = new Hono<{ Bindings: Env }>();
eventsBatch.use("*", authMiddleware);

eventsBatch.post("/batch", async (c) => {
  const body = await c.req.json<unknown>();
  const v = validateEventsBatchBody(body);
  if (!v.ok) return c.json({ error: v.reason }, 400);

  const user = c.get("user");
  const db = c.get("db");
  const now = Date.now();

  const { rows, adjusted_event_ids: adjusted } = prepareEventRows(v.events, user.id, now);

  // Auto-create projects for `cwd_<hash>` placeholder project_ids.
  // The hook dispatcher writes `cwd_<sha1[0..12]>` when no project-map entry
  // exists; here we materialize that into a real project, owned by the caller.
  // The map is returned in the response so the daemon can rename its local dir.
  const cwdHashIds = extractCwdHashes(rows);
  const idMapping = new Map<string, string>();

  if (cwdHashIds.length > 0) {
    for (const cwdHash of cwdHashIds) {
      const sample = v.events.find((e: BatchEvent) => String(e.project_id) === cwdHash);
      const payload = (sample?.payload ?? {}) as { git_basename?: string; git_remote_url?: string };
      // The daemon's primary new-project creation path. Free users come
      // through here every time they `cd` into a fresh repo and run their
      // AI tool — far more often than POST /api/projects. Without this
      // gate, the quota check on the POST endpoint is window dressing.
      // The callback re-counts on every potential INSERT so multiple
      // new-project cwdHashes in one batch each see the updated count.
      const resolvedId = await findOrCreateProjectByGit(
        db,
        user.id,
        { git_basename: payload.git_basename, git_remote_url: payload.git_remote_url },
        {
          onWillCreate: async () => {
            const count = await countOwnedProjects(db, user.id);
            enforceProjectQuota(count, c);
          },
        },
      );
      idMapping.set(cwdHash, resolvedId);
    }

    applyIdMapping(rows, idMapping);
  }

  const { error, count } = await db
    .from("handoff_events")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;

  const accepted = count ?? rows.length;
  const duplicates = rows.length - accepted;

  // Per BUG-01 forensic (2026-05-20): a Supabase-side error inside
  // recomputeProjectStatus (e.g., handoff_events missing from schema cache)
  // used to escape this Promise.all as an unhandled rejection, surfacing as
  // an opaque Cloudflare 1101 outside Hono's app.onError boundary.
  //
  // Promise.allSettled isolates per-project failures: the events upsert
  // above has already succeeded (rows are durable), so a recompute failure
  // is a side-effect issue — the reducer is idempotent and the next batch
  // will recompute from the now-stored events. Log the rejection so it
  // shows up in Sentry once Plan 05 wires it; return 200 with the optional
  // recompute_errors array so the daemon / dashboard can see which
  // projects had partial side-effects.
  //
  // TODO: BUGS.md #5a — integration tests for this path are .skip'd until
  // a test Supabase env exists. The behavioral contract (rejection inside
  // recomputeProjectStatus does not 1101) cannot be unit-tested without it.
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const recomputeResults = await Promise.allSettled(projectIds.map((pid) => recomputeProjectStatus(db, pid)));
  const recomputeErrors: string[] = [];
  for (let i = 0; i < recomputeResults.length; i++) {
    const result = recomputeResults[i];
    if (result.status === "rejected") {
      const pid = projectIds[i];
      console.error("[events-batch] recomputeProjectStatus rejected", pid, result.reason);
      recomputeErrors.push(pid);
    }
  }

  return c.json({
    accepted,
    duplicates,
    adjusted,
    canonical_project_ids: Object.fromEntries(idMapping),
    ...(recomputeErrors.length > 0 ? { recompute_errors: recomputeErrors } : {}),
  });
});

export { eventsBatch };
