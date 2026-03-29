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
