import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SmokeResult, formatSmokeResult, runSmoke } from "../../src/cli/smoke.js";

// Minimal Response-like for fetch mocking. We don't need to test fetch
// itself; we need to test our state machine around it.
function resp(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

const mockFetch = vi.fn();
let originalHome: string | undefined;
let originalSynapseHome: string | undefined;
let originalSynapseKey: string | undefined;
let tmpHome: string;
let tmpSynapse: string;

// Each test gets a fully isolated HOME so checkHooksInstalled reads what
// we wrote, not the developer's real ~/.claude/settings.json. We also set
// SYNAPSE_HOME so readApiKey() and cleanup don't touch the real daemon dir.
beforeEach(() => {
  globalThis.fetch = mockFetch;
  originalHome = process.env.HOME;
  originalSynapseHome = process.env.SYNAPSE_HOME;
  originalSynapseKey = process.env.SYNAPSE_API_KEY;
  tmpHome = mkdtempSync(path.join(tmpdir(), "smoke-test-home-"));
  tmpSynapse = mkdtempSync(path.join(tmpdir(), "smoke-test-synapse-"));
  process.env.HOME = tmpHome;
  process.env.SYNAPSE_HOME = tmpSynapse;
  // Default: API key present so we get past step 2 in most scenarios.
  // Individual tests can override by deleting the env var.
  process.env.SYNAPSE_API_KEY = "test-key";
});

afterEach(() => {
  process.env.HOME = originalHome;
  // biome-ignore lint/performance/noDelete: test teardown — restoring undefined env, perf negligible
  if (originalSynapseHome === undefined) delete process.env.SYNAPSE_HOME;
  else process.env.SYNAPSE_HOME = originalSynapseHome;
  // biome-ignore lint/performance/noDelete: test teardown — restoring undefined env, perf negligible
  if (originalSynapseKey === undefined) delete process.env.SYNAPSE_API_KEY;
  else {
    process.env.SYNAPSE_API_KEY = originalSynapseKey;
  }
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpSynapse, { recursive: true, force: true });
  mockFetch.mockReset();
  vi.restoreAllMocks();
});

function writeSettings(hooks: Record<string, unknown>): void {
  mkdirSync(path.join(tmpHome, ".claude"), { recursive: true });
  writeFileSync(path.join(tmpHome, ".claude", "settings.json"), JSON.stringify({ hooks }, null, 2));
}

const ALL_SIX_HOOKS = {
  SessionStart: [{ hooks: [{ type: "command", command: "synapse hook session-start" }] }],
  UserPromptSubmit: [{ hooks: [{ type: "command", command: "synapse hook user-prompt-submit" }] }],
  PostToolUse: [{ hooks: [{ type: "command", command: "synapse hook post-tool-use" }] }],
  PreCompact: [{ hooks: [{ type: "command", command: "synapse hook pre-compact" }] }],
  SessionEnd: [{ hooks: [{ type: "command", command: "synapse hook session-end" }] }],
  SubagentStop: [{ hooks: [{ type: "command", command: "synapse hook subagent-stop" }] }],
};

// ── Step 1: hooks installation check ─────────────────────────────────────
// The bug class this guards: a hook entry gets silently dropped (typo, partial
// install, manual edit) and the user doesn't notice until their next session
// has no brief. The check must catch a *missing subset* of hooks, not just
// "settings.json doesn't exist".
describe("smoke step 1 — hooks check", () => {
  it("FAIL when ~/.claude/settings.json is absent", async () => {
    // tmpHome has no .claude/settings.json
    mockFetch.mockResolvedValue(resp(200, { id: "u" }));
    const result = await runSmoke();
    const step1 = result.steps[0];
    expect(step1.step).toBe(1);
    expect(step1.ok).toBe(false);
    expect(step1.detail).toContain("does not exist");
  });

  it("FAIL when settings.json is malformed JSON", async () => {
    mkdirSync(path.join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(path.join(tmpHome, ".claude", "settings.json"), "{ this is not json");
    mockFetch.mockResolvedValue(resp(200, { id: "u" }));
    const result = await runSmoke();
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].detail).toContain("not valid JSON");
  });

  it("FAIL when one of the six hooks is missing", async () => {
    const incomplete = { ...ALL_SIX_HOOKS };
    // biome-ignore lint/performance/noDelete: test fixture reshape, not a perf path
    delete (incomplete as Record<string, unknown>).PreCompact;
    writeSettings(incomplete);
    mockFetch.mockResolvedValue(resp(200, { id: "u" }));
    const result = await runSmoke();
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].detail).toContain("PreCompact");
    expect(result.steps[0].detail).toContain("pre-compact");
  });

  it("PASS when all six hook entries are present (with absolute-path bin)", async () => {
    // Real installs use an absolute path like /usr/local/bin/synapsesync —
    // the check matches on `hook <subcommand>` suffix regardless of bin path.
    const absHooks = {
      SessionStart: [{ hooks: [{ type: "command", command: "/opt/homebrew/bin/synapsesync hook session-start" }] }],
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "/opt/homebrew/bin/synapsesync hook user-prompt-submit" }] },
      ],
      PostToolUse: [{ hooks: [{ type: "command", command: "/opt/homebrew/bin/synapsesync hook post-tool-use" }] }],
      PreCompact: [{ hooks: [{ type: "command", command: "/opt/homebrew/bin/synapsesync hook pre-compact" }] }],
      SessionEnd: [{ hooks: [{ type: "command", command: "/opt/homebrew/bin/synapsesync hook session-end" }] }],
      SubagentStop: [{ hooks: [{ type: "command", command: "/opt/homebrew/bin/synapsesync hook subagent-stop" }] }],
    };
    writeSettings(absHooks);
    // Mock the API calls so we get to step 1's verdict
    mockFetch.mockResolvedValueOnce(resp(200, { id: "u", email: "test@example.com" }));
    mockFetch.mockResolvedValueOnce(resp(200, { accepted: 1, canonical_project_ids: { cwd_x: "proj-uuid" } }));
    mockFetch.mockResolvedValueOnce(resp(200, [{ id: "proj-uuid", name: "synapsesync-smoke-..." }]));
    mockFetch.mockResolvedValue(resp(200, {})); // cleanup DELETE
    const result = await runSmoke();
    expect(result.steps[0].ok).toBe(true);
    expect(result.steps[0].detail).toContain("all 6");
  });
});

// ── Step 2: API key validation ──────────────────────────────────────────
describe("smoke step 2 — API key check", () => {
  beforeEach(() => writeSettings(ALL_SIX_HOOKS));

  it("FAIL with actionable detail when no API key is configured at all", async () => {
    // biome-ignore lint/performance/noDelete: test setup — clearing env, perf irrelevant
    delete process.env.SYNAPSE_API_KEY;
    const result = await runSmoke();
    // Hooks pass, but API key step short-circuits the rest
    expect(result.ok).toBe(false);
    const step2 = result.steps.find((s) => s.step === 2);
    expect(step2?.detail).toContain("no API key");
  });

  it("FAIL with 'rejected' message on 401, distinct from transient errors", async () => {
    mockFetch.mockResolvedValueOnce(resp(401));
    const result = await runSmoke();
    expect(result.ok).toBe(false);
    const step2 = result.steps.find((s) => s.step === 2);
    expect(step2?.ok).toBe(false);
    expect(step2?.detail).toContain("rejected");
  });

  it("FAIL on 5xx with a 'temporary' hint, not 'rejected'", async () => {
    mockFetch.mockResolvedValueOnce(resp(503));
    const result = await runSmoke();
    const step2 = result.steps.find((s) => s.step === 2);
    expect(step2?.ok).toBe(false);
    expect(step2?.detail).toContain("temporary");
    expect(step2?.detail).not.toContain("rejected");
  });

  it("short-circuits subsequent steps when step 2 fails", async () => {
    mockFetch.mockResolvedValueOnce(resp(401));
    const result = await runSmoke();
    // Only steps 1 and 2 should be present; no event POST attempted
    expect(result.steps.filter((s) => s.step === 3)).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ── Step 3 + overall ok flag ────────────────────────────────────────────
describe("smoke step 3 — event roundtrip + overall verdict", () => {
  beforeEach(() => writeSettings(ALL_SIX_HOOKS));

  it("FAIL when backend accepts the event but returns no canonical_project_ids", async () => {
    mockFetch
      .mockResolvedValueOnce(resp(200, { id: "u" })) // step 2
      .mockResolvedValueOnce(resp(200, { accepted: 1 })); // step 3 — no mapping
    const result = await runSmoke();
    expect(result.ok).toBe(false);
    const step3 = result.steps.find((s) => s.step === 3);
    expect(step3?.ok).toBe(false);
    expect(step3?.detail).toContain("did not auto-create");
  });

  it("overall ok=true requires steps 1-4 all pass; step 5 cleanup failure is reported but not gating", async () => {
    mockFetch
      .mockResolvedValueOnce(resp(200, { id: "u" })) // step 2
      .mockResolvedValueOnce(resp(200, { canonical_project_ids: { cwd_x: "proj-uuid" } })) // step 3
      .mockResolvedValueOnce(resp(200, [{ id: "proj-uuid", name: "synapsesync-smoke-..." }])) // step 4
      .mockResolvedValueOnce(resp(500)); // step 5 cleanup DELETE fails
    const result = await runSmoke();
    expect(result.ok).toBe(true); // 1-4 all green
    const step5 = result.steps.find((s) => s.step === 5);
    expect(step5?.ok).toBe(false);
    expect(step5?.detail).toContain("partial cleanup");
  });
});

// ── formatSmokeResult — human-readable output shape ──────────────────────
describe("formatSmokeResult", () => {
  it("renders one line per step with ✓/✗ icon and ends with overall verdict", () => {
    const result: SmokeResult = {
      ok: false,
      steps: [
        { step: 1, name: "Hooks installed", ok: true, detail: "all 6 present" },
        { step: 2, name: "API key valid", ok: false, detail: "401 rejected" },
      ],
    };
    const text = formatSmokeResult(result);
    expect(text).toContain("✓ 1. Hooks installed");
    expect(text).toContain("✗ 2. API key valid");
    expect(text).toContain("Install has issues");
  });

  it("uses passing verdict line when ok=true", () => {
    const text = formatSmokeResult({ ok: true, steps: [] });
    expect(text).toContain("Install verified");
    expect(text).not.toContain("Install has issues");
  });
});
