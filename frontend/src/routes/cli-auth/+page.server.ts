import { env } from "$env/dynamic/private";
import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { buildCallbackUrl, buildRedirect, getCliParams } from "./cli-params";

export const load: PageServerLoad = async ({ locals, url }) => {
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const port = url.searchParams.get("port");
  const device = url.searchParams.get("device");
  // Phase 03-05: per-machine UUID from the CLI's ~/.synapse/device.json.
  // Forwarded to /auth/cli-session so the backend can return an existing
  // rotated key on same-machine re-init instead of burning a device-cap slot.
  const machineId = url.searchParams.get("machine_id");
  // Slice B: the browser extension signs in via chrome.identity.launchWebAuthFlow,
  // which supplies a chromiumapp.org redirect_uri (no loopback port) and requests a
  // capture-scoped key. EITHER a port (CLI) or a redirect_uri (extension) makes this
  // a completable CLI-style handshake.
  const redirectUri = url.searchParams.get("redirect_uri");
  const scope = url.searchParams.get("scope");
  const hasCli = Boolean(challenge && state && (port || redirectUri));

  return {
    challenge,
    state,
    port,
    device,
    machine_id: machineId,
    redirect_uri: redirectUri,
    scope,
    hasCli,
    authenticated: Boolean(locals.user),
    email: locals.user?.email ?? null,
    error: null,
  };
};

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

    if (!locals.user || !locals.token || !cli.challenge || !cli.state || !(cli.port || cli.redirect_uri)) {
      return fail(400, { error: "Missing session or CLI parameters." });
    }

    const apiUrl = env.API_URL;
    if (!apiUrl) {
      return fail(500, { error: "API_URL is not configured." });
    }

    const res = await fetch(`${apiUrl}/auth/cli-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({
        code_challenge: cli.challenge,
        ...(cli.device ? { device_name: cli.device } : {}),
        // Phase 03-05: machine_id from the CLI's URL param, hidden form
        // field, restored across the magic-link/OAuth round-trip via
        // buildRedirect(). When set + already registered for the user,
        // the backend rotates the existing api_keys row's hash instead
        // of creating a duplicate row that burns a device-cap slot.
        ...(cli.machine_id ? { machine_id: cli.machine_id } : {}),
        // Slice B: 'capture' requests a browser-extension capture-scoped key.
        ...(cli.scope ? { scope: cli.scope } : {}),
      }),
    });

    // BUG #5: device-limit picker. 409 means the user hit the 3-device
    // Free-tier cap; backend includes the device list so the page can
    // render a picker. We surface that list through `fail` so the
    // template can branch on `form?.devices` and show the picker.
    if (res.status === 409) {
      const body = (await res.json()) as {
        code?: string;
        tier?: "free" | "plus";
        limit?: number;
        devices?: Array<{
          id: string;
          name: string;
          last_used_at: string | null;
          created_at: string;
        }>;
      };
      return fail(409, {
        deviceLimit: true,
        devices: body.devices ?? [],
        tier: body.tier ?? "free",
        limit: body.limit ?? 3,
      });
    }

    if (!res.ok) {
      return fail(500, { error: "Failed to create CLI session. Please try again." });
    }

    const data = (await res.json()) as { code: string };
    const callbackUrl = buildCallbackUrl(cli, data.code);
    if (!callbackUrl) {
      return fail(400, { error: "Invalid CLI callback target." });
    }

    // Return URL instead of redirect — cross-origin redirect to localhost doesn't work with use:enhance
    return { redirectTo: callbackUrl };
  },

  // BUG #5: companion action to the picker UI. User selected a device
  // to revoke + clicked "Revoke & continue" — POST the choice to the
  // backend's /cli-revoke-and-session which revokes the chosen key and
  // mints a fresh session in one round trip.
  revokeAndContinue: async ({ request, locals }) => {
    const formData = await request.formData();
    const cli = getCliParams(formData);
    const revokeKeyId = (formData.get("revoke_key_id") ?? "").toString();

    if (!locals.user || !locals.token || !cli.challenge || !cli.state || !(cli.port || cli.redirect_uri)) {
      return fail(400, { error: "Missing session or CLI parameters." });
    }
    if (!revokeKeyId) {
      return fail(400, { error: "Select a device to revoke before continuing." });
    }

    const apiUrl = env.API_URL;
    if (!apiUrl) {
      return fail(500, { error: "API_URL is not configured." });
    }

    const res = await fetch(`${apiUrl}/auth/cli-revoke-and-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({
        revoke_key_id: revokeKeyId,
        code_challenge: cli.challenge,
        ...(cli.device ? { device_name: cli.device } : {}),
        ...(cli.machine_id ? { machine_id: cli.machine_id } : {}),
      }),
    });

    if (!res.ok) {
      return fail(res.status === 404 ? 404 : 500, {
        error: "Could not revoke the selected device. It may already have been removed — refresh and try again.",
      });
    }

    const data = (await res.json()) as { code: string };
    const callbackUrl = buildCallbackUrl(cli, data.code);
    if (!callbackUrl) {
      return fail(400, { error: "Invalid CLI callback target." });
    }
    return { redirectTo: callbackUrl };
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
