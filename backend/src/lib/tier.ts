import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { getActiveSubscription } from "../db/queries/subscriptions";
import { getTierLimitsFromEnv } from "../db/types";
import { DEFAULT_APP_URL, DEFAULT_TIER_PLUS_PRICE, FREE_MAX_PROJECTS, PLUS_MAX_PROJECTS } from "./constants";
import { envOr } from "./env";
import type { Env } from "./env";
import { AppError } from "./errors";

export type Tier = "free" | "plus";

/**
 * Resolve the tier for an arbitrary user_id. Used by enforcement paths that
 * don't have the tier on `c.get("tier")` because the relevant user isn't
 * the request author (e.g., invite mint/accept — the LIMIT applies to the
 * project OWNER's tier, but the caller may be a non-owner member). Falls
 * back to "free" when no active subscription exists.
 */
export async function getTierForUser(db: SupabaseClient, userId: string): Promise<Tier> {
  const sub = await getActiveSubscription(db, userId);
  return sub ? "plus" : "free";
}

export function getTierLimits(c: Context<{ Bindings: Env }>) {
  const tier = c.get("tier") ?? "free";
  const limits = getTierLimitsFromEnv(c.env as unknown as Record<string, string>);
  return limits[tier] ?? limits.free;
}

export function requirePlus(c: Context<{ Bindings: Env }>, feature: string) {
  const tier = c.get("tier") ?? "free";
  if (tier !== "plus") {
    const price = envOr(c.env, "TIER_PLUS_PRICE", DEFAULT_TIER_PLUS_PRICE);
    const appUrl = envOr(c.env, "APP_URL", DEFAULT_APP_URL);
    throw new AppError(
      `${feature} requires a Plus subscription ($${price}/mo). Upgrade at ${appUrl}/account`,
      403,
      "TIER_LIMIT",
    );
  }
}

/**
 * Returns the max number of history versions to show.
 * -1 = unlimited, 0 = none, positive = that many.
 */
export function getHistoryLimit(c: Context<{ Bindings: Env }>): number {
  const limits = getTierLimits(c);
  return limits.maxHistoryVersions;
}

/**
 * Tier-string variant of {@link enforceMemberLimit}. Callable from any code
 * path that has a resolved tier string but no Hono Context — primarily the
 * MCP tool handlers and the daemon-side flush path. The original Context-
 * flavored function delegates here so both code paths share one decision.
 *
 * `env` is needed for `getTierLimitsFromEnv` (the per-deploy override of
 * `TIER_FREE_MAX_MEMBERS` etc.); pass `undefined` for default limits.
 */
export function enforceMemberLimitForTier(
  currentMemberCount: number,
  tier: Tier,
  env?: Record<string, string>,
  plusPrice = DEFAULT_TIER_PLUS_PRICE,
) {
  const limits = getTierLimitsFromEnv(env);
  const max = limits[tier].maxMembers;
  if (max === 0) return; // 0 = unlimited
  if (currentMemberCount >= max) {
    throw new AppError(
      `Member limit reached (${max} members on ${tier} tier). Upgrade to Plus ($${plusPrice}/mo) for unlimited team members.`,
      403,
      "TIER_LIMIT",
    );
  }
}

export function enforceMemberLimit(currentMemberCount: number, c: Context<{ Bindings: Env }>) {
  const tier = (c.get("tier") ?? "free") as Tier;
  const plusPrice = envOr(c.env, "TIER_PLUS_PRICE", DEFAULT_TIER_PLUS_PRICE);
  enforceMemberLimitForTier(currentMemberCount, tier, c.env as unknown as Record<string, string>, plusPrice);
}

/**
 * Tier-string variant of {@link enforceProjectQuota}. Same role as
 * {@link enforceMemberLimitForTier} — usable from non-Context call sites
 * (MCP tools, capture daemon path). Pure: no env / DB dependency, since
 * the quotas are hardcoded constants.
 */
export function enforceProjectQuotaForTier(currentCount: number, tier: Tier) {
  const max = tier === "plus" ? PLUS_MAX_PROJECTS : FREE_MAX_PROJECTS;
  if (currentCount >= max) {
    throw new AppError(
      `Project limit reached (${max}). ${tier === "free" ? "Upgrade to Plus for up to 50 projects." : "Maximum 50 projects on Plus."}`,
      403,
      "TIER_LIMIT",
    );
  }
}

export function enforceProjectQuota(currentCount: number, c: Context<{ Bindings: Env }>) {
  const tier = (c.get("tier") ?? "free") as Tier;
  enforceProjectQuotaForTier(currentCount, tier);
}
