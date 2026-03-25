import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useActivity(projectId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["activity", projectId, limit, offset],
    queryFn: () => api.getActivity(projectId, limit, offset),
    enabled: !!projectId,
  });
}
