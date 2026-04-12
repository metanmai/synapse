import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) {
    redirect(303, `/login?redirect=/share/${params.token}`);
  }
  return { token: params.token };
};

export const actions: Actions = {
  join: async ({ params, locals }) => {
    const api = createApi(locals.token);
    try {
      const result = await api.joinShareLink(params.token);
      return { success: true, role: result.role };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to join" });
    }
  },
};
