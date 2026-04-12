import { createApi } from "$lib/server/api";
import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
  depends("app:project");
  const api = createApi(locals.token);
  const projects = await api.listProjects();
  const decodedName = decodeURIComponent(params.name);
  let project = projects.find((p) => p.name === decodedName);
  if (!project && decodedName.includes("~")) {
    const [ownerEmail, name] = decodedName.split("~");
    project = projects.find((p) => p.name === name && p.owner_email === ownerEmail);
  }
  if (!project) error(404, "Project not found");
  return { project };
};
