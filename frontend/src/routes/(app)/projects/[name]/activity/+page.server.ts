import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ parent, url, locals }) => {
  const { project } = await parent();
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = 50;
  const offset = (page - 1) * limit;

  const api = createApi(locals.token);
  const activity = await api.getActivity(project.id, limit, offset);

  return { activity, page };
};
