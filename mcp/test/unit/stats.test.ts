import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../src/cli/editors/index.js", () => ({
  detectExistingSetup: vi.fn(),
}));
vi.mock("../../src/cli/api.js", () => ({
  validateApiKey: vi.fn(),
}));
vi.mock("../../src/cli/spinner.js", () => ({
  createGlyphSpinner: () => ({ start: vi.fn(), stop: vi.fn(), update: vi.fn() }),
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  log: { message: vi.fn(), error: vi.fn() },
  outro: vi.fn(),
}));
vi.mock("../../src/cli/theme.js", () => ({
  accent: (s: string) => s,
  bold: (s: string) => s,
  muted: (s: string) => s,
  success: (s: string) => s,
  error: (s: string) => s,
}));

import * as clack from "@clack/prompts";
import { validateApiKey } from "../../src/cli/api.js";
import { detectExistingSetup } from "../../src/cli/editors/index.js";
import { runStats } from "../../src/cli/stats.js";

// --- Helper to build Response-like objects ---
function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: () => jsonResponse(status, body, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

const mockFetch = vi.fn();
const mockDetect = detectExistingSetup as ReturnType<typeof vi.fn>;
const mockValidate = validateApiKey as ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  mockDetect.mockReset();
  mockValidate.mockReset();
});

// =============================================================================
// No API key found
// =============================================================================
describe("runStats() — no API key found", () => {
  it("calls process.exit(1) when no API keys are configured", async () => {
    mockDetect.mockReturnValue({ apiKeys: [], configured: false, locations: [] });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runStats()).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(clack.log.error).toHaveBeenCalled();
  });
});

// =============================================================================
// All keys expired
// =============================================================================
describe("runStats() — all keys expired", () => {
  it("calls process.exit(1) when all API keys are expired", async () => {
    mockDetect.mockReturnValue({
      apiKeys: ["sk_expired1", "sk_expired2"],
      configured: true,
      locations: [".mcp.json"],
    });
    mockValidate.mockResolvedValue({ status: "expired" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runStats()).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockValidate).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================
// Successful stats fetch
// =============================================================================
describe("runStats() — successful stats fetch", () => {
  const VALID_KEY = "sk_valid_key";
  const PROJECT = {
    id: "proj_123",
    name: "my-workspace",
    created_at: "2025-01-01T00:00:00Z",
    role: "owner",
  };
  const ENTRIES = [
    { path: "notes/meeting.md", updated_at: "2025-06-01T00:00:00Z", tags: ["note"] },
    { path: "decisions/auth.md", updated_at: "2025-07-15T00:00:00Z", tags: ["decision", "note"] },
  ];
  const ACTIVITY = [
    { action: "entry_created", source: "mcp", target_path: "notes/meeting.md", created_at: "2025-06-01T00:00:00Z" },
    { action: "entry_updated", source: "web", target_path: "decisions/auth.md", created_at: "2025-07-15T00:00:00Z" },
  ];

  function setupSuccessfulRun() {
    mockDetect.mockReturnValue({
      apiKeys: [VALID_KEY],
      configured: true,
      locations: [".mcp.json"],
    });
    mockValidate.mockResolvedValue({ status: "valid" });

    // Mock fetch for: projects, entries list, activity
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [PROJECT]))
      .mockResolvedValueOnce(jsonResponse(200, ENTRIES))
      .mockResolvedValueOnce(jsonResponse(200, ACTIVITY));
  }

  it("fetches projects, entries, and activity when key is valid", async () => {
    setupSuccessfulRun();

    await runStats();

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("fetches /api/projects with correct URL", async () => {
    setupSuccessfulRun();

    await runStats();

    const [projectsUrl] = mockFetch.mock.calls[0];
    expect(projectsUrl).toBe("https://api.synapsesync.app/api/projects");
  });

  it("fetches entries list with correct URL", async () => {
    setupSuccessfulRun();

    await runStats();

    const [entriesUrl] = mockFetch.mock.calls[1];
    expect(entriesUrl).toBe("https://api.synapsesync.app/api/context/my-workspace/list");
  });

  it("fetches activity with correct URL including ?limit=500", async () => {
    setupSuccessfulRun();

    await runStats();

    const [activityUrl] = mockFetch.mock.calls[2];
    expect(activityUrl).toBe("https://api.synapsesync.app/api/projects/proj_123/activity?limit=500");
  });

  it("calls clack.log.message to display stats", async () => {
    setupSuccessfulRun();

    await runStats();

    expect(clack.log.message).toHaveBeenCalled();
  });

  it("calls clack.outro on completion", async () => {
    setupSuccessfulRun();

    await runStats();

    expect(clack.outro).toHaveBeenCalled();
  });
});

// =============================================================================
// API fetch structure
// =============================================================================
describe("runStats() — API fetch structure", () => {
  const VALID_KEY = "sk_structure_test";

  function setupFetchStructureRun() {
    mockDetect.mockReturnValue({
      apiKeys: [VALID_KEY],
      configured: true,
      locations: [".mcp.json"],
    });
    mockValidate.mockResolvedValue({ status: "valid" });

    const project = { id: "proj_456", name: "test-ws", created_at: "2025-01-01T00:00:00Z", role: "owner" };
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, [project]))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, []));
  }

  it("includes Authorization header with Bearer token on /api/projects fetch", async () => {
    setupFetchStructureRun();

    await runStats();

    const [, projectsOpts] = mockFetch.mock.calls[0];
    expect(projectsOpts.headers.Authorization).toBe(`Bearer ${VALID_KEY}`);
  });

  it("includes Authorization header on entries fetch", async () => {
    setupFetchStructureRun();

    await runStats();

    const [, entriesOpts] = mockFetch.mock.calls[1];
    expect(entriesOpts.headers.Authorization).toBe(`Bearer ${VALID_KEY}`);
  });

  it("includes Authorization header on activity fetch", async () => {
    setupFetchStructureRun();

    await runStats();

    const [, activityOpts] = mockFetch.mock.calls[2];
    expect(activityOpts.headers.Authorization).toBe(`Bearer ${VALID_KEY}`);
  });

  it("activity fetch URL includes ?limit=500", async () => {
    setupFetchStructureRun();

    await runStats();

    const [activityUrl] = mockFetch.mock.calls[2];
    expect(activityUrl).toContain("?limit=500");
  });
});
