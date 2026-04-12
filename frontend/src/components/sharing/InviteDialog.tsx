import { useState } from "react";
import { useAddMember } from "../../hooks/useMembers";

interface Props { projectId: string; }

export function InviteDialog({ projectId }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState("");
  const addMember = useAddMember(projectId);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await addMember.mutateAsync({ email, role });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={handleInvite} className="flex gap-2 items-end">
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
        required
      />
      <select value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")} className="border border-gray-300 rounded px-3 py-2 text-sm">
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm">Invite</button>
      {error && <span className="text-red-600 text-sm">{error}</span>}
    </form>
  );
}
