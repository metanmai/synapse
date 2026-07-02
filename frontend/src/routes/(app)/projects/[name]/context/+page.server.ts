import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const billing = await api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null }));
  const { total } = await api
    .listConversations(project.id, undefined, 1, 0)
    .catch(() => ({ conversations: [], total: 0 }));

  let contextData: {
    summary: string | null;
    conversation_count?: number;
    model?: string | null;
    updated_at?: string;
    source?: string;
  } = { summary: null };

  if (billing.tier === "plus") {
    contextData = await api.getProjectContext(project.id).catch(() => ({ summary: null }));
  }

  return { tier: billing.tier, conversationCount: total, context: contextData };
};
