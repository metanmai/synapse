import { getSupabase } from "$lib/server/auth";
import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ cookies }) => {
    const supabase = getSupabase(cookies);
    await supabase.auth.signOut();
    redirect(303, "/login");
  },
};
