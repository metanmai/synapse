import { createApi } from "$lib/server/api";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const { insights, total } = await api
    .listInsights(project.id)
    .catch(() => ({ insights: [], total: 0 }));

  return { insights, total };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const type = (data.get("type") as string)?.trim();
    const summary = (data.get("summary") as string)?.trim();
    const detail = (data.get("detail") as string)?.trim() || undefined;

    if (!projectId) return fail(400, { error: "Project ID is required" });
    if (!type) return fail(400, { error: "Type is required" });
    if (!summary) return fail(400, { error: "Summary is required" });

    const api = createApi(locals.token);
    try {
      await api.createInsight(projectId, type, summary, detail);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to create insight" });
    }

    return { created: true };
  },

  delete: async ({ request, locals }) => {
    const data = await request.formData();
    const insightId = data.get("insightId") as string;

    if (!insightId) return fail(400, { error: "Insight ID is required" });

    const api = createApi(locals.token);
    try {
      await api.deleteInsight(insightId);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to delete insight" });
    }

    return { deleted: true };
  },
};
