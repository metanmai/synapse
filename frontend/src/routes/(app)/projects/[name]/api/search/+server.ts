import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createApi } from "$lib/server/api";

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const query = url.searchParams.get("q");
  if (!query) error(400, "q is required");

  const api = createApi(locals.token);
  const results = await api.searchEntries(params.name, query);
  return json(results);
};
