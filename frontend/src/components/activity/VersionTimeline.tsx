import type { EntryHistory } from "../../types";

interface Props {
  versions: EntryHistory[];
  onRestore: (historyId: string) => void;
}

export function VersionTimeline({ versions, onRestore }: Props) {
  return (
    <div className="space-y-3">
      {versions.map((v) => (
        <div key={v.id} className="bg-white border rounded p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500">
              {new Date(v.changed_at).toLocaleString()} · {v.source}
            </div>
            <button
              onClick={() => onRestore(v.id)}
              className="text-xs text-blue-600 hover:underline"
            >
              Restore this version
            </button>
          </div>
          <pre className="text-xs font-mono bg-gray-50 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {v.content}
          </pre>
        </div>
      ))}
      {!versions.length && <p className="text-gray-400 text-sm">No version history</p>}
    </div>
  );
}
