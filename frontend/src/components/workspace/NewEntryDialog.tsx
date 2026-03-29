import { EntryEditor } from "./EntryEditor";

interface Props {
  onSave: (path: string, content: string, tags: string[]) => void;
  onCancel: () => void;
}

export function NewEntryDialog({ onSave, onCancel }: Props) {
  return (
    <div>
      <h2 className="text-lg font-medium mb-4">New Entry</h2>
      <EntryEditor isNew onSave={onSave} onCancel={onCancel} />
    </div>
  );
}
