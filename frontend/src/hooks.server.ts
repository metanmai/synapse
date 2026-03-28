import { getSupabase } from "$lib/server/auth";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const supabase = getSupabase(event.cookies);

  // getUser() validates and may refresh the token — cookies get updated via setAll
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    event.locals.user = null;
    event.locals.token = null;
    return resolve(event, {
      filterSerializedResponseHeaders(name) {
        return name === "content-range" || name === "x-supabase-api-version";
      },
    });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  event.locals.user = { id: user.id, email: user.email ?? "" };
  event.locals.token = session?.access_token ?? null;

  return resolve(event, {
    filterSerializedResponseHeaders(name) {
      return name === "content-range" || name === "x-supabase-api-version";
    },
  });
};
