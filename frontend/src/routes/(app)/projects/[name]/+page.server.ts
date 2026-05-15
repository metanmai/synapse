import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const [insightsResult, conversationsResult, billing] = await Promise.all([
    api.listInsights(project.id, undefined, 8, 0).catch(() => ({ insights: [], total: 0 })),
    api.listConversations(project.id, "active", 5, 0).catch(() => ({ conversations: [], total: 0 })),
    api.getBillingStatus().catch(() => ({ tier: "free" as const, subscription: null })),
  ]);

  let projectContext: { summary: string | null } = { summary: null };
  if (billing.tier === "plus") {
    projectContext = await api.getProjectContext(project.id).catch(() => ({ summary: null }));
  }

  return {
    insights: insightsResult.insights,
    insightTotal: insightsResult.total,
    conversations: conversationsResult.conversations,
    conversationTotal: conversationsResult.total,
    tier: billing.tier,
    projectContext,
  };
};
