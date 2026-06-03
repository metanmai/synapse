import type { SupabaseClient } from "@supabase/supabase-js";
import { reduce } from "@synapse/shared/handoff/reducer.js";
import type { Event } from "@synapse/shared/handoff/types.js";

export async function recomputeProjectStatus(db: SupabaseClient, project_id: string): Promise<void> {
  const { data: rows, error } = await db
    .from("handoff_events")
    .select("*")
    .eq("project_id", project_id)
    .order("occurred_at", { ascending: true });
  if (error) throw error;
  const events: Event[] = (rows ?? []).map(rowToEvent);
  const status = reduce(events, project_id);
  await db.from("handoff_project_status").upsert({
    project_id,
    status,
    updated_at: new Date().toISOString(),
  });
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
      client: "claude-code",
    },
    attached_to: r.attached_to as Event["attached_to"],
    kind: r.kind as Event["kind"],
    occurred_at: String(r.occurred_at),
    received_at: String(r.received_at),
    payload: (r.payload ?? {}) as Record<string, unknown>,
  };
}
