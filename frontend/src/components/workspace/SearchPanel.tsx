import { useState } from "react";
import { useSearchEntries } from "../../hooks/useEntries";

interface Props {
  project: string;
  onSelect: (path: string) => void;
}

export function SearchPanel({ project, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const { data: results } = useSearchEntries(project, query);

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search context..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        autoFocus
      />
      {results?.map((entry: any) => (
        <button
          key={entry.id}
          onClick={() => onSelect(entry.path)}
          className="w-full text-left bg-white border border-gray-200 rounded p-3 hover:border-blue-300 text-sm"
        >
          <div className="font-medium">{entry.path}</div>
          <div className="text-gray-500 text-xs mt-1 line-clamp-2">{entry.content.slice(0, 150)}</div>
        </button>
      ))}
    </div>
  );
}
