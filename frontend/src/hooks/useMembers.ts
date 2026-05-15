import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useAddMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.addMember(projectId, email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => api.removeMember(projectId, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}
