/**
 * The credential scrub moved to @synapse/shared/redact so the daemon's
 * loopback ingest and the backend's direct browser-capture endpoint
 * (POST /api/capture/browser) share ONE implementation — a security scrub
 * must not drift between the two paths.
 *
 * Re-exported here so the daemon ingest-route keeps its local import path.
 */
export { scrubSecretValues } from "@synapse/shared/redact.js";
