import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const billing = await api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null }));
  const { total } = await api
    .listConversations(project.id, undefined, 1, 0)
    .catch(() => ({ conversations: [], total: 0 }));
  return { tier: billing.tier, conversationCount: total };
};
