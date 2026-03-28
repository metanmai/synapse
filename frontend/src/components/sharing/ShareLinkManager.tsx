import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

interface Props { projectId: string; }

export function ShareLinkManager({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: links = [] } = useQuery({
    queryKey: ["share-links", projectId],
    queryFn: () => api.listShareLinks(projectId),
  });
  const createLink = useMutation({
    mutationFn: (role: string) => api.createShareLink(projectId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share-links", projectId] }),
  });
  const deleteLink = useMutation({
    mutationFn: (token: string) => api.deleteShareLink(projectId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share-links", projectId] }),
  });
  const [copied, setCopied] = useState<string | null>(null);

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => createLink.mutate("viewer")}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Create viewer link
        </button>
        <button
          onClick={() => createLink.mutate("editor")}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Create editor link
        </button>
      </div>
      <div className="space-y-2">
        {links.map((link: any) => (
          <div key={link.id} className="flex items-center justify-between bg-white border rounded p-3 text-sm">
            <div>
              <span className="font-mono text-xs">{link.token.slice(0, 12)}...</span>
              <span className="ml-2 text-xs bg-gray-100 rounded px-1.5 py-0.5">{link.role}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => copyLink(link.token)} className="text-xs text-blue-600 hover:underline">
                {copied === link.token ? "Copied!" : "Copy"}
              </button>
              <button onClick={() => deleteLink.mutate(link.token)} className="text-xs text-red-600 hover:underline">
                Revoke
              </button>
            </div>
          </div>
        ))}
        {!links.length && <p className="text-gray-400 text-sm">No share links yet</p>}
      </div>
    </div>
  );
}
