import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import { getActiveSubscription } from "../db/queries/subscriptions";
import { getTierLimitsFromEnv } from "../db/types";
import {
  AUTO_SYNC_TIERS,
  DEFAULT_APP_URL,
  DEFAULT_TIER_PLUS_PRICE,
  DEVICE_LIMIT_FREE,
  DEVICE_LIMIT_PLUS,
  FREE_CONVERSATIONS_PER_PROJECT,
  FREE_INSIGHTS_PER_PROJECT,
  FREE_MAX_PROJECTS,
  PLUS_CONVERSATIONS_PER_PROJECT,
  PLUS_INSIGHTS_PER_PROJECT,
  PLUS_MAX_PROJECTS,
} from "./constants";
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
    // Phase 03-02: structured 402 PROJECT_QUOTA_EXCEEDED. Both tiers cap at 50
    // post-redesign; the upgrade pitch is gone — message is the same regardless
    // of tier. CLI surface (handoff-sync.ts) and frontend match on the code.
    throw new AppError(
      `Project limit reached (${max}). Delete an existing project to add this one.`,
      402,
      "PROJECT_QUOTA_EXCEEDED",
    );
  }
}

export function enforceProjectQuota(currentCount: number, c: Context<{ Bindings: Env }>) {
  const tier = (c.get("tier") ?? "free") as Tier;
  enforceProjectQuotaForTier(currentCount, tier);
}

// --- Per-project insight cap (Phase 03-01) ---
// Free: 10 stored, Plus: 50 stored. Brief truncation MAX_INSIGHTS=10 is
// independent of these (both tiers see top-10 in brief; difference is in
// stored / list_insights count).

export function getInsightCapForTier(tier: Tier): number {
  return tier === "plus" ? PLUS_INSIGHTS_PER_PROJECT : FREE_INSIGHTS_PER_PROJECT;
}

export function getInsightCap(c: Context<{ Bindings: Env }>): number {
  const tier = (c.get("tier") ?? "free") as Tier;
  return getInsightCapForTier(tier);
}

// --- Per-project conversation cap (Phase 03-01) ---

export function getConversationCapForTier(tier: Tier): number {
  return tier === "plus" ? PLUS_CONVERSATIONS_PER_PROJECT : FREE_CONVERSATIONS_PER_PROJECT;
}

export function getConversationCap(c: Context<{ Bindings: Env }>): number {
  const tier = (c.get("tier") ?? "free") as Tier;
  return getConversationCapForTier(tier);
}

// --- Per-user device cap (Phase 03-01) ---

export function getDeviceCapForTier(tier: Tier): number {
  return tier === "plus" ? DEVICE_LIMIT_PLUS : DEVICE_LIMIT_FREE;
}

export function getDeviceCap(c: Context<{ Bindings: Env }>): number {
  const tier = (c.get("tier") ?? "free") as Tier;
  return getDeviceCapForTier(tier);
}

// --- Auto-sync gate (Phase 03-01) ---
// Used by the daemon's cycle() to decide whether to run the periodic
// flush+pull+prewarm loop. Free returns false → daemon stays idle
// between hook-driven syncs; Plus returns true → full auto-sync.

export function isAutoSyncEnabledForTier(tier: Tier): boolean {
  return (AUTO_SYNC_TIERS as readonly string[]).includes(tier);
}

export function isAutoSyncEnabled(c: Context<{ Bindings: Env }>): boolean {
  const tier = (c.get("tier") ?? "free") as Tier;
  return isAutoSyncEnabledForTier(tier);
}
