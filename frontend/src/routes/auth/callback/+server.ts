import { getSupabase } from "$lib/server/auth";
import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirect") || "/dashboard";

  if (!code) redirect(303, "/login?error=missing_code");

  const supabase = getSupabase(cookies);
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) redirect(303, "/login?error=auth_failed");

  redirect(303, redirectTo);
};
