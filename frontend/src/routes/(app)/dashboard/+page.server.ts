import { redirect, error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

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
    // Re-throw SvelteKit redirects
    if (err?.status === 303 || err?.location) throw err;
    // Show full error detail in dev
    error(500, {
      message: `Dashboard load failed: ${err?.message || String(err)}`,
      detail: JSON.stringify({ status: err?.status, body: err?.body, stack: err?.stack }, null, 2),
    } as any);
  }
};
