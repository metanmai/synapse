import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();

  if (projects.length > 0) {
    const first = projects[0];
    const slug = first.role === "owner" ? first.name : `${first.owner_email}~${first.name}`;
    redirect(303, `/projects/${encodeURIComponent(slug)}`);
  }

  // Auto-create a default project for the user
  await api.createProject("My Workspace");
  redirect(303, `/projects/${encodeURIComponent("My Workspace")}`);
};
