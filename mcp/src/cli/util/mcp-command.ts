// Three-tier MCP-server-command resolver. Closes BUG-03.
// See RESEARCH.md §"Pattern 4" for the decision tree + rationale.
// Prefer absolute paths so proxy-restricted networks (Netskope) never
// have to resolve `npx synapsesync` at MCP-server-start time.

import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const PROXY_FALLBACK_WARNING =
  "npm registry unreachable; the MCP server may fail to start; run `npm i -g synapsesync` from a non-proxied network and rerun `synapsesync wizard`.";

const WHICH_COMMAND = process.platform === "win32" ? "where synapsesync" : "which synapsesync";

function resolvePackageDistEntry(): string {
  // here = mcp/src/cli/util (source) OR mcp/dist/cli/util (built) — three levels
  // up from this file in either case lands at the package root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(here, "../../..");
  return path.join(packageRoot, "dist", "index.js");
}

/**
 * Resolve the most-reliable MCP-server command shape for the current machine.
 * Sync — see RESEARCH §"Open Questions" #3. Never throws.
 */
export function resolveSynapseMcpCommand(apiKey: string): McpCommand {
  const env = { SYNAPSE_API_KEY: apiKey };

  // Tier 1: prefer an absolute synapsesync binary on PATH.
  try {
    const raw = child_process.execSync(WHICH_COMMAND, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    const candidate = raw.split(/\r?\n/)[0].trim();
    if (candidate.length > 0 && fs.existsSync(candidate)) {
      return { command: candidate, args: [], env };
    }
  } catch {
    // fall through
  }

  // Tier 2: prefer `node <abs>/dist/index.js` over the npx fallback.
  try {
    const distEntry = resolvePackageDistEntry();
    if (fs.existsSync(distEntry)) {
      return { command: process.execPath, args: [distEntry], env };
    }
  } catch {
    // fall through
  }

  // Tier 3: last resort — npx. The wizard outro warns the user (Plan 04).
  return { command: "npx", args: ["synapsesync"], env };
}

/**
 * 2-second probe against the npm registry's `-/ping` endpoint. Returns false
 * on any failure (timeout, network error, non-2xx). Used by the wizard outro
 * (Plan 04) to decide whether to surface `PROXY_FALLBACK_WARNING`.
 */
export async function probeNpmRegistry(timeoutMs = 2000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://registry.npmjs.org/-/ping", { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
