/**
 * Proxy enablement config — Layer 9.
 *
 * Persists the user's "is the proxy turned on?" decision across daemon
 * restarts. Before this slice, the only way to enable the proxy was to
 * set `SYNAPSE_PROXY_ENABLE=1` in the shell rc and restart the daemon
 * from a shell where that env was set. That's brittle — if launchd
 * spawns the daemon without that env, the proxy stays off even though
 * the user "enabled" it in their shell.
 *
 * Config file: `~/.synapse/proxy-config.json`
 *   { "enabled": true, "enabledAt": "2026-05-30T..." }
 *
 * Resolution order — env wins over config (kubectl / git convention):
 *   SYNAPSE_PROXY_ENABLE="1"       → ON  (operator override)
 *   SYNAPSE_PROXY_ENABLE="0"       → OFF (operator override)
 *   env unset, config.enabled=true → ON
 *   env unset, config absent / false → OFF (default)
 *
 * The CLI (`synapsesync capture proxy enable` / `disable`) writes the
 * config + restarts the daemon. The daemon calls
 * `effectiveProxyEnabled(process.env)` at startup to decide whether
 * to spawn the proxy.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { synapseRoot } from "../handoff-paths.js";

export interface ProxyConfig {
  /** True iff the user has opted into the proxy via `proxy enable`. */
  enabled: boolean;
  /** ISO timestamp when enable was last invoked. Diagnostic only. */
  enabledAt?: string;
}

const DEFAULT_CONFIG: ProxyConfig = { enabled: false };

/** Filesystem path to the persisted proxy-config json. */
export function proxyConfigPath(): string {
  return path.join(synapseRoot(), "proxy-config.json");
}

/**
 * Read the persisted config. Returns the documented default
 * (`{ enabled: false }`) if the file is missing or malformed —
 * never throws. Onboarding "did the user enable the proxy?" must be
 * answerable without exception handling at every call site.
 */
export function readProxyConfig(): ProxyConfig {
  const fp = proxyConfigPath();
  if (!existsSync(fp)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(fp, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ProxyConfig>;
    return {
      enabled: parsed.enabled === true,
      enabledAt: typeof parsed.enabledAt === "string" ? parsed.enabledAt : undefined,
    };
  } catch {
    // Malformed JSON or read error — fail safe to disabled rather than
    // crashing the daemon at startup.
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist the config. Creates the parent dir (mode 0700) if needed. */
export function writeProxyConfig(config: ProxyConfig): void {
  const fp = proxyConfigPath();
  mkdirSync(path.dirname(fp), { recursive: true, mode: 0o700 });
  writeFileSync(fp, JSON.stringify(config, null, 2));
}

/**
 * Remove the persisted config. Idempotent — no-throw on missing file.
 * After this call, `readProxyConfig()` returns the default.
 */
export function deleteProxyConfig(): void {
  const fp = proxyConfigPath();
  try {
    rmSync(fp, { force: true });
  } catch {
    /* idempotent */
  }
}

/**
 * Single source of truth for "should the daemon start the proxy?"
 * Used by `capture-worker.ts` at startup AND by the CLI's `status`
 * report so what the daemon thinks matches what the user sees.
 */
export function effectiveProxyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const ev = env.SYNAPSE_PROXY_ENABLE;
  if (ev === "1") return true; // operator override: force on
  if (ev === "0") return false; // operator override: force off
  return readProxyConfig().enabled;
}
