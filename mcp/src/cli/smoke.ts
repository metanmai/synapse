/**
 * `synapsesync doctor --smoke` — post-install verification.
 *
 * Why this exists: `synapsesync wizard` and `synapsesync init` write config
 * files and install hooks, then exit. The user has NO IDEA if any of it
 * works until their next Claude Code session starts and either delivers a
 * brief or doesn't. If hooks are wrong, the daemon is misregistered, the
 * API key is bad, or the network is filtered, the install silently fails
 * and the user assumes Synapse is broken.
 *
 * The smoke test is a 5-stage end-to-end check that verifies the install
 * is wired correctly against the live backend:
 *
 *   1. Hooks installed     — ~/.claude/settings.json has all 6 synapse hook
 *                            commands (SessionStart, UserPromptSubmit,
 *                            PostToolUse, PreCompact, SessionEnd,
 *                            SubagentStop).
 *   2. API key valid       — GET /api/account/me returns 200 with user_id.
 *   3. Event POST works    — POST /api/events/batch with a synthetic
 *                            session_opened event using a unique
 *                            git_remote_url. Backend auto-creates a project
 *                            and returns its canonical UUID.
 *   4. Brief readable      — GET /api/projects/<id>/brief responds (any
 *                            content — the test asserts the *endpoint*
 *                            works, not that the brief is populated).
 *   5. Self-cleanup        — DELETE the synthetic project + remove the
 *                            daemon's local state for it. Uses the same
 *                            removeLocalProjectsByBasename helper the E2E
 *                            suite uses for the daemon-outlives-test race.
 *
 * Honors the "tests are self-contained" rule from the E2E protocol: the
 * smoke leaves zero artifacts on the user's account, regardless of which
 * stage failed. If 5 fails (cleanup error), it's logged but the smoke's
 * pass/fail is determined by stages 1-4.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_URL } from "./config.js";

const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PreCompact", "SessionEnd", "SubagentStop"];
const HOOK_SUBCOMMANDS = [
  "session-start",
  "user-prompt-submit",
  "post-tool-use",
  "pre-compact",
  "session-end",
  "subagent-stop",
];

export interface SmokeStep {
  step: number;
  name: string;
  ok: boolean;
  detail: string;
  elapsedMs?: number;
}

export interface SmokeResult {
  ok: boolean;
  steps: SmokeStep[];
}

// Crockford base32 ULID — matches mcp/src/capture/events-log.ts shape so any
// backend-side validation (length/charset) is consistent with real events.
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    timeStr = BASE32[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(10);
  let randStr = "";
  for (let i = 0; i < 16; i++) randStr += BASE32[rand[i % 10] % 32];
  return timeStr + randStr;
}

function readApiKey(): string | null {
  const root = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  const configPath = path.join(root, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { api_key?: string };
      if (c.api_key) return c.api_key;
    } catch {
      // fall through to env
    }
  }
  return process.env.SYNAPSE_API_KEY ?? null;
}

interface SettingsShape {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
}

/**
 * STEP 1 — verify each of the 6 synapse hook subcommands has an entry in
 * ~/.claude/settings.json under the matching event key. Doesn't care which
 * binary path is used (could be `synapse` or an absolute path to dist/index.js
 * during dev) — only that the `hook <kind>` suffix is present.
 */
function checkHooksInstalled(): SmokeStep {
  const start = Date.now();
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return {
      step: 1,
      name: "Hooks installed",
      ok: false,
      detail: `${settingsPath} does not exist — run \`synapsesync init\` to install hooks`,
      elapsedMs: Date.now() - start,
    };
  }
  let settings: SettingsShape;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as SettingsShape;
  } catch (e) {
    return {
      step: 1,
      name: "Hooks installed",
      ok: false,
      detail: `${settingsPath} is not valid JSON: ${(e as Error).message}`,
      elapsedMs: Date.now() - start,
    };
  }
  const hooks = settings.hooks ?? {};
  const missing: string[] = [];
  for (let i = 0; i < HOOK_EVENTS.length; i++) {
    const event = HOOK_EVENTS[i];
    const subcommand = HOOK_SUBCOMMANDS[i];
    const blocks = hooks[event] ?? [];
    const hasMatch = blocks.some((block) =>
      (block.hooks ?? []).some((h) => (h.command ?? "").includes(` hook ${subcommand}`)),
    );
    if (!hasMatch) missing.push(`${event} (hook ${subcommand})`);
  }
  if (missing.length > 0) {
    return {
      step: 1,
      name: "Hooks installed",
      ok: false,
      detail: `missing ${missing.length} of 6: ${missing.join(", ")} — re-run \`synapsesync init\``,
      elapsedMs: Date.now() - start,
    };
  }
  return {
    step: 1,
    name: "Hooks installed",
    ok: true,
    detail: "all 6 synapse hook entries present in ~/.claude/settings.json",
    elapsedMs: Date.now() - start,
  };
}

/**
 * STEP 2 — GET /api/account/me. Distinguishes "key invalid" (401) from
 * "network/backend issue" (timeout, 5xx, etc.) so the user gets actionable
 * advice rather than just "smoke failed".
 */
async function checkApiKeyValid(apiKey: string, apiUrl: string): Promise<SmokeStep> {
  const start = Date.now();
  try {
    const res = await fetch(`${apiUrl}/api/account/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { id?: string; email?: string };
      return {
        step: 2,
        name: "API key valid",
        ok: true,
        detail: `signed in as ${body.email ?? body.id ?? "(unknown)"}`,
        elapsedMs: Date.now() - start,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        step: 2,
        name: "API key valid",
        ok: false,
        detail: `backend rejected key (HTTP ${res.status}) — get a new key from synapsesync.app/account`,
        elapsedMs: Date.now() - start,
      };
    }
    return {
      step: 2,
      name: "API key valid",
      ok: false,
      detail: `backend HTTP ${res.status} — likely temporary; retry in a few seconds`,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    return {
      step: 2,
      name: "API key valid",
      ok: false,
      detail: `network error: ${(e as Error).message}`,
      elapsedMs: Date.now() - start,
    };
  }
}

/**
 * STEP 3 — POST a synthetic session_opened event to /api/events/batch with
 * a unique git_remote_url so backend auto-creates a fresh project. Returns
 * the canonical project UUID for cleanup. Uses a recognizable basename
 * (`synapsesync-smoke-<RUN_ID>`) so removeLocalProjectsByBasename can sweep
 * the daemon's local state safely.
 */
async function postSyntheticEvent(
  apiKey: string,
  apiUrl: string,
  runId: number,
): Promise<{ step: SmokeStep; projectId: string | null; basename: string }> {
  const start = Date.now();
  const basename = `synapsesync-smoke-${runId}`;
  // cwd_<12 hex> placeholder format — backend treats this as "auto-create
  // project from payload's git_basename/git_remote_url".
  const placeholderId = `cwd_${randomBytes(6).toString("hex")}`;
  const event = {
    event_id: ulid(),
    project_id: placeholderId,
    session_id: `smoke-${runId}`,
    actor: { kind: "human", device_id: "smoke-test" },
    kind: "session_opened",
    occurred_at: new Date().toISOString(),
    payload: {
      hostname: os.hostname(),
      git_basename: basename,
      git_remote_url: `https://smoke.invalid/${runId}.git`,
    },
  };

  try {
    const res = await fetch(`${apiUrl}/api/events/batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events: [event] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        step: {
          step: 3,
          name: "Event roundtrip",
          ok: false,
          detail: `POST /api/events/batch returned HTTP ${res.status}`,
          elapsedMs: Date.now() - start,
        },
        projectId: null,
        basename,
      };
    }
    const body = (await res.json()) as {
      accepted?: number;
      canonical_project_ids?: Record<string, string>;
    };
    // We sent exactly one event with one placeholder, so at most one canonical
    // mapping should come back. Take the first value rather than looking up by
    // placeholderId — same outcome for the success case, more robust if the
    // backend ever returns the canonical_project_ids under a different key
    // shape (e.g. event_id instead of project_id).
    const mappings = Object.values(body.canonical_project_ids ?? {});
    const projectId = mappings[0] ?? null;
    if (!projectId) {
      return {
        step: {
          step: 3,
          name: "Event roundtrip",
          ok: false,
          detail: "backend accepted event but did not auto-create a project (canonical_project_ids missing)",
          elapsedMs: Date.now() - start,
        },
        projectId: null,
        basename,
      };
    }
    return {
      step: {
        step: 3,
        name: "Event roundtrip",
        ok: true,
        detail: `synthetic event accepted; project ${projectId.slice(0, 8)}… auto-created`,
        elapsedMs: Date.now() - start,
      },
      projectId,
      basename,
    };
  } catch (e) {
    return {
      step: {
        step: 3,
        name: "Event roundtrip",
        ok: false,
        detail: `network error: ${(e as Error).message}`,
        elapsedMs: Date.now() - start,
      },
      projectId: null,
      basename,
    };
  }
}

/**
 * STEP 4 — GET /api/projects and confirm the smoke project we just created
 * appears in the list. This exercises the read path the web dashboard uses
 * and the same path `synapsesync purge-empty` relies on. There's no
 * public `/brief` endpoint — briefs are composed client-side from
 * locally-cached state — so reading the project from the list is the
 * closest backend round-trip we can do.
 */
async function checkProjectListed(apiKey: string, apiUrl: string, projectId: string): Promise<SmokeStep> {
  const start = Date.now();
  try {
    const res = await fetch(`${apiUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        step: 4,
        name: "Project list readable",
        ok: false,
        detail: `GET /api/projects returned HTTP ${res.status}`,
        elapsedMs: Date.now() - start,
      };
    }
    const projects = (await res.json()) as Array<{ id?: string; name?: string }>;
    const found = projects.find((p) => p.id === projectId);
    if (!found) {
      return {
        step: 4,
        name: "Project list readable",
        ok: false,
        detail: `event POST succeeded but project ${projectId.slice(0, 8)}… absent from /api/projects (recompute may be lagging)`,
        elapsedMs: Date.now() - start,
      };
    }
    return {
      step: 4,
      name: "Project list readable",
      ok: true,
      detail: `smoke project ${projectId.slice(0, 8)}… listed by backend`,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    return {
      step: 4,
      name: "Project list readable",
      ok: false,
      detail: `network error: ${(e as Error).message}`,
      elapsedMs: Date.now() - start,
    };
  }
}

/**
 * STEP 5 — clean up the smoke project (force-delete) AND remove any
 * `~/.synapse/projects/cwd_<hash>/` placeholder dir whose events.jsonl
 * references the smoke basename. Without this, the daemon would retry the
 * placeholder's events, backend would auto-recreate the project, and the
 * smoke would leak. Same race we fixed in the E2E suite.
 */
async function cleanupSmoke(
  apiKey: string,
  apiUrl: string,
  projectId: string | null,
  basename: string,
): Promise<SmokeStep> {
  const start = Date.now();
  const issues: string[] = [];

  // Backend delete
  if (projectId) {
    try {
      const res = await fetch(`${apiUrl}/api/projects/${projectId}?force=true`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) issues.push(`backend DELETE HTTP ${res.status}`);
    } catch (e) {
      issues.push(`backend DELETE errored: ${(e as Error).message}`);
    }
    // Remove canonical local state too
    const synapseHome = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
    const canonicalDir = path.join(synapseHome, "projects", projectId);
    if (fs.existsSync(canonicalDir)) {
      try {
        fs.rmSync(canonicalDir, { recursive: true, force: true });
      } catch (e) {
        issues.push(`rm canonical state errored: ${(e as Error).message}`);
      }
    }
  }

  // Remove placeholder local dirs whose events.jsonl mentions our basename.
  // This is the daemon-outlives-test race fix from the E2E suite (commit
  // f96aa07). Without it, daemon would retry the smoke's placeholder and
  // backend would auto-recreate the project.
  const synapseHome = process.env.SYNAPSE_HOME ?? path.join(os.homedir(), ".synapse");
  const projectsDir = path.join(synapseHome, "projects");
  if (fs.existsSync(projectsDir)) {
    const needle = `"git_basename":"${basename}`;
    for (const name of fs.readdirSync(projectsDir)) {
      const dir = path.join(projectsDir, name);
      const eventsPath = path.join(dir, "events.jsonl");
      if (!fs.existsSync(eventsPath)) continue;
      try {
        const content = fs.readFileSync(eventsPath, "utf-8");
        if (!content.includes(needle)) continue;
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }

  if (issues.length > 0) {
    return {
      step: 5,
      name: "Self-cleanup",
      ok: false,
      detail: `partial cleanup — ${issues.join("; ")}`,
      elapsedMs: Date.now() - start,
    };
  }
  return {
    step: 5,
    name: "Self-cleanup",
    ok: true,
    detail: "smoke project + local state removed",
    elapsedMs: Date.now() - start,
  };
}

/**
 * Run all 5 smoke stages and return a structured result. The shape is JSON
 * so callers (wizard, CI) can render it however they want. Non-throwing:
 * any unexpected error becomes a failed step rather than an exception.
 *
 * The overall `ok` is the AND of stages 1-4. Stage 5 (cleanup) is logged
 * but doesn't affect pass/fail — a smoke that succeeded but failed to
 * clean up is still a successful verification of the install.
 */
export async function runSmoke({ apiUrl = API_URL }: { apiUrl?: string } = {}): Promise<SmokeResult> {
  const steps: SmokeStep[] = [];

  // Step 1: hooks
  const hooksStep = checkHooksInstalled();
  steps.push(hooksStep);

  // Step 2: API key (need this for everything downstream)
  const apiKey = readApiKey();
  if (!apiKey) {
    steps.push({
      step: 2,
      name: "API key valid",
      ok: false,
      detail: "no API key configured — run `synapsesync init` or set SYNAPSE_API_KEY",
    });
    return { ok: false, steps };
  }
  const keyStep = await checkApiKeyValid(apiKey, apiUrl);
  steps.push(keyStep);
  if (!keyStep.ok) return { ok: false, steps };

  // Step 3: event roundtrip (auto-creates project)
  const runId = Date.now();
  const eventResult = await postSyntheticEvent(apiKey, apiUrl, runId);
  steps.push(eventResult.step);
  if (!eventResult.step.ok || !eventResult.projectId) {
    // Still try to clean up — the daemon may have written local state even
    // if backend rejected.
    await cleanupSmoke(apiKey, apiUrl, eventResult.projectId, eventResult.basename);
    return { ok: false, steps };
  }

  // Step 4: project appears in /api/projects (the read path the dashboard
  // and `synapsesync purge-empty` both rely on)
  const briefStep = await checkProjectListed(apiKey, apiUrl, eventResult.projectId);
  steps.push(briefStep);

  // Step 5: cleanup (always runs, even if step 4 failed)
  const cleanupStep = await cleanupSmoke(apiKey, apiUrl, eventResult.projectId, eventResult.basename);
  steps.push(cleanupStep);

  // Overall ok = stages 1-4. Cleanup failures are reported but don't fail
  // the install verification.
  const ok = hooksStep.ok && keyStep.ok && eventResult.step.ok && briefStep.ok;
  return { ok, steps };
}

/**
 * Format a smoke result as a human-readable string for `doctor --smoke`
 * stdout. Used by both the CLI handler and the wizard's end-of-flow
 * verification step.
 */
export function formatSmokeResult(result: SmokeResult): string {
  const lines: string[] = [""];
  lines.push("Install smoke test:");
  for (const s of result.steps) {
    const icon = s.ok ? "✓" : "✗";
    const elapsed = s.elapsedMs != null ? ` (${s.elapsedMs}ms)` : "";
    lines.push(`  ${icon} ${s.step}. ${s.name}${elapsed}: ${s.detail}`);
  }
  lines.push("");
  lines.push(
    result.ok ? "✓ Install verified — Synapse is ready to use." : "✗ Install has issues — see failed steps above.",
  );
  return lines.join("\n");
}
