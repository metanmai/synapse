import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription } from "../types";
import { singleOrNull } from "../query-helpers";

export async function getActiveSubscription(
  db: SupabaseClient,
  userId: string
): Promise<Subscription | null> {
  // Matches active or past_due (past_due retains Pro access per spec)
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as Subscription | null;
}

export async function getSubscriptionByUserId(
  db: SupabaseClient,
  userId: string
): Promise<Subscription | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as Subscription | null;
}

export async function getSubscriptionByProviderId(
  db: SupabaseClient,
  providerSubscriptionId: string
): Promise<Subscription | null> {
  return singleOrNull<Subscription>(
    await db
      .from("subscriptions")
      .select("*")
      .eq("provider_subscription_id", providerSubscriptionId)
      .single()
  );
}

export async function upsertSubscription(
  db: SupabaseClient,
  params: {
    user_id: string;
    provider?: string;
    provider_subscription_id: string;
    provider_customer_id?: string | null;
    status: Subscription["status"];
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  }
): Promise<Subscription> {
  const { data, error } = await db
    .from("subscriptions")
    .upsert(
      {
        user_id: params.user_id,
        provider: params.provider ?? "creem",
        provider_subscription_id: params.provider_subscription_id,
        provider_customer_id: params.provider_customer_id ?? null,
        status: params.status,
        current_period_end: params.current_period_end ?? null,
        cancel_at_period_end: params.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_subscription_id" }
    )
    .select()
    .single();

  if (error) throw error;
  return data as Subscription;
}
