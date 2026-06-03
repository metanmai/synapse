// Wave 0 stub — fill in Plan 01-03 (BUG-03 — proxy-resilient MCP command resolver).
// Exports the type contract that Wave 2 production code will implement and Wave 1
// RED tests can import. Calling either function at runtime throws "not implemented
// — Wave 2" so any premature use surfaces loudly.

/**
 * Shape of an MCP server command entry, suitable for writing into
 * `.mcp.json` under `mcpServers.synapse`. `command` is the executable
 * (absolute path, or "npx" as last resort); `args` is the argv tail;
 * `env` carries `SYNAPSE_API_KEY` (and nothing else by design).
 */
export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Resolve the most-reliable command shape for spawning the Synapse MCP
 * server on the current machine. Wave 2 (Plan 01-03) fills the body with the
 * `which → dist → npx` fallback chain. Sync per RESEARCH §"Open Questions" #3.
 *
 * @param _apiKey  Synapse API key to embed in the returned env record
 */
export function resolveSynapseMcpCommand(_apiKey: string): McpCommand {
  throw new Error("not implemented — Wave 2");
}

/**
 * Probe `https://registry.npmjs.org/-/ping` with an `AbortController`-driven
 * timeout. Returns `true` on a 2xx response, `false` on any other outcome
 * (timeout, network error, non-2xx status). Wave 2 (Plan 01-03) fills the body.
 *
 * @param _timeoutMs  abort budget in milliseconds; defaults to 2000 in the impl
 */
export async function probeNpmRegistry(_timeoutMs?: number): Promise<boolean> {
  throw new Error("not implemented — Wave 2");
}
