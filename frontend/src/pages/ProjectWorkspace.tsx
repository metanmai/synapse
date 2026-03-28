import { useState } from "react";
import { useParams } from "react-router-dom";

import { Sidebar } from "../components/layout";
import { FolderTree, EntryViewer, EntryEditor, SearchPanel, NewEntryDialog } from "../components/workspace";
import { useEntryList, useEntry, useSaveEntry } from "../hooks/useEntries";

export function ProjectWorkspace() {
  const { name } = useParams<{ name: string }>();
  const { data: entries = [] } = useEntryList(name!);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "new" | "search">("view");
  const { data: entry } = useEntry(name!, selectedPath ?? "");
  const saveEntry = useSaveEntry(name!);

  const handleSave = async (path: string, content: string, tags: string[]) => {
    await saveEntry.mutateAsync({ path, content, tags });
    setSelectedPath(path);
    setMode("view");
  };

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <Sidebar />
      <div className="w-64 border-r border-gray-200 bg-white p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase">Files</span>
          <div className="flex gap-1">
            <button
              onClick={() => setMode("search")}
              className="text-xs text-gray-500 hover:text-gray-700 px-1"
            >
              Search
            </button>
            <button
              onClick={() => setMode("new")}
              className="text-xs text-blue-600 hover:underline px-1"
            >
              + New
            </button>
          </div>
        </div>
        <FolderTree entries={entries} selectedPath={selectedPath} onSelect={(p) => { setSelectedPath(p); setMode("view"); }} />
      </div>
      <div className="flex-1 p-6 overflow-y-auto">
        {mode === "search" && (
          <SearchPanel project={name!} onSelect={(p) => { setSelectedPath(p); setMode("view"); }} />
        )}
        {mode === "new" && (
          <NewEntryDialog onSave={handleSave} onCancel={() => setMode("view")} />
        )}
        {mode === "view" && entry && (
          <EntryViewer entry={entry} onEdit={() => setMode("edit")} />
        )}
        {mode === "edit" && entry && (
          <EntryEditor
            initialContent={entry.content}
            initialPath={entry.path}
            initialTags={entry.tags}
            onSave={handleSave}
            onCancel={() => setMode("view")}
          />
        )}
        {mode === "view" && !selectedPath && (
          <div className="text-gray-400 text-center mt-20">Select a file or create a new one</div>
        )}
      </div>
    </div>
  );
}
