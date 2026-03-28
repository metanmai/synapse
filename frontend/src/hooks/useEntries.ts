import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useEntryList(project: string, folder?: string) {
  return useQuery({
    queryKey: ["entries", project, folder],
    queryFn: () => api.listEntries(project, folder),
    enabled: !!project,
  });
}

export function useEntry(project: string, path: string) {
  return useQuery({
    queryKey: ["entry", project, path],
    queryFn: () => api.getEntry(project, path),
    enabled: !!project && !!path,
  });
}

export function useSaveEntry(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content, tags }: { path: string; content: string; tags?: string[] }) =>
      api.saveEntry(project, path, content, tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", project] });
      qc.invalidateQueries({ queryKey: ["entry", project] });
    },
  });
}

export function useSearchEntries(project: string, query: string) {
  return useQuery({
    queryKey: ["search", project, query],
    queryFn: () => api.searchEntries(project, query),
    enabled: !!project && query.length > 1,
  });
}

export function useEntryHistory(project: string, path: string) {
  return useQuery({
    queryKey: ["history", project, path],
    queryFn: () => api.getEntryHistory(project, path),
    enabled: !!project && !!path,
  });
}

export function useRestoreEntry(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, historyId }: { path: string; historyId: string }) =>
      api.restoreEntry(project, path, historyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entries", project] });
      qc.invalidateQueries({ queryKey: ["entry", project] });
      qc.invalidateQueries({ queryKey: ["history", project] });
    },
  });
}
