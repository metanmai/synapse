import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/dashboard");
};

export const actions: Actions = {
  signup: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    // Check if email already exists in our users table
    const supabase = getSupabase(cookies);
    const { data: existingUsers } = await supabase.from("users").select("id").eq("email", email).limit(1);

    if (existingUsers && existingUsers.length > 0) {
      return fail(400, {
        error:
          'An account with this email already exists. Try logging in instead, or use "Forgot password" to reset your password.',
        email,
      });
    }

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
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
