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

export function resolveActor(user_id: string, kind: Actor["kind"] = "human"): Actor {
  return { user_id, kind, device_id: readOrCreateDeviceId(), hostname: os.hostname(), client: "claude-code" };
}
