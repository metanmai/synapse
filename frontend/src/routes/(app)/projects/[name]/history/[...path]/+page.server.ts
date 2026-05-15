import { createApi } from "$lib/server/api";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  const api = createApi(locals.token);
  const [history, entry] = await Promise.all([
    api.getEntryHistory(params.name, params.path),
    api.getEntry(params.name, params.path).catch(() => null),
  ]);
  return { history, entryPath: params.path, currentContent: entry?.content ?? "" };
};

export const actions: Actions = {
  restore: async ({ request, params, locals }) => {
    const data = await request.formData();
    const historyId = data.get("historyId") as string;

    const api = createApi(locals.token);
    try {
      await api.restoreEntry(params.name, params.path, historyId);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to restore" });
    }

    return { restored: true };
  },
};
