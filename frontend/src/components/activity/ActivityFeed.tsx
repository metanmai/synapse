import type { ActivityLogEntry } from "../../types";

interface Props { entries: ActivityLogEntry[]; }

const actionLabels: Record<string, string> = {
  entry_created: "created",
  entry_updated: "updated",
  entry_deleted: "deleted",
  member_added: "added member",
  member_removed: "removed member",
  settings_changed: "changed settings",
  share_link_created: "created share link",
  share_link_revoked: "revoked share link",
};

export function ActivityFeed({ entries }: Props) {
  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <div key={e.id} className="bg-white border rounded p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">{actionLabels[e.action] ?? e.action}</span>
            <span className="text-xs bg-gray-100 rounded px-1.5 py-0.5">{e.source}</span>
            <span className="text-xs text-gray-400 ml-auto">{new Date(e.created_at).toLocaleString()}</span>
          </div>
          {e.target_path && <div className="text-gray-600 text-xs mt-1 font-mono">{e.target_path}</div>}
          {e.target_email && <div className="text-gray-600 text-xs mt-1">{e.target_email}</div>}
        </div>
      ))}
      {!entries.length && <p className="text-gray-400 text-sm">No activity yet</p>}
    </div>
  );
}
