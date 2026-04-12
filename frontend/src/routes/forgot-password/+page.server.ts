import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(303, "/dashboard");
};

export const actions: Actions = {
  reset: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;

    if (!email) return fail(400, { error: "Email is required" });

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${url.origin}/auth/callback?redirect=/account`,
    });

    if (error) return fail(400, { error: error.message, email });

    return { success: true, email };
  },
};
