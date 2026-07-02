#!/usr/bin/env node
/**
 * scripts/e2e-llm-driver.mjs — harness-agnostic LLM driver for E2E tests.
 *
 * Replaces `spawnSync("claude", ["-p", prompt])` as the session-generation
 * mechanism in E2E test scripts. Why this exists:
 *
 *   - `claude -p` couples the E2E to Claude Code being installed.
 *   - Claude Code's session-file persistence behavior differs by OS
 *     (macOS writes ~/.claude/projects/...jsonl; Linux/WSL2 reportedly
 *     doesn't write session files at all on `claude -p` invocations).
 *   - The proxy daemon already makes capture universal — any HTTPS call
 *     to a recognized LLM endpoint is captured. So the E2E driver
 *     should exercise the same universal path the proxy provides.
 *
 * Mechanism:
 *   1. curl posts a real chat request to api.anthropic.com.
 *   2. curl is configured to route through the Synapse proxy at
 *      http://127.0.0.1:7727 with the Synapse CA in --cacert.
 *   3. The proxy intercepts, decrypts, forwards upstream, captures the
 *      request/response into the same pipeline as a real client.
 *   4. The captured session shows up on the backend the same way a
 *      `claude -p` session would have on macOS.
 *
 * Why curl, not Node fetch:
 *   - curl ships natively on macOS, Linux, and Windows 10+ — no Node
 *     library dependency, no `npm install` step.
 *   - HTTPS_PROXY + --cacert handling is curl's bread-and-butter and
 *     doesn't depend on Node's undici version or fetch's experimental
 *     dispatcher API.
 *   - Replacing one subprocess (claude -p) with another (curl) preserves
 *     test shape; the harness-agnosticism comes from curl being universal
 *     where claude is not.
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY in env (or passed via opts.apiKey).
 *   - Synapse proxy enabled and CA trusted (run
 *     `synapsesync capture proxy install && synapsesync capture proxy enable`).
 *   - curl on PATH (default everywhere; we check and fail clearly if not).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_CA_PATH = path.join(homedir(), ".synapse", "proxy", "ca.pem");
const DEFAULT_PROXY = "http://127.0.0.1:7727";

/**
 * Make a real Anthropic /v1/messages call through the Synapse proxy.
 *
 * @param {object} opts
 * @param {string} opts.prompt           - User message text
 * @param {string} [opts.model]          - Anthropic model id (defaults to a cheap haiku)
 * @param {string} [opts.apiKey]         - Override ANTHROPIC_API_KEY env var
 * @param {string} [opts.proxy]          - Proxy URL (default http://127.0.0.1:7727)
 * @param {string} [opts.caPath]         - Path to the Synapse proxy CA pem
 * @param {string} [opts.userAgent]      - UA header the proxy will see (drives UA classifier)
 * @param {number} [opts.timeoutMs]      - Curl --max-time (default 60s)
 * @returns {{ stdoutText: string, response: object, elapsedMs: number }}
 *   `stdoutText` is the concatenated assistant text content (matches what
 *   `claude -p prompt` would have printed on stdout). `response` is the
 *   full parsed Anthropic JSON.
 * @throws on curl missing / non-2xx / parse failure / API error.
 */
export function callAnthropicViaProxy(opts = {}) {
  const {
    prompt,
    model = "claude-haiku-4-5-20251001",
    apiKey = process.env.ANTHROPIC_API_KEY,
    proxy = DEFAULT_PROXY,
    caPath = DEFAULT_CA_PATH,
    userAgent = "synapse-e2e-driver/1.0 (harness-agnostic-test)",
    timeoutMs = 60_000,
  } = opts;

  if (!prompt) throw new Error("prompt required");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required (set env var or pass opts.apiKey)");
  if (!existsSync(caPath)) {
    throw new Error(
      `Synapse CA not found at ${caPath}. Run: synapsesync capture proxy install && synapsesync capture proxy enable`,
    );
  }

  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["curl"], { encoding: "utf-8" });
  if (which.status !== 0) {
    throw new Error("curl not on PATH — install curl (ships natively on macOS, Linux, Windows 10+)");
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
      "-sS", // silent progress, show errors
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

  // Concatenate text blocks in the response — matches what `claude -p` would
  // have printed. Anthropic responses are blocks of `{ type, text }`.
  const stdoutText = Array.isArray(parsed.content)
    ? parsed.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
    : "";

  return { stdoutText, response: parsed, elapsedMs };
}
