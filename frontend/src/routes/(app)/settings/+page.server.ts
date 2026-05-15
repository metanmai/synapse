import { createApi } from "$lib/server/api";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const api = createApi(locals.token);

  // If returning from Creem checkout, verify and activate the subscription directly
  const checkoutId = url.searchParams.get("checkout_id");
  if (checkoutId && url.searchParams.has("upgraded")) {
    try {
      await api.verifyCheckout(checkoutId);
    } catch {
      // Best-effort — webhook may still handle it
    }
  }

  const [billingResult, keysResult, projectsResult] = await Promise.allSettled([
    api.getBillingStatus(),
    api.listApiKeys(),
    api.listProjects(),
  ]);

  const billing =
    billingResult.status === "fulfilled" ? billingResult.value : { tier: "free" as const, subscription: null };
  const keys = keysResult.status === "fulfilled" ? keysResult.value : [];
  const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];

  return {
    tier: billing.tier,
    subscription: billing.subscription,
    apiKeys: keys,
    projectCount: projects.length,
  };
};

export const actions: Actions = {
  createKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const form = await request.formData();
    const label = String(form.get("label") || "").trim();
    if (!label) return fail(400, { error: "Label is required" });
    try {
      const result = await api.createApiKey(label);
      return { newKey: result.api_key, label: result.label };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to create key" });
    }
  },

  revokeKey: async ({ request, locals }) => {
    const api = createApi(locals.token);
    const form = await request.formData();
    const keyId = String(form.get("keyId"));
    try {
      await api.revokeApiKey(keyId);
      return { revoked: true };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to revoke key" });
    }
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
