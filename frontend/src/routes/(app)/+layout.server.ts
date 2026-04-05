import { createApi } from "$lib/server/api";
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/login?redirect=${encodeURIComponent(url.pathname)}`);
  }

  const api = createApi(locals.token);
  const projects = await api.listProjects().catch(() => []);

  return { user: locals.user, projects };
};
