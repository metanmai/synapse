import { ApiError, createApi } from "$lib/server/api";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) => {
  const api = createApi(locals.token);
  try {
    const data = await api.getConversation(params.id);
    return json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      error(err.status, err.message);
    }
    error(500, "Failed to load conversation");
  }
};
