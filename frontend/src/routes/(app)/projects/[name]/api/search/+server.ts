import { createApi } from "$lib/server/api";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const query = url.searchParams.get("q");
  if (!query) error(400, "q is required");

  const api = createApi(locals.token);
  const results = await api.searchEntries(params.name, query);
  return json(results);
};
