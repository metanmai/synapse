import { useParams } from "react-router-dom";

import { Sidebar } from "../components/layout";
import { VersionTimeline } from "../components/activity";
import { useEntryHistory, useRestoreEntry } from "../hooks/useEntries";

export function HistoryPage() {
  const { name, "*": path } = useParams<{ name: string; "*": string }>();
  const { data: history = [] } = useEntryHistory(name!, path ?? "");
  const restoreEntry = useRestoreEntry(name!);

  const handleRestore = async (historyId: string) => {
    if (!path) return;
    await restoreEntry.mutateAsync({ path, historyId });
  };

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="flex-1 p-6 overflow-y-auto max-w-3xl">
        <h1 className="text-xl font-semibold mb-2">Version History</h1>
        <p className="text-sm text-gray-500 mb-6 font-mono">{path}</p>
        <VersionTimeline versions={history} onRestore={handleRestore} />
      </div>
    </div>
  );
}
