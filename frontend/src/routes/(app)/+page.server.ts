import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  try {
    const projects = await api.listProjects();
    if (projects.length > 0) {
      redirect(303, `/projects/${encodeURIComponent(projects[0].name)}`);
    }
    return { projects, error: null };
  } catch (err) {
    console.error("[dashboard] API error:", err);
    return { projects: [], error: `API error: ${err instanceof Error ? err.message : String(err)}` };
  }
};

export const actions: Actions = {
  createProject: async ({ request, locals }) => {
    const data = await request.formData();
    const name = (data.get("name") as string)?.trim();

    if (!name) return fail(400, { error: "Project name is required" });

    const api = createApi(locals.token);
    try {
      await api.createProject(name);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to create project" });
    }

    redirect(303, `/projects/${encodeURIComponent(name)}`);
  },
};
