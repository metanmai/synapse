export interface FeedEvent {
  type: "captured" | "distilled" | "updated";
  timestamp: string;
  title: string;
  metadata: string;
  files?: { path: string }[];
  badge: string;
  badgeClass: string;
}

export interface DayGroup {
  label: string;
  events: FeedEvent[];
}

export function buildFeedEvent(entry: {
  action: string;
  source: string;
  target_path: string | null;
  created_at: string;
}): FeedEvent {
  // Conversation-related actions
  if (entry.action === "conversation_created" || entry.action === "conversation_synced") {
    return {
      type: "captured",
      timestamp: entry.created_at,
      title: "Session synced",
      metadata: `${entry.source} · ${entry.target_path ?? "session"}`,
      badge: "CAPTURED",
      badgeClass: "badge-captured",
    };
  }

  // Distilled content
  if (entry.source === "distill") {
    return {
      type: "distilled",
      timestamp: entry.created_at,
      title: "Knowledge extracted",
      metadata: "From distill",
      files: entry.target_path ? [{ path: entry.target_path }] : [],
      badge: "DISTILLED",
      badgeClass: "badge-distilled",
    };
  }

  // Default: file events
  const title =
    entry.action === "entry_created"
      ? "File created"
      : entry.action === "entry_deleted"
        ? "File deleted"
        : "File updated";
  return {
    type: "updated",
    timestamp: entry.created_at,
    title,
    metadata: entry.target_path ?? "",
    badge: "UPDATED",
    badgeClass: "badge-updated",
  };
}

export function groupByDay(events: FeedEvent[]): DayGroup[] {
  const groups = new Map<string, FeedEvent[]>();
  const today = new Date().toLocaleDateString();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();

  for (const event of events) {
    const dateStr = new Date(event.timestamp).toLocaleDateString();
    let label = dateStr;
    if (dateStr === today) label = "Today";
    else if (dateStr === yesterday) label = "Yesterday";

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)?.push(event);
  }

  return Array.from(groups.entries()).map(([label, events]) => ({
    label,
    events,
  }));
}

export const actionLabels: Record<string, string> = {
  entry_created: "created",
  entry_updated: "updated",
  entry_deleted: "deleted",
  member_added: "added member",
  member_removed: "removed member",
  settings_changed: "changed settings",
  share_link_created: "created share link",
  share_link_revoked: "revoked share link",
};

export function getActionLabel(action: string): string {
  return actionLabels[action] ?? action;
}
