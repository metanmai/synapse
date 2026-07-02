import { redirect, error, isRedirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi, ApiError } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.token) {
    redirect(303, "/login?redirect=/dashboard");
  }

  const api = createApi(locals.token);

  let projects;
  try {
    projects = await api.listProjects();
  } catch (err) {
    if (err instanceof ApiError) {
      error(err.status, err.message);
    }
    error(500, `Failed to load projects: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (projects.length > 0) {
    const first = projects[0];
    const slug = first.role === "owner" ? first.name : `${first.owner_email}~${first.name}`;
    redirect(303, `/projects/${encodeURIComponent(slug)}`);
  }

  try {
    await api.createProject("My Workspace");
  } catch (err) {
    if (err instanceof ApiError) {
      error(err.status, `Failed to create default project: ${err.message}`);
    }
    error(500, `Failed to create default project: ${err instanceof Error ? err.message : String(err)}`);
  }

  redirect(303, `/projects/${encodeURIComponent("My Workspace")}`);
};
