#!/usr/bin/env node
// Standalone smoke test for the per-device CLI keys flow.
// Drives browserAuth(), then probes the backend to verify:
//   1. PKCE handshake completes and we receive an api_key
//   2. /api/account/keys lists a `cli-device-<ts>` label (the synthetic
//      backwards-compat label produced when frontend doesn't pass device_name)
//   3. /api/projects + /api/billing/status work with the new key

import os from "node:os";
import { browserAuth } from "../dist/cli/browser-auth.js";
import { API_URL } from "../dist/cli/config.js";

const START = Date.now();
function ms() {
  return `+${((Date.now() - START) / 1000).toFixed(1)}s`;
}
function log(...args) {
  console.log(ms(), ...args);
}
function bail(msg) {
  console.error(`\n[FAIL] ${msg}`);
  process.exit(1);
}

const HOSTNAME = os.hostname();

log("Starting PKCE handshake against", API_URL);
log("Open the URL that appears in 2s if your browser doesn't auto-open.");

let observedUrl = "";
let result;
try {
  result = await browserAuth({
    deviceName: HOSTNAME,
    onUrl: (url, autoOpened) => {
      observedUrl = url;
      log(`Browser ${autoOpened ? "auto-opened" : "URL only"}:`);
      console.log(`    ${url}`);
    },
  });
} catch (err) {
  bail(`browserAuth threw: ${err.message}`);
}

// Verify the auth URL contained the device hint (CLI side of the wiring works
// regardless of whether the deployed frontend reads it yet)
const deviceInUrl = new URL(observedUrl).searchParams.get("device");
if (deviceInUrl !== HOSTNAME) {
  bail(`CLI did not include device=${HOSTNAME} in auth URL — got ${JSON.stringify(deviceInUrl)}`);
}
log(`[OK] CLI passed device=${HOSTNAME} in auth URL`);

log(`[OK] Received api_key=${result.api_key.slice(0, 8)}… email=${result.email}`);

const h = { Authorization: `Bearer ${result.api_key}` };

log("Probing /api/account/keys…");
const keysRes = await fetch(`${API_URL}/api/account/keys`, { headers: h });
if (!keysRes.ok) bail(`/api/account/keys returned ${keysRes.status}`);
const keys = await keysRes.json();
log(`[OK] Account has ${keys.length} key(s):`);
for (const k of keys) {
  console.log(`    • ${k.label}  (created ${k.created_at}, last_used ${k.last_used_at ?? "never"})`);
}

// Sanitize the same way the backend does (sanitizeDeviceName in auth.ts:210):
// lowercase, replace non-[a-z0-9-] with -, collapse dashes, trim, cap at 60.
const expectedLabel = `cli-${HOSTNAME.toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60)}`;
log(`Expecting newly-minted key to be labeled: ${expectedLabel}`);

// Pick the most recently created cli-* key — that's the one this run minted.
const cliKeys = keys
  .filter((k) => k.label.startsWith("cli"))
  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
const newKey = cliKeys[0];
if (!newKey) {
  bail("No cli-* labeled key found at all.");
}
log(`[INFO] Most recent cli-* key: ${newKey.label}  (created ${newKey.created_at})`);

if (newKey.label === expectedLabel) {
  log("[OK] New key label matches sanitized hostname — frontend is forwarding device_name");
} else if (newKey.label.startsWith("cli-device-")) {
  log(`[WARN] New key uses synthetic fallback label (frontend not yet deployed?): ${newKey.label}`);
} else {
  log(`[WARN] New key label (${newKey.label}) is unexpected — neither hostname nor synthetic`);
}

log("Probing /api/projects…");
const projectsRes = await fetch(`${API_URL}/api/projects`, { headers: h });
if (!projectsRes.ok) bail(`/api/projects returned ${projectsRes.status}`);
const projects = await projectsRes.json();
log(`[OK] ${projects.length} project(s) accessible`);

log("Probing /api/billing/status…");
const billingRes = await fetch(`${API_URL}/api/billing/status`, { headers: h });
if (!billingRes.ok) bail(`/api/billing/status returned ${billingRes.status}`);
const billing = await billingRes.json();
log(`[OK] Tier: ${billing.tier}`);

console.log("\n=== SMOKE TEST PASSED ===");
console.log(
  JSON.stringify(
    {
      email: result.email,
      tier: billing.tier,
      total_keys: keys.length,
      cli_device_keys: keys.filter((k) => k.label.startsWith("cli-device-")).map((k) => k.label),
      projects: projects.length,
    },
    null,
    2,
  ),
);
