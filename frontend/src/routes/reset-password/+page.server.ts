import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  // Must be authenticated (the callback exchanges the recovery code for a session)
  if (!locals.user) redirect(303, "/login");
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const password = data.get("password") as string;
    const confirm = data.get("confirm") as string;

    if (!password) return fail(400, { error: "Password is required" });
    if (password.length < 8) return fail(400, { error: "Password must be at least 8 characters" });
    if (password !== confirm) return fail(400, { error: "Passwords do not match" });

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) return fail(400, { error: error.message });

    redirect(303, "/dashboard?password_reset=success");
  },
};
