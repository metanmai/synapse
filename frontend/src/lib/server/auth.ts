import { createServerClient } from "@supabase/ssr";
import { env } from "$env/dynamic/private";
import type { Cookies } from "@sveltejs/kit";

const COOKIE_NAME = "synapse_session";

interface SessionData {
  access_token: string;
  refresh_token: string;
}

export function getSupabase(cookies: Cookies) {
  return createServerClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, { ...options, path: options?.path ?? "/" });
        });
      },
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
