import { createApi } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ parent, locals, url }) => {
  const { project } = await parent();
  const api = createApi(locals.token);

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const statusFilter = url.searchParams.get("status") || "all";
  const offset = (page - 1) * PAGE_SIZE;

  const statusParam = statusFilter !== "all" ? statusFilter : undefined;

  const { conversations, total } = await api
    .listConversations(project.id, statusParam, PAGE_SIZE, offset)
    .catch(() => ({ conversations: [], total: 0 }));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return {
    conversations,
    total,
    page,
    totalPages,
    statusFilter,
  };
};
