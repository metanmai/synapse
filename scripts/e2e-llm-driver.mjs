#!/usr/bin/env node
/**
 * scripts/e2e-llm-driver.mjs — harness-agnostic LLM driver for E2E tests.
 *
 * Generates a real LLM session for the E2E test pipeline using ONE of two
 * paths, picked automatically based on what's available in the environment:
 *
 *   1. DIRECT-API mode  — when `ANTHROPIC_API_KEY` is in env. Uses curl to
 *      POST api.anthropic.com/v1/messages routed through the Synapse proxy.
 *      No CLI tool required at all. Truly portable: macOS, Linux, Windows.
 *
 *   2. CLI-DRIVER mode  — when `ANTHROPIC_API_KEY` isn't set OR explicit
 *      via `SYNAPSE_E2E_DRIVER` env var. Spawns whatever AI CLI the user
 *      has locally (`claude -p` by default; override e.g. `crush run` on
 *      WSL2). The spawned CLI inherits HTTPS_PROXY + NODE_EXTRA_CA_CERTS,
 *      its HTTPS calls go through the Synapse proxy → captured the same
 *      way as direct-API mode.
 *
 * Why both:
 *   - Claude Code authenticates via OAuth (stored in ~/.claude.json), not
 *     a plain API key — so most Mac users WON'T have ANTHROPIC_API_KEY in
 *     env but DO have a working `claude -p`. CLI-driver mode covers them.
 *   - CI environments and Linux/WSL2 users with crush instead of claude
 *     can either set ANTHROPIC_API_KEY (direct-API) or set
 *     SYNAPSE_E2E_DRIVER="crush run" (CLI-driver). Both paths are
 *     harness-agnostic; neither hardcodes Claude Code as the canonical.
 *
 * Why curl (direct-API mode), not Node fetch + undici.ProxyAgent:
 *   - curl ships natively on macOS, Linux, Windows 10+ — no Node version
 *     or undici API surface dependency.
 *
 * Why spawn (CLI-driver mode), not exec or shell:
 *   - No shell quoting bugs with prompts containing apostrophes / quotes /
 *     backticks. Pass argv directly to the child process.
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

/**
 * Drive a real LLM session for E2E capture. Auto-selects direct-API or
 * CLI-driver mode based on env. See file header for the full design.
 *
 * @param {object} opts
 * @param {string} opts.prompt       - User message text
 * @param {string} [opts.model]      - Anthropic model (direct-API mode only)
 * @param {string} [opts.apiKey]     - Override ANTHROPIC_API_KEY (forces direct-API mode)
 * @param {string} [opts.driverCmd]  - Override SYNAPSE_E2E_DRIVER (forces CLI mode if no apiKey)
 * @param {string} [opts.proxy]      - Proxy URL (default http://127.0.0.1:7727)
 * @param {string} [opts.caPath]     - Synapse CA pem path
 * @param {string} [opts.userAgent]  - UA header (direct-API mode only)
 * @param {string} [opts.cwd]        - Working dir for CLI-driver subprocess
 * @param {number} [opts.timeoutMs]  - Max wait (default 120s)
 * @returns {{ stdoutText: string, mode: "direct-api"|"cli-driver", driver: string, elapsedMs: number }}
 *   `stdoutText` is the assistant response text. `mode` tells the caller
 *   which path was taken. `driver` is the resolved driver name ("curl" or
 *   the CLI command line).
 * @throws on missing prereqs / non-zero exit / API error / parse failure.
 */
export function generateSession(opts = {}) {
  const {
    prompt,
    model = "claude-haiku-4-5-20251001",
    apiKey = process.env.ANTHROPIC_API_KEY,
    driverCmd = process.env.SYNAPSE_E2E_DRIVER ?? DEFAULT_CLI_DRIVER,
    proxy = DEFAULT_PROXY,
    caPath = DEFAULT_CA_PATH,
    userAgent = "synapse-e2e-driver/1.0 (harness-agnostic-test)",
    cwd,
    timeoutMs = 120_000,
  } = opts;

  if (!prompt) throw new Error("prompt required");
  if (!existsSync(caPath)) {
    throw new Error(
      `Synapse CA not found at ${caPath}. Run: synapsesync capture proxy install && synapsesync capture proxy enable`,
    );
  }

  // Branch on what the env provides. ANTHROPIC_API_KEY wins because it's
  // the most portable (no CLI binary needed); CLI mode is the fallback
  // that works whenever any AI CLI is installed.
  if (apiKey) {
    return callAnthropicViaProxy({ prompt, model, apiKey, proxy, caPath, userAgent, timeoutMs });
  }
  return runCliDriver({ prompt, driverCmd, proxy, caPath, cwd, timeoutMs });
}

/**
 * DIRECT-API path: curl posts a real Anthropic chat request through the
 * Synapse proxy. Requires ANTHROPIC_API_KEY.
 */
export function callAnthropicViaProxy({ prompt, model, apiKey, proxy, caPath, userAgent, timeoutMs }) {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(whichCmd, ["curl"], { encoding: "utf-8" });
  if (which.status !== 0) {
    throw new Error("curl not on PATH (required by direct-API mode — ships natively on macOS, Linux, Windows 10+)");
  }

  const body = JSON.stringify({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const started = Date.now();
  const result = spawnSync(
    "curl",
    [
      "-x",
      proxy,
      "--cacert",
      caPath,
      "-sS",
      "-X",
      "POST",
      "-H",
      `x-api-key: ${apiKey}`,
      "-H",
      "anthropic-version: 2023-06-01",
      "-H",
      `User-Agent: ${userAgent}`,
      "-H",
      "Content-Type: application/json",
      "-d",
      body,
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      "https://api.anthropic.com/v1/messages",
    ],
    { encoding: "utf-8" },
  );
  const elapsedMs = Date.now() - started;

  if (result.status !== 0) {
    throw new Error(`curl exited ${result.status}: ${(result.stderr ?? "(no stderr)").trim().slice(0, 500)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`failed to parse Anthropic response as JSON: ${(result.stdout ?? "").slice(0, 500)}`);
  }

  if (parsed.type === "error") {
    throw new Error(`Anthropic API error: ${parsed.error?.message ?? JSON.stringify(parsed.error)}`);
  }

  const stdoutText = Array.isArray(parsed.content)
    ? parsed.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
    : "";

  return { stdoutText, mode: "direct-api", driver: "curl", elapsedMs };
}

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
export function runCliDriver({ prompt, driverCmd, proxy, caPath, cwd, timeoutMs }) {
  const tokens = driverCmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`SYNAPSE_E2E_DRIVER must be a command line (e.g. "claude -p" or "crush run"); got "${driverCmd}"`);
  }
  const [cmd, ...baseArgs] = tokens;

  const whichCmd = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(whichCmd, [cmd], { encoding: "utf-8" });
  if (which.status !== 0) {
    throw new Error(
      `CLI driver "${cmd}" not on PATH. Set ANTHROPIC_API_KEY to use direct-API mode instead, OR set SYNAPSE_E2E_DRIVER to a working CLI (e.g. "claude -p", "crush run").`,
    );
  }

  const env = {
    ...process.env,
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    NODE_EXTRA_CA_CERTS: caPath,
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
