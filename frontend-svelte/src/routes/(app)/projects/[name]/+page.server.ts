import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const api = createApi(locals.token);
  const path = url.searchParams.get("path");
  const query = url.searchParams.get("q");
  const edit = url.searchParams.has("edit");
  const isNew = url.searchParams.has("new");

  const entries = await api.listEntries(params.name);

  let entry = null;
  if (path) {
    try {
      entry = await api.getEntry(params.name, path);
    } catch {
      // Entry not found — will show empty state
    }
  }

  let searchResults = null;
  if (query && query.length > 1) {
    searchResults = await api.searchEntries(params.name, query);
  }

  return { entries, entry, searchResults, selectedPath: path, query, edit, isNew };
};

export const actions: Actions = {
  saveEntry: async ({ request, params, locals }) => {
    const data = await request.formData();
    const path = (data.get("path") as string)?.trim();
    const content = data.get("content") as string;
    const tagsRaw = data.get("tags") as string;
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

    if (!path) return fail(400, { error: "Path is required" });

    const api = createApi(locals.token);
    try {
      await api.saveEntry(params.name, path, content, tags);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to save" });
    }

    return { saved: true, savedPath: path };
  },

  setPreference: async ({ request, params, locals }) => {
    const data = await request.formData();
    const key = data.get("key") as string;
    const value = data.get("value") as string;

    const api = createApi(locals.token);
    try {
      await api.setPreference(params.name, key, value);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to save preference" });
    }
    return { preferenceSet: true };
  },
};
