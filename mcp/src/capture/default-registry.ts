import { AdapterRegistry } from "./adapter-registry.js";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { ClineAdapter } from "./adapters/cline.js";
import { CodexAdapter } from "./adapters/codex.js";
import { CopilotCliAdapter } from "./adapters/copilot-cli.js";
import { CursorAdapter } from "./adapters/cursor.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { RooCodeAdapter } from "./adapters/roo-code.js";

/**
 * Build an AdapterRegistry with every shipping adapter registered. Single
 * source of truth for the "what tools do we know about" list — keeps the
 * capture-worker and the pull-compact path from drifting when a new
 * adapter lands.
 */
export function defaultRegistry(): AdapterRegistry {
  const r = new AdapterRegistry();
  r.register(new ClaudeCodeAdapter());
  r.register(new ClineAdapter());
  r.register(new CodexAdapter());
  r.register(new CopilotCliAdapter());
  r.register(new CursorAdapter());
  r.register(new GeminiAdapter());
  r.register(new RooCodeAdapter());
  return r;
}
