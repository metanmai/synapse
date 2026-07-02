import type { CaptureHost } from "@synapse/shared/capture-hosts.js";

export interface CapturedTurn {
  role: "user" | "assistant";
  content: string;
  ts?: string;
}

/**
 * Per-host capture adapter. Refined for the GO-FETCH gate decision: the content
 * script installs ONE fetch hook, finds the adapter for `location.host`, and for
 * each matching request feeds the request body (→ user turn) and the streamed
 * response text (→ assistant turn) through these pure parsers. Keeping them pure
 * is what makes them golden-fixture testable.
 */
export interface CaptureAdapter {
  host: CaptureHost;
  /** True if `url` is this host's conversation/completion endpoint. */
  matchesCompletion(url: string): boolean;
  /** Extract the user turn from the request body, or null. */
  parseRequest(body: unknown): CapturedTurn | null;
  /** Extract the assistant turn from the (streamed) response text, or null. */
  parseResponse(responseText: string): CapturedTurn | null;
}
