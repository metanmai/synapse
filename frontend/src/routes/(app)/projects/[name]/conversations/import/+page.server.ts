import { createApi } from "$lib/server/api";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent }) => {
  const { project } = await parent();
  return { project };
};

export const actions: Actions = {
  import: async ({ request, locals, params }) => {
    const data = await request.formData();
    const projectId = data.get("projectId") as string;
    const messagesJson = (data.get("messages") as string)?.trim();
    const format = (data.get("format") as string) || "auto";
    const title = (data.get("title") as string)?.trim() || undefined;

    if (!projectId) return fail(400, { error: "Project ID is required" });
    if (!messagesJson) return fail(400, { error: "Messages JSON is required" });

    let messages: unknown;
    try {
      messages = JSON.parse(messagesJson);
    } catch {
      return fail(400, { error: "Invalid JSON in messages field" });
    }

    const api = createApi(locals.token);
    let result: Awaited<ReturnType<typeof api.importConversation>>;
    try {
      result = await api.importConversation(projectId, format, messages, title);
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to import conversation" });
    }

    redirect(303, `/projects/${encodeURIComponent(params.name)}/conversations/${result.conversation.id}`);
  },
};
