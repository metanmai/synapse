import { env } from "$env/dynamic/private";
import { createServerClient } from "@supabase/ssr";
import type { Cookies } from "@sveltejs/kit";

export function getSupabase(cookies: Cookies) {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set in the environment.");
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, { ...options, path: options?.path ?? "/" });
        }
      },
    },
  });
}
