import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

// No load function — entries come from parent layout, entry selection is client-side

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
