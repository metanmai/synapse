import { SUPABASE_ANON_KEY, SUPABASE_URL } from "$env/static/private";
import { createServerClient } from "@supabase/ssr";
import type { Cookies } from "@sveltejs/kit";

export function getSupabase(cookies: Cookies) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
