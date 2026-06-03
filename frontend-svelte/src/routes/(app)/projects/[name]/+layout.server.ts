import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: LayoutServerLoad = async ({ params, locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();
  const project = projects.find((p) => p.name === params.name);

  if (!project) error(404, "Project not found");

  return { project };
};
