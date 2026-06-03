import { redirect, error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi, ApiError } from "$lib/server/api";
import { API_URL } from "$env/static/private";

export const load: PageServerLoad = async ({ locals }) => {
  try {
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
  } catch (err: any) {
    // Re-throw SvelteKit redirects and errors
    if (err?.status === 303 || err?.location) throw err;
    if (err?.status && err?.body) throw err; // SvelteKit error objects
    // Show full error detail — preserve original status code
    const status = err instanceof ApiError ? err.status : 500;
    error(status, {
      message: `Dashboard failed: ${err?.message || String(err)}`,
      detail: `API_URL: ${API_URL}\nStatus: ${err?.status}\nStack: ${err?.stack ?? "none"}`,
    } as any);
  }
};
