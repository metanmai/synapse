import { Hono } from "hono";
import { countOwnedProjects, findOrCreateProjectByGit } from "../db/queries/projects";
import { authMiddleware } from "../lib/auth";
import type { Env } from "../lib/env";
import { recomputeProjectStatus } from "../lib/handoff-reducer";
import { enforceProjectQuota } from "../lib/tier";

const SKEW_LIMIT_MS = 5 * 60 * 1000;
const CWD_HASH_PATTERN = /^cwd_[a-f0-9]{12}$/;

const eventsBatch = new Hono<{ Bindings: Env }>();
eventsBatch.use("*", authMiddleware);

interface BatchEvent {
  event_id: unknown;
  project_id: unknown;
  session_id: unknown;
  actor: unknown;
  attached_to?: unknown;
  kind: unknown;
  occurred_at: unknown;
  payload?: unknown;
}

interface RowMutable {
  event_id: string;
  project_id: string;
  session_id: string;
  actor_user_id: string;
  actor_kind: string;
  actor_device_id: string;
  attached_to: unknown;
  kind: string;
  occurred_at: string;
  received_at: string;
  payload: unknown;
}

eventsBatch.post("/batch", async (c) => {
  const body = await c.req.json<{ events: BatchEvent[] }>();
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return c.json({ error: "events array required" }, 400);
  }
  const user = c.get("user");
  const db = c.get("db");
  const now = Date.now();
  const adjusted: string[] = [];

  const rows: RowMutable[] = body.events.map((e) => {
    const eventId = String(e.event_id);
    const occMs = new Date(String(e.occurred_at)).getTime();
    let occurred_at = String(e.occurred_at);
    if (occMs - now > SKEW_LIMIT_MS) {
      adjusted.push(eventId);
      occurred_at = new Date(now).toISOString();
    }
    const actor = e.actor as { kind: string; device_id: string };
    return {
      event_id: eventId,
      project_id: String(e.project_id),
      session_id: String(e.session_id),
      actor_user_id: user.id,
      actor_kind: actor.kind,
      actor_device_id: actor.device_id,
      attached_to: e.attached_to ?? null,
      kind: String(e.kind),
      occurred_at,
      received_at: new Date(now).toISOString(),
      payload: e.payload ?? {},
    };
  });

  // Auto-create projects for `cwd_<hash>` placeholder project_ids.
  // The hook dispatcher writes `cwd_<sha1[0..12]>` when no project-map entry
  // exists; here we materialize that into a real project, owned by the caller.
  // The map is returned in the response so the daemon can rename its local dir.
  const cwdHashIds = [...new Set(rows.filter((r) => CWD_HASH_PATTERN.test(r.project_id)).map((r) => r.project_id))];
  const idMapping = new Map<string, string>();

  if (cwdHashIds.length > 0) {
    for (const cwdHash of cwdHashIds) {
      const sample = body.events.find((e) => String(e.project_id) === cwdHash);
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

    for (const r of rows) {
      const remapped = idMapping.get(r.project_id);
      if (remapped) r.project_id = remapped;
    }
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
