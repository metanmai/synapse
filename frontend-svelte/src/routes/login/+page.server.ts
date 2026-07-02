import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { getSupabase, setSessionCookie } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/");
};

export const actions: Actions = {
  login: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase();
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return fail(400, { error: error.message, email });
    if (!authData.session) return fail(400, { error: "No session returned", email });

    setSessionCookie(cookies, {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    });

    const redirectTo = url.searchParams.get("redirect") || "/";
    redirect(303, redirectTo);
  },

  magicLink: async ({ request }) => {
    const data = await request.formData();
    const email = data.get("email") as string;

    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOtp({ email });

    if (error) return fail(400, { error: error.message, email });

    return { magicLinkSent: true, email };
  },

  oauth: async ({ request, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";
    const redirectTo = url.searchParams.get("redirect") || "/";

    const supabase = getSupabase();
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
