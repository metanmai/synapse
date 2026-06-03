/**
 * Phase 2 (IDENT-01, D-03): single source of truth for resolving the user_id
 * used by hook capture + the daemon. Replaces three previously-duplicated
 * inline copies (handlers.ts, run-daemon.ts, hook-dispatch.ts).
 *
 * Resolution order:
 *   1. ~/.synapse/config.json `user_id` — set by `synapse init` after a
 *      successful GET /api/account/me call (the canonical public.users.id)
 *   2. ~/.synapse/config.json `email` — legacy installs where init only had
 *      email; superseded the first time the user re-runs init
 *   3. "local-user" placeholder — fresh install before `synapse init` has
 *      run, OR config.json read fails for any reason
 *
 * Callers MUST NOT cache the return value — config.json may be rewritten by
 * `synapse init` mid-process, and the daemon reads on every hook dispatch.
 */

import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "./handoff-paths.js";

export function readUserIdFromConfig(): string {
  try {
    const configPath = path.join(synapseRoot(), "config.json");
    if (!fs.existsSync(configPath)) return "local-user";
    const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      user_id?: string;
      email?: string;
    };
    return c.user_id ?? c.email ?? "local-user";
  } catch {
    return "local-user";
  }
}
