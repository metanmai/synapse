import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";
import { getSupabase } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  let billing: { tier: "free" | "pro"; subscription: { status: string; current_period_end: string | null; cancel_at_period_end: boolean } | null } = { tier: "free", subscription: null };
  let keys: { id: string; label: string; expires_at: string | null; last_used_at: string | null; created_at: string }[] = [];

  try {
    billing = await api.getBillingStatus();
  } catch {}

  try {
    keys = await api.listApiKeys();
  } catch {}

  return { billing, keys };
};

export const actions: Actions = {
  createKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const formData = await request.formData();
    const label = formData.get("label") as string;
    const expiresAt = formData.get("expires_at") as string | null;

    if (!label?.trim()) {
      return fail(400, { keyError: "Label is required" });
    }

    // Convert datetime-local value to ISO 8601 with timezone
    const expiresAtIso = expiresAt ? new Date(expiresAt).toISOString() : null;

    try {
      const result = await api.createApiKey(label.trim(), expiresAtIso);
      return { newKey: result };
    } catch (err) {
      return fail(400, { keyError: err instanceof Error ? err.message : "Failed to create key" });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const formData = await request.formData();
    const keyId = formData.get("keyId") as string;

    try {
      await api.revokeApiKey(keyId);
    } catch (err) {
      return fail(400, { keyError: err instanceof Error ? err.message : "Failed to revoke key" });
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

  checkout: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createCheckout();
    redirect(303, url);
  },

  portal: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createPortalSession();
    redirect(303, url);
  },
};
