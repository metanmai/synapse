import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Actor } from "@synapse/shared/handoff/types.js";
import { synapseRoot } from "./handoff-paths.js";

/**
 * Phase 2 (D-09): exported so the brief renderer can compare the local
 * device_id to a remote actor's device_id and decide whether to surface
 * hostname attribution ("(on laptop-A)") for cross-device same-user activity.
 */
export function readOrCreateDeviceId(): string {
  const idFile = path.join(synapseRoot(), "device_id");
  if (fs.existsSync(idFile)) return fs.readFileSync(idFile, "utf-8").trim();
  fs.mkdirSync(synapseRoot(), { recursive: true });
  const id = randomBytes(8).toString("hex");
  fs.writeFileSync(idFile, id);
  return id;
}

/**
 * Build an Actor record for an event being emitted from THIS process.
 *
 * `client` identifies the surface the event originated from. Pass:
 *   - "claude-code"     — Claude Code hook handlers (hooks/*.ts)
 *   - "synapsesync-cli" — interactive CLI commands (cli/handoff-commands.ts)
 *   - "synapse-daemon"  — daemon-emitted events (daemon.ts inferral path)
 *   - actual tool tag   — proxy-source emitted sessions (per-UA-classifier)
 *
 * Default "unknown" only fires when a caller doesn't pass anything;
 * production sites should always be explicit. The previous default
 * was "claude-code" — that mislabeled every CLI invocation.
 */
export function resolveActor(user_id: string, kind: Actor["kind"] = "human", client = "unknown"): Actor {
  return { user_id, kind, device_id: readOrCreateDeviceId(), hostname: os.hostname(), client };
}
