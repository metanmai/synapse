import type { Handle } from "@sveltejs/kit";
import { getSessionCookie, getSupabase, setSessionCookie } from "$lib/server/auth";

export const handle: Handle = async ({ event, resolve }) => {
  const sessionData = getSessionCookie(event.cookies);

  if (!sessionData) {
    event.locals.user = null;
    event.locals.token = null;
    return resolve(event);
  }

  // Verify the token by getting user from Supabase
  const supabase = getSupabase(event.cookies);
  const { data, error } = await supabase.auth.getUser(sessionData.access_token);

  if (error || !data.user) {
    // Try refreshing the token
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession({
        refresh_token: sessionData.refresh_token,
      });

    if (refreshError || !refreshData.session) {
      event.locals.user = null;
      event.locals.token = null;
      return resolve(event);
    }

    // Update cookie with new tokens
    setSessionCookie(event.cookies, {
      access_token: refreshData.session.access_token,
      refresh_token: refreshData.session.refresh_token,
    });

    event.locals.user = {
      id: refreshData.session.user.id,
      email: refreshData.session.user.email!,
    };
    event.locals.token = refreshData.session.access_token;
  } else {
    event.locals.user = { id: data.user.id, email: data.user.email! };
    event.locals.token = sessionData.access_token;
  }

  return resolve(event);
};
