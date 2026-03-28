import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "$env/static/private";
import type { Cookies } from "@sveltejs/kit";

const COOKIE_NAME = "synapse_session";

interface SessionData {
  access_token: string;
  refresh_token: string;
}

export function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
    },
  });
}

export function setSessionCookie(cookies: Cookies, session: SessionData) {
  cookies.set(COOKIE_NAME, JSON.stringify(session), {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export function getSessionCookie(cookies: Cookies): SessionData | null {
  const raw = cookies.get(COOKIE_NAME);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSessionCookie(cookies: Cookies) {
  cookies.delete(COOKIE_NAME, { path: "/" });
}
