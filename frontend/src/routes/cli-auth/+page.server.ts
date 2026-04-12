import { API_URL } from "$env/static/private";
import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const port = url.searchParams.get("port");
  const hasCli = Boolean(challenge && state && port);

  return {
    challenge,
    state,
    port,
    hasCli,
    authenticated: Boolean(locals.user),
    email: locals.user?.email ?? null,
    error: null,
  };
};

function getCliParams(formData: FormData): { challenge: string | null; state: string | null; port: string | null } {
  return {
    challenge: (formData.get("cli_challenge") as string) || null,
    state: (formData.get("cli_state") as string) || null,
    port: (formData.get("cli_port") as string) || null,
  };
}

function buildRedirect(cli: { challenge: string | null; state: string | null; port: string | null }): string {
  const params = new URLSearchParams();
  if (cli.challenge) params.set("challenge", cli.challenge);
  if (cli.state) params.set("state", cli.state);
  if (cli.port) params.set("port", cli.port);
  const qs = params.toString();
  return qs ? `/cli-auth?${qs}` : "/cli-auth";
}

export const actions: Actions = {
  login: async ({ request, cookies }) => {
    const formData = await request.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const cli = getCliParams(formData);

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

    redirect(303, buildRedirect(cli));
  },

  magicLink: async ({ request, cookies, url }) => {
    const formData = await request.formData();
    const email = formData.get("email") as string;
    const cli = getCliParams(formData);
    const cliRedirect = buildRedirect(cli);

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
    const formData = await request.formData();
    const provider = formData.get("provider") as "google" | "github";
    const cli = getCliParams(formData);
    const cliRedirect = buildRedirect(cli);

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
    const formData = await request.formData();
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const supabase = getSupabase(cookies);

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

  continueAs: async ({ request, locals }) => {
    const formData = await request.formData();
    const cli = getCliParams(formData);

    if (!locals.user || !locals.token || !cli.challenge || !cli.state || !cli.port) {
      return fail(400, { error: "Missing session or CLI parameters." });
    }

    const res = await fetch(`${API_URL}/auth/cli-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ code_challenge: cli.challenge }),
    });

    if (!res.ok) {
      return fail(500, { error: "Failed to create CLI session. Please try again." });
    }

    const data = (await res.json()) as { code: string };
    redirect(
      303,
      `http://localhost:${cli.port}/callback?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(cli.state)}`,
    );
  },

  switchAccount: async ({ request, cookies }) => {
    const formData = await request.formData();
    const cli = getCliParams(formData);

    const supabase = getSupabase(cookies);
    await supabase.auth.signOut();

    // Redirect back with switch=1 stripped (user is now logged out, page will show login form)
    redirect(303, buildRedirect(cli));
  },
};
