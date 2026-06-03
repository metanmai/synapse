import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { synapseRoot } from "../capture/handoff-paths.js";

/**
 * Phase 03-05: solid per-machine device identity.
 *
 * Returns this machine's stable UUID. On first call, generates and
 * persists to `~/.synapse/device.json`. Subsequent calls return the
 * persisted value. The UUID survives hostname renames, user account
 * switches, and laptop transfers (as long as `~/.synapse/` persists).
 *
 * The backend matches on (user_id, machine_id) at /auth/cli-session so
 * re-running `synapsesync wizard` from the same machine ROTATES the
 * existing api_keys row instead of creating a new one — preventing
 * accidental cap consumption.
 *
 * If `~/.synapse/device.json` is deleted (user reset their install),
 * a new UUID is generated. To the backend this appears as a new
 * device and consumes a fresh slot on the cap. That's correct
 * semantically (it really is a fresh install).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeviceFile {
  machine_id: string;
  created_at: string;
}

export function getOrCreateMachineId(): string {
  const file = path.join(synapseRoot(), "device.json");

  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<DeviceFile>;
      if (data.machine_id && UUID_PATTERN.test(data.machine_id)) {
        return data.machine_id;
      }
    } catch {
      // Fall through to regenerate. Corrupted JSON gets overwritten — old
      // contents are lost, which is fine since this file is purely a
      // cache of a self-generated UUID, not user data.
    }
  }

  const id = crypto.randomUUID();
  fs.mkdirSync(synapseRoot(), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ machine_id: id, created_at: new Date().toISOString() } satisfies DeviceFile, null, 2),
  );
  return id;
}

/**
 * Read-only helper: returns the machine_id if `device.json` exists and
 * looks valid, null otherwise. Used by diagnostics (status, doctor) to
 * detect fresh-install state without side effects.
 */
export function peekMachineId(): string | null {
  const file = path.join(synapseRoot(), "device.json");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Partial<DeviceFile>;
    return data.machine_id && UUID_PATTERN.test(data.machine_id) ? data.machine_id : null;
  } catch {
    return null;
  }
}
