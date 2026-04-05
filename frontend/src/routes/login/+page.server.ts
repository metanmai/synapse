import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/dashboard");
};

export const actions: Actions = {
  login: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        return fail(400, {
          error: "Incorrect email or password. If you signed up with Google or GitHub, try that method instead.",
          email,
        });
      }
      return fail(400, { error: error.message, email });
    }

    const redirectTo = url.searchParams.get("redirect") || "/dashboard";
    redirect(303, redirectTo);
  },

  magicLink: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const redirectTo = url.searchParams.get("redirect") || "/dashboard";

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) return fail(400, { error: error.message, email });

    return { magicLinkSent: true, email };
  },

  oauth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";
    const redirectTo = url.searchParams.get("redirect") || "/dashboard";

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },
};
