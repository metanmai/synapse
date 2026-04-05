import { createApi } from "$lib/server/api";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  return { conversationId: params.id };
};

export const actions: Actions = {
  archive: async ({ params, locals }) => {
    const api = createApi(locals.token);
    try {
      await api.updateConversation(params.id, { status: "archived" });
    } catch (err) {
      return fail(400, {
        error: err instanceof Error ? err.message : "Failed to archive conversation",
      });
    }
  },

  restore: async ({ params, locals }) => {
    const api = createApi(locals.token);
    try {
      await api.updateConversation(params.id, { status: "active" });
    } catch (err) {
      return fail(400, {
        error: err instanceof Error ? err.message : "Failed to restore conversation",
      });
    }
  },

  delete: async ({ params, locals }) => {
    const api = createApi(locals.token);
    try {
      await api.updateConversation(params.id, { status: "deleted" });
    } catch (err) {
      return fail(400, {
        error: err instanceof Error ? err.message : "Failed to delete conversation",
      });
    }
    redirect(303, `/projects/${encodeURIComponent(params.name)}/conversations`);
  },

  export: async ({ params, locals, request }) => {
    const api = createApi(locals.token);
    const formData = await request.formData();
    const format = (formData.get("format") as string) || "raw";

    try {
      const result = await api.exportConversation(params.id, format);
      return { exportData: JSON.stringify(result, null, 2), exportFormat: format };
    } catch (err) {
      return fail(400, {
        error: err instanceof Error ? err.message : "Failed to export conversation",
      });
    }
  },
};
