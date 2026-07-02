/**
 * Types for the LLM API proxy daemon (Layer 1: pure data shapes).
 *
 * The proxy daemon (later slices) intercepts HTTPS traffic to LLM providers
 * (Anthropic, OpenAI, Google), and produces a stream of `CapturedRequest`
 * entries — one per request/response pair. This file defines that shape
 * plus the configuration knobs for session reconstruction.
 *
 * Layer 1 owns:
 *   - CapturedRequest                  (the proxy's output type)
 *   - EndpointInfo                     (URL → provider classification)
 *   - ReconstructionOptions            (knobs for session-reconstruction)
 *
 * Layer 3+ (the proxy server itself) will produce CapturedRequest values;
 * Layer 1 (this slice) consumes them and reconstructs CapturedSessions.
 */

/**
 * A single HTTP request/response pair captured by the proxy after TLS
 * decryption + body buffering. The body is the parsed JSON for chat
 * endpoints; for streaming responses (Anthropic SSE), the proxy server
 * is expected to have ALREADY assembled the streamed deltas into a
 * canonical non-streaming response body before producing this entry —
 * Layer 1 does NOT handle SSE chunks.
 */
export interface CapturedRequest {
  /** ISO 8601 timestamp when the proxy first saw this request. */
  timestamp: string;
  /** The endpoint classification — see `recognizeEndpoint()`. */
  endpoint: EndpointInfo;
  /** Parsed request body. `unknown` because the shape varies by provider;
   *  the per-provider extractors in session-reconstruction.ts narrow it. */
  requestBody: unknown;
  /** Parsed response body. For streaming providers, the assembled
   *  non-streaming form (caller's responsibility — Layer 1 sees only
   *  the final assembled shape). */
  responseBody: unknown;
  /** HTTP status code from upstream. Non-2xx requests are dropped during
   *  reconstruction (a failed call didn't produce a complete turn). */
  statusCode: number;
}

/**
 * Classification of an HTTP endpoint observed by the proxy.
 *
 * The proxy sees MANY non-chat endpoints (the spike showed claude CLI
 * hits 30+ non-chat URLs per session: /mcp-registry, /event_logging,
 * /claude_code/settings, etc.). Only requests with `capture: true` are
 * fed into session reconstruction; the rest are recorded for diagnostics
 * but never become CapturedSessions.
 */
export interface EndpointInfo {
  /** Recognized provider, or null if the host doesn't match a known LLM API. */
  provider: "anthropic" | "openai" | "google" | null;
  /** What kind of endpoint this is on the provider. `"messages"` /
   *  `"chat"` / `"generateContent"` are the canonical chat endpoints
   *  per provider. Anything else is non-chat (telemetry, registry,
   *  embeddings, etc.) and not captured. */
  kind: "messages" | "chat" | "generateContent" | "other" | null;
  /** True iff this is a chat endpoint we should reconstruct into
   *  CapturedSessions. False for everything else — keeps telemetry
   *  out of session data. */
  capture: boolean;
}

/**
 * Knobs for `reconstructSessions()`. All durations in milliseconds.
 */
export interface ReconstructionOptions {
  /**
   * Two consecutive requests with the same first-message hash are
   * treated as the SAME session if they arrive within this window;
   * past this window, the same prefix is treated as a NEW session
   * (user resumed an old conversation in a fresh context, common
   * for AI tools that re-send context on session restart).
   *
   * Default: 5 minutes — long enough to absorb retry storms + idle
   * pauses, short enough that a genuine "next morning" session
   * separates cleanly.
   */
  idleMs?: number;
}
