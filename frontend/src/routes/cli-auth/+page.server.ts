import { API_URL } from "$env/static/private";
import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const port = url.searchParams.get("port");

  if (!challenge || !state || !port) {
    return { error: "This page should be opened from the Synapse CLI.", challenge: null, state: null, port: null };
  }

  // If user is already authenticated, create CLI session and redirect to localhost
  if (locals.user && locals.token) {
    const res = await fetch(`${API_URL}/auth/cli-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ code_challenge: challenge }),
    });

    if (res.ok) {
      const data = (await res.json()) as { code: string };
      redirect(
        303,
        `http://localhost:${port}/callback?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(state)}`,
      );
    }

    return { error: "Failed to create CLI session. Please try again.", challenge, state, port };
  }

  // Not authenticated — render login form
  return { challenge, state, port, error: null };
};

function cliParams(url: URL): URLSearchParams {
  const params = new URLSearchParams();
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const port = url.searchParams.get("port");
  if (challenge) params.set("challenge", challenge);
  if (state) params.set("state", state);
  if (port) params.set("port", port);
  return params;
}

export const actions: Actions = {
  login: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        return fail(400, {
          error: "Incorrect email or password. If you signed up with Google or GitHub, try that method instead.",
          email,
        });
      }
      return fail(400, { error: error.message, email });
    }

    // Redirect back to this page — load function will handle CLI session creation
    redirect(303, `/cli-auth?${cliParams(url)}`);
  },

  magicLink: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const params = cliParams(url);
    const cliRedirect = `/cli-auth?${params}`;

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(cliRedirect)}`,
      },
    });

    if (error) return fail(400, { error: error.message, email });
    return { magicLinkSent: true, email };
  },

  oauth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";
    const params = cliParams(url);
    const cliRedirect = `/cli-auth?${params}`;

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(cliRedirect)}`,
      },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },

  signup: async ({ request, cookies }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase(cookies);

    // Check for existing user
    const { data: existingUsers } = await supabase.from("users").select("id").eq("email", email).limit(1);
    if (existingUsers && existingUsers.length > 0) {
      return fail(400, {
        error: "An account with this email already exists. Try signing in instead.",
        email,
      });
    }

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return fail(400, { error: error.message, email });

    return { signupSuccess: true, email };
  },
};
