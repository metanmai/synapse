import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createApi } from "$lib/server/api";

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const path = url.searchParams.get("path");
  if (!path) error(400, "path is required");

  const api = createApi(locals.token);
  try {
    const entry = await api.getEntry(params.name, path);
    return json(entry);
  } catch {
    error(404, "Entry not found");
  }
};
