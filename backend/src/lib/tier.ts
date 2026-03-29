import { Context, Next } from "hono";
import { TIER_LIMITS } from "../db/types";
import { AppError } from "./errors";
import type { Env } from "./env";

/**
 * Tier enforcement helpers. Call these in route handlers where limits apply.
 */

export function getTierLimits(c: Context<{ Bindings: Env }>) {
  const user = c.get("user");
  const tier = user.tier ?? "free";
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

export function requirePro(c: Context<{ Bindings: Env }>, feature: string) {
  const user = c.get("user");
  const tier = user.tier ?? "free";
  if (tier !== "pro") {
    throw new AppError(
      `${feature} requires a Pro subscription ($5.99/mo). Upgrade at https://app.synapse.dev/account`,
      403,
      "TIER_LIMIT"
    );
  }
}

export function enforceFileLimit(
  currentCount: number,
  c: Context<{ Bindings: Env }>
) {
  const limits = getTierLimits(c);
  if (currentCount >= limits.maxFiles) {
    throw new AppError(
      `File limit reached (${limits.maxFiles} files on ${c.get("user").tier ?? "free"} tier). Upgrade to Pro for ${TIER_LIMITS.pro.maxFiles} files.`,
      403,
      "TIER_LIMIT"
    );
  }
}

export function enforceConnectionLimit(
  currentConnections: number,
  source: string,
  c: Context<{ Bindings: Env }>
) {
  const limits = getTierLimits(c);
  // If this source is already counted, it's not a new connection
  // This check should happen before counting
  if (currentConnections >= limits.maxConnections) {
    throw new AppError(
      `Connection limit reached (${limits.maxConnections} sources on ${c.get("user").tier ?? "free"} tier). Upgrade to Pro for unlimited connections.`,
      403,
      "TIER_LIMIT"
    );
  }
}
