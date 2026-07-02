import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const billing = await api.getBillingStatus().catch(() => ({
    tier: "free" as const,
    subscription: null,
  }));

  if (billing.tier === "free") {
    return { conversations: [], total: 0, tier: "free" as const };
  }

  const { conversations, total } = await api
    .listConversations(project.id)
    .catch(() => ({ conversations: [], total: 0 }));

  return { conversations, total, tier: "plus" as const };
};
