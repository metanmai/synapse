import { createApi } from "$lib/server/api";
import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const billing = await api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null }));
  return { tier: billing.tier };
};

export const actions: Actions = {
  addMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = (data.get("email") as string)?.trim();
    const role = data.get("role") as string;

    if (!email) return fail(400, { inviteError: "Email is required" });

    const api = createApi(locals.token);
    try {
      await api.addMember(projectId, email, role);
    } catch (err) {
      return fail(400, { inviteError: err instanceof Error ? err.message : "Failed to invite" });
    }
    return { invited: true };
  },

  updateRole: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = data.get("email") as string;
    const role = data.get("role") as string;

    const api = createApi(locals.token);
    await api.updateMemberRole(projectId, email, role);
  },

  removeMember: async ({ request, locals }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const email = data.get("email") as string;

    const api = createApi(locals.token);
    await api.removeMember(projectId, email);
  },
};
