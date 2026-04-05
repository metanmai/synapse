import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
  // Only re-run this layout when explicitly invalidated, not on every navigation
  depends("app:project");

  const api = createApi(locals.token);

  // First get the project
  const projects = await api.listProjects();
  const project = projects.find((p) => p.name === params.name);
  if (!project) error(404, "Project not found");

  // Then fetch all tab data in parallel
  const [entries, shareLinks, activity] = await Promise.all([
    api.listEntries(params.name),
    api.listShareLinks(project.id).catch(() => []),
    api.getActivity(project.id, 50, 0).catch(() => []),
  ]);

  return { project, projects, entries, shareLinks, activity };
};
