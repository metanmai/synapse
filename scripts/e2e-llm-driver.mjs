#!/usr/bin/env node
/**
 * scripts/e2e-llm-driver.mjs — harness-agnostic LLM driver for E2E tests.
 *
 * Generates a real LLM session for the E2E test pipeline using ONE of two
 * paths, picked automatically based on what's available in the environment:
 *
 *   1. DIRECT-API mode  — when any of ANTHROPIC_API_KEY, OPENROUTER_API_KEY,
 *      or DEEPSEEK_API_KEY is in env. Uses curl to POST to the matching
 *      provider's API routed through the Synapse proxy. No CLI tool required
 *      at all. Truly portable: macOS, Linux, Windows.
 *
 *      Provider priority (first available key wins):
 *        ANTHROPIC_API_KEY   → api.anthropic.com/v1/messages
 *        OPENROUTER_API_KEY  → openrouter.ai/api/v1/chat/completions
 *        DEEPSEEK_API_KEY    → api.deepseek.com/v1/chat/completions
 *
 *   2. CLI-DRIVER mode  — when no direct-API key is set, OR `forceCli` is
 *      true. Spawns whatever AI CLI the user has locally (`claude -p` by
 *      default; override e.g. `crush run` on WSL2). The spawned CLI inherits
 *      HTTPS_PROXY + NODE_EXTRA_CA_CERTS, its HTTPS calls go through the
 *      Synapse proxy → captured the same way as direct-API mode.
 *
 * Why multiple providers:
 *   - DeepSeek is ~100× cheaper than Anthropic for E2E ($0.0001/call vs
 *     $0.01/call) — CI cost drops from cents to micro-cents.
 *   - OpenRouter gives access to Claude models without a direct Anthropic
 *     billing relationship; also supports free-tier models.
 *   - Users can run E2E with whatever key they already have.
 *
 * Why `forceCli`:
 *   - Some multi-device tests depend on the spawned CLI's hook firing
 *     (e.g. SYNAPSE_HOME swap relies on the Claude Code SessionEnd hook
 *     running in the spawned process's env — direct-API curl has no hook).
 *
 * Both paths emit a CapturedSession via the proxy → daemon → backend
 * pipeline; the test code downstream is identical regardless of which
 * mode fired.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_CA_PATH = path.join(homedir(), ".synapse", "proxy", "ca.pem");
const DEFAULT_PROXY = "http://127.0.0.1:7727";
const DEFAULT_CLI_DRIVER = "claude -p";

// ── Provider definitions ─────────────────────────────────────────────────

/**
 * @typedef {object} Provider
 * @property {string} name          — human-readable label (e.g. "Anthropic")
 * @property {string} envKey        — env var to check (e.g. "ANTHROPIC_API_KEY")
 * @property {string} endpoint      — full HTTPS URL
 * @property {string} model         — default model
 * @property {(apiKey: string, body: Record<string,unknown>) => string[]} buildCurlArgs
 * @property {(stdout: string) => string} extractText — parse response → text
 */

/** @type {Provider[]} */
const PROVIDERS = [
  {
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    endpoint: "https://api.anthropic.com/v1/messages",
    model: "claude-haiku-4-5-20251001",
    buildCurlArgs(apiKey, body) {
      return [
        "-H",
        `x-api-key: ${apiKey}`,
        "-H",
        "anthropic-version: 2023-06-01",
        "-d",
        JSON.stringify({ ...body, max_tokens: body.max_tokens ?? 256 }),
      ];
    },
    extractText(stdout) {
      const parsed = JSON.parse(stdout);
      if (parsed.type === "error") {
        throw new Error(`Anthropic API error: ${parsed.error?.message ?? JSON.stringify(parsed.error)}`);
      }
      return Array.isArray(parsed.content)
        ? parsed.content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text)
            .join("\n")
        : "";
    },
  },
  {
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-3.5-haiku",
    buildCurlArgs(apiKey, body) {
      const payload = {
        model: body.model ?? this.model,
        max_tokens: body.max_tokens ?? 256,
        messages: body.messages,
      };
      return [
        "-H",
        `Authorization: Bearer ${apiKey}`,
        "-H",
        "HTTP-Referer: https://github.com/metanmai/synapse",
        "-H",
        "X-Title: synapse-e2e",
        "-d",
        JSON.stringify(payload),
      ];
    },
    extractText(stdout) {
      const parsed = JSON.parse(stdout);
      if (parsed.error) {
        throw new Error(`OpenRouter API error: ${parsed.error?.message ?? JSON.stringify(parsed.error)}`);
      }
      return parsed.choices?.[0]?.message?.content ?? "";
    },
  },
  {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    buildCurlArgs(apiKey, body) {
      const payload = {
        model: body.model ?? this.model,
        max_tokens: body.max_tokens ?? 256,
        messages: body.messages,
      };
      return ["-H", `Authorization: Bearer ${apiKey}`, "-d", JSON.stringify(payload)];
    },
    extractText(stdout) {
      const parsed = JSON.parse(stdout);
      if (parsed.error) {
        throw new Error(`DeepSeek API error: ${parsed.error?.message ?? JSON.stringify(parsed.error)}`);
      }
      return parsed.choices?.[0]?.message?.content ?? "";
    },
  },
];

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Drive a real LLM session for E2E capture. Auto-selects the best available
 * provider (direct-API) or falls back to CLI mode.
 *
 * @param {object} opts
 * @param {string} opts.prompt       - User message text
 * @param {string} [opts.model]      - Override the provider's default model
 * @param {string} [opts.apiKey]     - Override auto-detection (forces direct-API mode)
 * @param {string} [opts.driverCmd]  - Override SYNAPSE_E2E_DRIVER (forces CLI mode if no apiKey)
 * @param {boolean} [opts.forceCli]  - Use CLI-driver mode even if a direct-API key is set.
 *                                     Required for tests that depend on the spawned CLI's
 *                                     hook firing (e.g. multi-device's SYNAPSE_HOME swap
 *                                     relies on the Claude Code SessionEnd hook running
 *                                     in the spawned process's env — direct-API curl has
 *                                     no hook).
 * @param {string} [opts.proxy]      - Proxy URL (default http://127.0.0.1:7727)
 * @param {string} [opts.caPath]     - Synapse CA pem path
 * @param {string} [opts.userAgent]  - UA header (direct-API mode only)
 * @param {string} [opts.cwd]        - Working dir for CLI-driver subprocess
 * @param {Record<string,string>} [opts.extraEnv]
 *                                   - Additional env vars merged into the spawned process's
 *                                     env. Used by multi-device tests to pass SYNAPSE_HOME.
 *                                     In CLI-driver mode the spawned tool inherits these;
 *                                     in direct-API mode they're merged into curl's env
 *                                     (mostly irrelevant since curl ignores most app vars,
 *                                     but kept consistent for callers that don't know which
 *                                     mode will fire).
 * @param {number} [opts.timeoutMs]  - Max wait (default 120s)
 * @returns {{ stdoutText: string, mode: "direct-api"|"cli-driver", driver: string, provider?: string, elapsedMs: number }}
 *   `stdoutText` is the assistant response text. `mode` tells the caller
 *   which path was taken. `driver` is the resolved driver name. `provider`
 *   is the provider name when in direct-API mode.
 * @throws on missing prereqs / non-zero exit / API error / parse failure.
 */
export function generateSession(opts = {}) {
  const {
    prompt,
    model: _modelOpt,
    apiKey: _explicitKey,
    driverCmd = process.env.SYNAPSE_E2E_DRIVER ?? DEFAULT_CLI_DRIVER,
    forceCli = false,
    proxy = DEFAULT_PROXY,
    caPath = DEFAULT_CA_PATH,
    userAgent = "synapse-e2e-driver/1.0 (harness-agnostic-test)",
    cwd,
    extraEnv,
    timeoutMs = 120_000,
  } = opts;

  if (!prompt) throw new Error("prompt required");
  if (!existsSync(caPath)) {
    throw new Error(
      `Synapse CA not found at ${caPath}. Run: synapsesync capture proxy install && synapsesync capture proxy enable`,
    );
  }

  // forceCli short-circuits to CLI mode — required for tests that rely on
  // the CLI's hook firing (multi-device SYNAPSE_HOME swap).
  if (forceCli) {
    return runCliDriver({ prompt, driverCmd, proxy, caPath, cwd, extraEnv, timeoutMs });
  }

  // Auto-detect the best available direct-API provider.
  const detected = _explicitKey
    ? { provider: null, apiKey: _explicitKey } // explicit key → use the old Anthropic-only path
    : detectProvider(process.env);
  const apiKey = _explicitKey ?? detected.apiKey;

  if (apiKey) {
    if (detected.provider) {
      // Multi-provider path: use the detected provider's adapter.
      return callProviderViaProxy({
        provider: detected.provider,
        apiKey,
        prompt,
        model: _modelOpt ?? detected.provider.model,
        proxy,
        caPath,
        userAgent,
        extraEnv,
        timeoutMs,
        cwd,
      });
    }
    // Legacy: explicit apiKey opt with no detected provider → Anthropic.
    return callProviderViaProxy({
      provider: PROVIDERS[0],
      apiKey,
      prompt,
      model: _modelOpt ?? PROVIDERS[0].model,
      proxy,
      caPath,
      userAgent,
      extraEnv,
      timeoutMs,
      cwd,
    });
  }

  // No direct-API key available → CLI fallback.
  return runCliDriver({ prompt, driverCmd, proxy, caPath, cwd, extraEnv, timeoutMs });
}

/**
 * Scan process.env for available provider API keys. Returns the first
 * match (highest priority first in PROVIDERS order).
 *
 * @param {Record<string,string|undefined>} env
 * @returns {{ provider: Provider|null, apiKey: string|null }}
 */
export function detectProvider(env) {
  for (const p of PROVIDERS) {
    const key = env[p.envKey];
    if (key) return { provider: p, apiKey: key };
  }
  return { provider: null, apiKey: null };
}

// ── Direct-API: multi-provider ──────────────────────────────────────────

/**
 * Curl-post a chat request through the Synapse proxy using the given
 * provider's API format.
 */
export function callProviderViaProxy({
  provider,
  apiKey,
  prompt,
  model,
  proxy,
  caPath,
  userAgent,
  extraEnv,
  timeoutMs,
  cwd,
}) {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(whichCmd, ["curl"], { encoding: "utf-8" });
  if (which.status !== 0) {
    throw new Error("curl not on PATH (required by direct-API mode — ships natively on macOS, Linux, Windows 10+)");
  }

  const body = { model, messages: [{ role: "user", content: prompt }] };
  const providerArgs = provider.buildCurlArgs(apiKey, body);

  // Windows curl ships with SChannel as its TLS backend (Git Bash, the
  // default on GitHub Actions windows-latest). SChannel honours the system
  // trust store — the Synapse CA already lives there after `proxy install`
  // — but ALSO insists on a revocation check (CRL/OCSP) for every cert in
  // the chain, including our self-signed root. There is no CRL or OCSP
  // responder for a per-machine CA, so SChannel returns "the revocation
  // status is unknown" and curl exits 60. `--ssl-no-revoke` tells SChannel
  // to skip the check; ignored as a no-op on OpenSSL-backed curls.
  const platformCurlFlags = process.platform === "win32" ? ["--ssl-no-revoke"] : [];

  // `X-Synapse-Cwd` opts the captured session into cwd-based project
  // routing. The proxy reads this header, strips it before forwarding
  // upstream, and tags CapturedSession.projectPath with it so cloud-sync's
  // findOrCreateProjectByGit lookup resolves to the user's real project
  // instead of the phantom "unknown" bucket. Only sent when the caller
  // supplied a cwd — preserves the "unknown" fallback for cwd-less callers.
  const cwdHeader = cwd ? ["-H", `X-Synapse-Cwd: ${cwd}`] : [];

  const started = Date.now();
  const result = spawnSync(
    "curl",
    [
      "-x",
      proxy,
      "--cacert",
      caPath,
      ...platformCurlFlags,
      "-sS",
      "-X",
      "POST",
      "-H",
      `User-Agent: ${userAgent}`,
      "-H",
      "Content-Type: application/json",
      ...cwdHeader,
      ...providerArgs,
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      provider.endpoint,
    ],
    {
      encoding: "utf-8",
      // Pass extraEnv through for consistency with CLI-driver mode. Curl
      // itself doesn't care about most app vars, but callers shouldn't have
      // to know which mode will fire to pass env.
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    },
  );
  const elapsedMs = Date.now() - started;

  if (result.status !== 0) {
    throw new Error(`curl exited ${result.status}: ${(result.stderr ?? "(no stderr)").trim().slice(0, 500)}`);
  }

  let stdoutText;
  try {
    stdoutText = provider.extractText(result.stdout);
  } catch (e) {
    if (e.message?.includes("API error")) throw e;
    throw new Error(`failed to parse ${provider.name} response as JSON: ${(result.stdout ?? "").slice(0, 500)}`);
  }

  return { stdoutText, mode: "direct-api", driver: "curl", provider: provider.name, elapsedMs };
}

// ── CLI-driver ──────────────────────────────────────────────────────────

/**
 * CLI-DRIVER path: spawn the user's local AI CLI with HTTPS_PROXY +
 * NODE_EXTRA_CA_CERTS pointing at the Synapse proxy. The CLI's API call
 * routes through the proxy, capture happens on the proxy side.
 *
 * `driverCmd` is split on whitespace into [cmd, ...args]; the prompt is
 * appended as the final arg. Examples:
 *   "claude -p"   → spawn("claude", ["-p", "<prompt>"])
 *   "crush run"   → spawn("crush", ["run", "<prompt>"])
 */
export function runCliDriver({ prompt, driverCmd, proxy, caPath, cwd, extraEnv, timeoutMs }) {
  const tokens = driverCmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`SYNAPSE_E2E_DRIVER must be a command line (e.g. "claude -p" or "crush run"); got "${driverCmd}"`);
  }
  const [cmd, ...baseArgs] = tokens;

  const whichCmd = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(whichCmd, [cmd], { encoding: "utf-8" });
  if (which.status !== 0) {
    const configuredKeys = PROVIDERS.map((p) => (process.env[p.envKey] ? p.envKey : null)).filter(Boolean);
    const hint = configuredKeys.length ? ` (found: ${configuredKeys.join(", ")} — direct-API mode is available)` : "";
    throw new Error(
      `CLI driver "${cmd}" not on PATH. Set one of ANTHROPIC_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY for direct-API mode${hint}, OR set SYNAPSE_E2E_DRIVER to a working CLI (e.g. "claude -p", "crush run").`,
    );
  }

  const env = {
    ...process.env,
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    NODE_EXTRA_CA_CERTS: caPath,
    ...extraEnv,
  };

  const started = Date.now();
  const result = spawnSync(cmd, [...baseArgs, prompt], {
    env,
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
  });
  const elapsedMs = Date.now() - started;

  if (result.status !== 0) {
    throw new Error(`${cmd} exited ${result.status}: ${(result.stderr ?? "(no stderr)").trim().slice(0, 500)}`);
  }

  return {
    stdoutText: result.stdout ?? "",
    mode: "cli-driver",
    driver: tokens.join(" "),
    elapsedMs,
  };
}
