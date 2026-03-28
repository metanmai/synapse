import type { AgentAdapter, CanonicalMessage, FidelityMode } from "./types";

/**
 * Raw/passthrough adapter — treats input as already in canonical format.
 * Never auto-detected; used as fallback when no other adapter matches.
 */
export const rawAdapter: AgentAdapter = {
  name: "raw",

  detect(_raw: unknown): boolean {
    // Raw adapter is never auto-detected — it's the explicit fallback
    return false;
  },

  toCanonical(raw: unknown): CanonicalMessage[] {
    if (!Array.isArray(raw)) return [];
    // Assume input is already canonical format, filter for valid entries
    return raw.filter(
      (msg): msg is CanonicalMessage =>
        typeof msg === "object" &&
        msg !== null &&
        typeof (msg as Record<string, unknown>).role === "string" &&
        typeof (msg as Record<string, unknown>).content === "string",
    );
  },

  fromCanonical(messages: CanonicalMessage[], _fidelity: FidelityMode): CanonicalMessage[] {
    // Passthrough — return as-is regardless of fidelity
    return messages;
  },
};
