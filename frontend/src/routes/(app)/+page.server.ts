import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();

  if (projects.length > 0) {
    redirect(303, `/projects/${encodeURIComponent(projects[0].name)}`);
  }

  // Auto-create a default project for the user
  await api.createProject("My Workspace");
  redirect(303, `/projects/${encodeURIComponent("My Workspace")}`);
};
