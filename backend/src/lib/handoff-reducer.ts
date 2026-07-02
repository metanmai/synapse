import type { SupabaseClient } from "@supabase/supabase-js";
import { applyEvents, reduce } from "@synapse/shared/handoff/reducer.js";
import type { Event, ProjectStatus } from "@synapse/shared/handoff/types.js";

// Bounds staleness from the incremental fast path. If more than this much
// wall-clock time has elapsed since the last full reduce, we discard the
// incremental path and re-fold from DB truth. Catches: late-arriving
// out-of-order events that slipped past the watermark filter (and would
// otherwise sit un-folded until forever); transient recompute failures that
// left the status in an inconsistent state. Five minutes matches the daemon's
// retry backoff cap and is small relative to user-perceived latency on the
// "what's my project doing" surface.
const FULL_RECOMPUTE_INTERVAL_MS = 5 * 60 * 1000;

export async function recomputeProjectStatus(db: SupabaseClient, project_id: string): Promise<void> {
  // Read the current materialized status (if any). The optional chaining
  // through the row → status → _meta path tolerates: first-ever recompute
  // (no row), and rows persisted before BUGS.md #11 fix landed (no _meta).
  const currentRow = await db
    .from("handoff_project_status")
    .select("status")
    .eq("project_id", project_id)
    .maybeSingle();
  if (currentRow.error) throw currentRow.error;

  const currentStatus = (currentRow.data?.status as ProjectStatus | undefined) ?? undefined;
  const lastFullAt = currentStatus?._meta?.last_full_recompute_at;
  const watermark = getOccurredAtWatermark(currentStatus);

  // Three preconditions for the incremental fast path:
  //   1. We have a current status (otherwise nothing to apply to).
  //   2. _meta.last_full_recompute_at exists AND is recent — bounds the
  //      window during which late-arriving events could go un-folded.
  //   3. recent_activity carries a watermark — without one we'd be querying
  //      "all events strictly greater than null", which doesn't help.
  const canTryIncremental =
    currentStatus !== undefined &&
    lastFullAt !== undefined &&
    Date.now() - new Date(lastFullAt).getTime() < FULL_RECOMPUTE_INTERVAL_MS &&
    watermark !== null;

  if (canTryIncremental && currentStatus !== undefined && watermark !== null) {
    // Cheap delta query: only events with occurred_at strictly greater than
    // our watermark. The cost is O(events_since_last_recompute), not
    // O(events_lifetime).
    const { data: newRows, error: newErr } = await db
      .from("handoff_events")
      .select("*")
      .eq("project_id", project_id)
      .gt("occurred_at", watermark)
      .order("occurred_at", { ascending: true });
    if (newErr) throw newErr;

    const candidate: Event[] = (newRows ?? []).map(rowToEvent);

    // Dedup defensively: events with the SAME occurred_at as items in
    // recent_activity are excluded by `.gt` (strict >), but a hypothetical
    // future change to `.gte` or a race against a retried upsert could let
    // through an event_id we've already folded. Set-based filter is cheap.
    const seenIds = new Set(currentStatus.recent_activity.map((e) => e.event_id));
    const trulyNew = candidate.filter((e) => !seenIds.has(e.event_id));

    const incremental = applyEvents(currentStatus, trulyNew);
    if (incremental !== null) {
      // Preserve _meta.last_full_recompute_at across the incremental hop —
      // only the full-recompute path stamps a fresh value.
      const next: ProjectStatus = currentStatus._meta
        ? { ...incremental, _meta: { ...currentStatus._meta } }
        : incremental;
      const { error: upErr } = await db.from("handoff_project_status").upsert({
        project_id,
        status: next,
        updated_at: new Date().toISOString(),
      });
      if (upErr) throw upErr;
      return;
    }
    // applyEvents returned null — fall through to the full recompute below.
  }

  // Full-recompute path. Unchanged read pattern (all events for this project)
  // plus an _meta stamp so the next call can take the incremental fast path.
  const { data: rows, error } = await db
    .from("handoff_events")
    .select("*")
    .eq("project_id", project_id)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  const events: Event[] = (rows ?? []).map(rowToEvent);
  const status = reduce(events, project_id);
  const stamped: ProjectStatus = {
    ...status,
    _meta: { last_full_recompute_at: new Date().toISOString() },
  };
  const { error: upErr } = await db.from("handoff_project_status").upsert({
    project_id,
    status: stamped,
    updated_at: new Date().toISOString(),
  });
  if (upErr) throw upErr;
}

// Watermark for the incremental DB query. `recent_activity` is sorted by
// orderKey (which == occurred_at for non-skewed events), so the maximum
// `occurred_at` across recent_activity bounds "everything strictly older
// is already folded into the current status." Returning null signals the
// caller to fall back to full recompute.
function getOccurredAtWatermark(s: ProjectStatus | undefined): string | null {
  if (!s || s.recent_activity.length === 0) return null;
  let max: string | null = null;
  for (const e of s.recent_activity) {
    if (max === null || e.occurred_at > max) max = e.occurred_at;
  }
  return max;
}

function rowToEvent(r: Record<string, unknown>): Event {
  return {
    event_id: String(r.event_id),
    project_id: String(r.project_id),
    session_id: String(r.session_id),
    actor: {
      user_id: String(r.actor_user_id),
      kind: r.actor_kind as "human" | "synapse-daemon",
      device_id: String(r.actor_device_id),
      hostname: "",
      client: "unknown",
    },
    attached_to: r.attached_to as Event["attached_to"],
    kind: r.kind as Event["kind"],
    occurred_at: String(r.occurred_at),
    received_at: String(r.received_at),
    payload: (r.payload ?? {}) as Record<string, unknown>,
  };
}
