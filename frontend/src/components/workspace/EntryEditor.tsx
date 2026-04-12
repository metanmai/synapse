import { useState } from "react";

interface Props {
  initialContent?: string;
  initialPath?: string;
  initialTags?: string[];
  onSave: (path: string, content: string, tags: string[]) => void;
  onCancel: () => void;
  isNew?: boolean;
}

export function EntryEditor({ initialContent = "", initialPath = "", initialTags = [], onSave, onCancel, isNew }: Props) {
  const [path, setPath] = useState(initialPath);
  const [content, setContent] = useState(initialContent);
  const [tagsInput, setTagsInput] = useState(initialTags.join(", "));

  const handleSave = () => {
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    onSave(path, content, tags);
  };

  return (
    <div className="space-y-4">
      {isNew && (
        <input
          type="text"
          placeholder="Path (e.g., decisions/chose-react.md)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
        />
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono min-h-[400px]"
        placeholder="Content (markdown)"
      />
      <input
        type="text"
        placeholder="Tags (comma-separated)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button onClick={handleSave} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
          Save
        </button>
        <button onClick={onCancel} className="text-gray-500 text-sm hover:text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
