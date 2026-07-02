import { createApi } from "$lib/server/api";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const [projects, billing] = await Promise.all([
    api.listProjects().catch(() => []),
    api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null })),
  ]);
  return { projects, tier: billing.tier };
};

export const actions: Actions = {
  createProject: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Project name is required" };
    try {
      await api.createProject(name);
      return { created: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to create project" };
    }
  },
};
