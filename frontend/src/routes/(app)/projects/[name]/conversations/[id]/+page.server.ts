import { ApiError, createApi } from "$lib/server/api";
import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const api = createApi(locals.token);

  try {
    const data = await api.getConversation(params.id);
    return {
      conversation: data.conversation,
      messages: data.messages,
      context: data.context,
      media: data.media,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      error(404, "Conversation not found");
    }
    if (err instanceof ApiError) {
      error(err.status, err.message);
    }
    error(500, `Failed to load conversation: ${err instanceof Error ? err.message : String(err)}`);
  }
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
    // Stay on the page — the load function will re-fetch
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
