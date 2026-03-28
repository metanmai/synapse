import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { clearSessionCookie, getSupabase } from "$lib/server/auth";

export const actions: Actions = {
  default: async ({ cookies }) => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    clearSessionCookie(cookies);
    redirect(303, "/login");
  },
};
