import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
  const { project } = await parent();
  const api = createApi(locals.token);
  const [insightsResult, conversationsResult] = await Promise.all([
    api.listInsights(project.id, undefined, 8, 0).catch(() => ({ insights: [], total: 0 })),
    api.listConversations(project.id, "active", 5, 0).catch(() => ({ conversations: [], total: 0 })),
  ]);
  return {
    insights: insightsResult.insights,
    insightTotal: insightsResult.total,
    conversations: conversationsResult.conversations,
    conversationTotal: conversationsResult.total,
  };
};
