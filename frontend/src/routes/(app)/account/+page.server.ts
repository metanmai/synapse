import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { createApi } from "$lib/server/api";
import { getSupabase } from "$lib/server/auth";

export const actions: Actions = {
  regenerateKey: async ({ locals }) => {
    const api = createApi(locals.token);
    try {
      const result = await api.regenerateApiKey();
      return { apiKey: result.api_key };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to generate key" });
    }
  },

  connectOAuth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${url.origin}/auth/callback?redirect=/account` },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },
};
