import { Context, Next } from "hono";
import { getTierLimitsFromEnv } from "../db/types";
import { AppError } from "./errors";
import type { Env } from "./env";

export function getTierLimits(c: Context<{ Bindings: Env }>) {
  const user = c.get("user");
  const tier = user.tier ?? "free";
  const limits = getTierLimitsFromEnv(c.env as unknown as Record<string, string>);
  return limits[tier] ?? limits.free;
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
    const tier = c.get("user").tier ?? "free";
    throw new AppError(
      `File limit reached (${limits.maxFiles} files on ${tier} tier). Upgrade to Pro for more files.`,
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
  if (limits.maxConnections === 0) return; // 0 = unlimited
  if (currentConnections >= limits.maxConnections) {
    const tier = c.get("user").tier ?? "free";
    throw new AppError(
      `Connection limit reached (${limits.maxConnections} sources on ${tier} tier). Upgrade to Pro for unlimited connections.`,
      403,
      "TIER_LIMIT"
    );
  }
}
