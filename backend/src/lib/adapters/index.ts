import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { rawAdapter } from "./raw";
import type { AgentAdapter } from "./types";

export type { AgentAdapter } from "./types";
export type { CanonicalMessage, FidelityMode, ToolInteraction, MessageSource, MediaAttachment } from "./types";
export { anthropicAdapter } from "./anthropic";
export { openaiAdapter } from "./openai";
export { rawAdapter } from "./raw";

/** All adapters in detection priority order */
const adapters: AgentAdapter[] = [anthropicAdapter, openaiAdapter];

/** Registry of adapters by name */
const adapterMap: Record<string, AgentAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  raw: rawAdapter,
};

/**
 * Get an adapter by name. Falls back to raw adapter if name is unknown.
 */
export function getAdapter(name: string): AgentAdapter {
  return adapterMap[name] ?? rawAdapter;
}

/**
 * Detect which adapter can handle the given raw message format.
 * Tries each adapter's detect() in priority order.
 * Returns "raw" if no adapter matches.
 */
export function detectAdapter(raw: unknown): string {
  for (const adapter of adapters) {
    if (adapter.detect(raw)) {
      return adapter.name;
    }
  }
  return "raw";
}
