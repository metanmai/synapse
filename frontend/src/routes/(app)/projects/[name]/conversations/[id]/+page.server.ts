import { ApiError, createApi } from "$lib/server/api";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

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
