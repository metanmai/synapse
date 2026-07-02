import { ApiError, createApi } from "$lib/server/api";
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
      // Phase 03-02: surface the structured cap error with actionable text.
      // Backend returns 402 PROJECT_QUOTA_EXCEEDED when the user is at the
      // 50-project cap; show a clear "delete one to add more" message
      // instead of the generic stringified API path.
      if (err instanceof ApiError && err.code === "PROJECT_QUOTA_EXCEEDED") {
        return {
          error: "You have 50 of 50 projects. Delete an existing project to add this one.",
          code: "PROJECT_QUOTA_EXCEEDED",
        };
      }
      return { error: err instanceof Error ? err.message : "Failed to create project" };
    }
  },
};
