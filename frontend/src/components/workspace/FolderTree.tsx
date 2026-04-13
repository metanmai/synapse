import type { EntryListItem } from "../../types";

interface Props {
  entries: EntryListItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function buildTree(entries: EntryListItem[]) {
  const tree: Record<string, string[]> = {};
  for (const entry of entries) {
    const parts = entry.path.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
    if (!tree[folder]) tree[folder] = [];
    tree[folder].push(entry.path);
  }
  return tree;
}

export function FolderTree({ entries, selectedPath, onSelect }: Props) {
  const tree = buildTree(entries);
  const folders = Object.keys(tree).sort();

  return (
    <div className="text-sm">
      {folders.map((folder) => (
        <div key={folder} className="mb-3">
          <div className="font-medium text-gray-500 text-xs uppercase tracking-wide px-2 mb-1">
            {folder}
          </div>
          {tree[folder].map((path) => {
            const filename = path.split("/").pop();
            return (
              <button
                key={path}
                onClick={() => onSelect(path)}
                className={`w-full text-left px-2 py-1 rounded text-sm truncate ${
                  selectedPath === path
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {filename}
              </button>
            );
          })}
        </div>
      ))}
      {!entries.length && (
        <p className="text-gray-400 text-xs px-2">No entries yet</p>
      )}
    </div>
  );
}
