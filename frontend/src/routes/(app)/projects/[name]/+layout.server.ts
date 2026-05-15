import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
  depends("app:project");

  const api = createApi(locals.token);
  const projects = await api.listProjects();

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

  if (!project) error(404, "Project not found");

  const [entries, shareLinks, activity] = await Promise.all([
    api.listEntries(params.name),
    api.listShareLinks(project.id).catch(() => []),
    api.getActivity(project.id, 50, 0).catch(() => []),
  ]);

  return { project, entries, shareLinks, activity };
};
