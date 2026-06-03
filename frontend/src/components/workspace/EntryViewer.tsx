import { Link, useParams } from "react-router-dom";
import type { Entry } from "../../types";

interface Props {
  entry: Entry;
  onEdit: () => void;
}

export function EntryViewer({ entry, onEdit }: Props) {
  const { name } = useParams<{ name: string }>();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-medium">{entry.path}</h2>
          <div className="text-xs text-gray-500 mt-1">
            {entry.source} · {new Date(entry.updated_at).toLocaleString()}
            {entry.tags.length > 0 && (
              <span className="ml-2">
                {entry.tags.map((t) => (
                  <span key={t} className="inline-block bg-gray-100 rounded px-1.5 py-0.5 text-xs mr-1">
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/projects/${name}/history/${encodeURIComponent(entry.path)}`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            History
          </Link>
          <button onClick={onEdit} className="text-sm text-blue-600 hover:underline">
            Edit
          </button>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 whitespace-pre-wrap font-mono text-sm">
        {entry.content}
      </div>
    </div>
  );
}
