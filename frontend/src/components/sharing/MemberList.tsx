import { useRemoveMember } from "../../hooks/useMembers";
import type { ProjectMember } from "../../types";

interface Props {
  projectId: string;
  members: ProjectMember[];
}

export function MemberList({ projectId, members }: Props) {
  const removeMember = useRemoveMember(projectId);

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.user_id} className="flex items-center justify-between bg-white border rounded p-3">
          <div>
            <span className="text-sm">{m.email ?? m.user_id}</span>
            <span className="ml-2 text-xs bg-gray-100 rounded px-1.5 py-0.5">{m.role}</span>
          </div>
          {m.role !== "owner" && (
            <button
              onClick={() => m.email && removeMember.mutate(m.email)}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
