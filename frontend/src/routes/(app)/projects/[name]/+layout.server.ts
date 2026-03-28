import { ApiError, createApi } from "$lib/server/api";
import type { EntryListItem, Project } from "$lib/types";
import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
  depends("app:project");

  const api = createApi(locals.token);

  let projects: Project[];
  try {
    projects = await api.listProjects();
  } catch (err) {
    if (err instanceof ApiError) {
      error(err.status, err.message);
    }
    error(500, `Failed to list projects: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Match by name — handle both plain name and owner~name format
  const decodedName = decodeURIComponent(params.name);
  let project = projects.find((p) => p.name === decodedName);

  // If not found by plain name, try matching as owner~name
  if (!project && decodedName.includes("~")) {
    const tildeIdx = decodedName.indexOf("~");
    const ownerEmail = decodedName.slice(0, tildeIdx);
    const name = decodedName.slice(tildeIdx + 1);
    project = projects.find((p) => p.name === name && p.owner_email === ownerEmail);
  }

  // If still not found, try matching shared projects by name
  if (!project) {
    project = projects.find((p) => p.name === decodedName && p.role !== "owner");
  }

  if (!project) error(404, `Project "${decodedName}" not found. You have ${projects.length} project(s).`);

  let entries: EntryListItem[];
  try {
    entries = await api.listEntries(params.name);
  } catch (err) {
    if (err instanceof ApiError) {
      error(err.status, `Failed to list entries: ${err.message}`);
    }
    error(500, `Failed to list entries: ${err instanceof Error ? err.message : String(err)}`);
  }

  const [shareLinks, activity] = await Promise.all([
    api.listShareLinks(project.id).catch(() => []),
    api.getActivity(project.id, 50, 0).catch(() => []),
  ]);

  return { project, entries, shareLinks, activity };
};
