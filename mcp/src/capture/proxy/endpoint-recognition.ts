/**
 * URL → EndpointInfo classification.
 *
 * The proxy daemon sees every HTTPS request the tool makes — chat
 * endpoints AND a long tail of supporting calls (telemetry, registry,
 * settings, metrics). This module's only job is to identify which
 * requests are "chat completions we care about" vs everything else.
 *
 * The spike against claude CLI revealed 30+ non-chat endpoints hit
 * per session — `/mcp-registry/v0/servers`, `/api/event_logging/v2/batch`,
 * `/api/claude_code/settings`, etc. Without this filter, the daemon
 * would record every telemetry POST as a captured session.
 *
 * Adding a new provider: add a new branch with two regexes — one for
 * its canonical chat endpoint (capture=true), and rely on the catch-all
 * to mark everything else (capture=false).
 */

import type { EndpointInfo } from "./types.js";

// Provider chat-endpoint patterns. Query strings are stripped before
// matching so we tolerate `?beta=true`-style variants.
const ANTHROPIC_CHAT = /^\/v1\/messages$/;
const OPENAI_CHAT = /^\/v1\/chat\/completions$/;
// Google embeds the model id in the path: /v1/models/gemini-1.5-pro:generateContent
// — and has both streaming + non-streaming variants. Both are chat.
const GOOGLE_CHAT = /^\/v\d+(?:beta\d*)?\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/;

const UNKNOWN: EndpointInfo = { provider: null, kind: null, capture: false };

/**
 * Classify a captured HTTPS request by (host, path) into a typed
 * EndpointInfo. Returns `{provider: null, kind: null, capture: false}`
 * for hosts that don't match any known LLM API — the proxy will simply
 * pass these through without recording.
 *
 * The path argument may include a query string; this function strips it
 * before regex matching.
 */
export function recognizeEndpoint(host: string, path: string): EndpointInfo {
  const cleanPath = stripQuery(path);
  const normalizedHost = host.toLowerCase();

  if (isAnthropicHost(normalizedHost)) {
    if (ANTHROPIC_CHAT.test(cleanPath)) {
      return { provider: "anthropic", kind: "messages", capture: true };
    }
    return { provider: "anthropic", kind: "other", capture: false };
  }
  if (isOpenAIHost(normalizedHost)) {
    if (OPENAI_CHAT.test(cleanPath)) {
      return { provider: "openai", kind: "chat", capture: true };
    }
    return { provider: "openai", kind: "other", capture: false };
  }
  if (isGoogleHost(normalizedHost)) {
    if (GOOGLE_CHAT.test(cleanPath)) {
      return { provider: "google", kind: "generateContent", capture: true };
    }
    return { provider: "google", kind: "other", capture: false };
  }
  return UNKNOWN;
}

function stripQuery(path: string): string {
  const i = path.indexOf("?");
  return i >= 0 ? path.slice(0, i) : path;
}

function isAnthropicHost(host: string): boolean {
  return host === "api.anthropic.com" || host.endsWith(".anthropic.com");
}

function isOpenAIHost(host: string): boolean {
  return host === "api.openai.com" || host.endsWith(".openai.com");
}

function isGoogleHost(host: string): boolean {
  return host === "generativelanguage.googleapis.com";
}
