import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url }) => {
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  return { page };
};
