import { Context } from "hono";
import { getTierLimitsFromEnv } from "../db/types";
import { AppError } from "./errors";
import { envOr } from "./env";
import type { Env } from "./env";

export function getTierLimits(c: Context<{ Bindings: Env }>) {
  const tier = c.get("tier") ?? "free";
  const limits = getTierLimitsFromEnv(c.env as unknown as Record<string, string>);
  return limits[tier] ?? limits.free;
}

export function requirePro(c: Context<{ Bindings: Env }>, feature: string) {
  const tier = c.get("tier") ?? "free";
  if (tier !== "pro") {
    const price = envOr(c.env, "TIER_PRO_PRICE", "5.99");
    const appUrl = envOr(c.env, "APP_URL", "https://synapsesync.app");
    throw new AppError(
      `${feature} requires a Pro subscription ($${price}/mo). Upgrade at ${appUrl}/account`,
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
    const tier = c.get("tier") ?? "free";
    const price = envOr(c.env, "TIER_PRO_PRICE", "5.99");
    throw new AppError(
      `File limit reached (${limits.maxFiles} files on ${tier} tier). Upgrade to Pro ($${price}/mo) for more files.`,
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
    const tier = c.get("tier") ?? "free";
    const price = envOr(c.env, "TIER_PRO_PRICE", "5.99");
    throw new AppError(
      `Connection limit reached (${limits.maxConnections} sources on ${tier} tier). Upgrade to Pro ($${price}/mo) for unlimited connections.`,
      403,
      "TIER_LIMIT"
    );
  }
}
