import { chatgptAdapter } from "./adapters/chatgpt.js";
import { claudeAdapter } from "./adapters/claude-ai.js";
import type { CaptureAdapter } from "./adapters/types.js";

export const ADAPTERS: CaptureAdapter[] = [claudeAdapter, chatgptAdapter];

export function adapterForHost(host: string): CaptureAdapter | undefined {
  return ADAPTERS.find((a) => a.host === host);
}
