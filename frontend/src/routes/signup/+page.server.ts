import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getSupabase } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/dashboard");
};

export const actions: Actions = {
  signup: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("already exists")) {
        return fail(400, {
          error: "An account with this email already exists. Try logging in instead, or use \"Forgot password\" to reset your password.",
          email,
        });
      }
      return fail(400, { error: error.message, email });
    }

    return { success: true, email };
  },

  oauth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${url.origin}/auth/callback` },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },
};
