-- 025_api_keys_machine_id.sql
-- Solid per-machine device identity for the device cap (Phase 03-05).
--
-- Adds api_keys.machine_id (NULL for legacy rows). New CLI installs
-- generate a UUID at first `synapsesync wizard` and persist it at
-- ~/.synapse/device.json, then include it on cli-session registration.
-- Re-init from the same machine matches on (user_id, machine_id) via
-- the partial unique index and returns the existing api key instead
-- of creating a duplicate row that would push the user toward their
-- device cap (3 free / 10 plus).
--
-- The index is partial (WHERE machine_id IS NOT NULL) so legacy rows
-- with NULL machine_id don't conflict with each other or block the
-- migration. They count as one device each but can't be matched on
-- re-init — the user has to use the web /cli-auth picker to free a
-- slot if they're at cap.
--
-- Migration is purely additive + idempotent (IF NOT EXISTS on both the
-- column and the index).

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS machine_id text DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_user_machine
  ON api_keys(user_id, machine_id)
  WHERE machine_id IS NOT NULL;
