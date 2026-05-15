import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSupabase, setSessionCookie } from "$lib/server/auth";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirect") || "/";

  if (!code) redirect(303, "/login?error=missing_code");

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) redirect(303, "/login?error=auth_failed");

  setSessionCookie(cookies, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  redirect(303, redirectTo);
};
