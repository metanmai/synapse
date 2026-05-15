import type { Handle } from "@sveltejs/kit";
import { getSupabase } from "$lib/server/auth";

export const handle: Handle = async ({ event, resolve }) => {
  const supabase = getSupabase(event.cookies);

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    event.locals.user = null;
    event.locals.token = null;
    return resolve(event);
  }

  const { data: { session } } = await supabase.auth.getSession();

  event.locals.user = { id: user.id, email: user.email! };
  event.locals.token = session?.access_token ?? null;

  return resolve(event);
};
