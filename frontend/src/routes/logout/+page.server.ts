import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { getSupabase } from "$lib/server/auth";

export const actions: Actions = {
  default: async ({ cookies }) => {
    const supabase = getSupabase(cookies);
    await supabase.auth.signOut();
    redirect(303, "/login");
  },
};
