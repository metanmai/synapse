import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to control the API_URL import. The alias in vitest.config.ts maps
// $env/static/private to our mock that exports API_URL = "http://localhost:8787".
import { ApiError, createApi } from "./api";

// ---------- fetch mock ----------
function mockFetchOk(body: unknown = {}, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Error",
    json: () => Promise.resolve(body),
  });
}

function mockFetchNetworkError(message = "fetch failed") {
  return vi.fn().mockRejectedValue(new Error(message));
}

beforeEach(() => {
  // Suppress console.log from the api module
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createApi", () => {
  it("returns an object with all expected methods", () => {
    const api = createApi("token");
    const expectedMethods = [
      "listProjects",
      "createProject",
      "addMember",
      "removeMember",
      "createShareLink",
      "listShareLinks",
      "deleteShareLink",
      "joinShareLink",
      "listEntries",
      "getEntry",
      "saveEntry",
      "searchEntries",
      "getEntryHistory",
      "restoreEntry",
      "getActivity",
      "listApiKeys",
      "createApiKey",
      "revokeApiKey",
      "setPreference",
      "getBillingStatus",
      "createCheckout",
      "createPortalSession",
      "verifyCheckout",
      "importProject",
      "listInsights",
      "createInsight",
      "updateInsight",
      "deleteInsight",
      "listConversations",
      "getConversation",
      "createConversation",
      "updateConversation",
      "importConversation",
      "exportConversation",
      "getMediaUrl",
    ];
    for (const method of expectedMethods) {
      expect(typeof (api as Record<string, unknown>)[method]).toBe("function");
    }
  });

  it("returns an object with null token", () => {
    const api = createApi(null);
    expect(api).toBeDefined();
    expect(typeof api.listProjects).toBe("function");
  });
});

describe("request (via API methods)", () => {
  it("adds Authorization header when token is provided", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("my-token");
    await api.listProjects();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer my-token");
  });

  it("does not add Authorization header when token is null", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi(null);
    await api.listProjects();

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("always adds Content-Type: application/json header", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi(null);
    await api.listProjects();

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("throws ApiError on non-ok response", async () => {
    const fetchMock = mockFetchError(404, { error: "Not found" });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    try {
      await api.listProjects();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toContain("404");
    }
  });

  it("throws ApiError with detail when response includes it", async () => {
    const fetchMock = mockFetchError(422, {
      error: "Validation failed",
      detail: "name is required",
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    try {
      await api.createProject("test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toContain("name is required");
    }
  });

  it("throws ApiError(503) on network failure", async () => {
    const fetchMock = mockFetchNetworkError("ECONNREFUSED");
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    try {
      await api.listProjects();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(503);
      expect((err as ApiError).message).toContain("Cannot reach API");
      expect((err as ApiError).message).toContain("ECONNREFUSED");
    }
  });

  it("handles non-JSON error response gracefully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("not json")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    try {
      await api.listProjects();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });
});

describe("API method URL construction", () => {
  it("listProjects calls GET /api/projects", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.listProjects();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/api/projects");
    expect(options.method).toBeUndefined(); // defaults to GET
  });

  it("saveEntry calls POST /api/context/save with correct body", async () => {
    const fetchMock = mockFetchOk({ path: "notes/test.md" });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.saveEntry("my-project", "notes/test.md", "# Hello", ["tag1"]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/api/context/save");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      project: "my-project",
      path: "notes/test.md",
      content: "# Hello",
      tags: ["tag1"],
    });
  });

  it("createCheckout calls POST /api/billing/checkout", async () => {
    const fetchMock = mockFetchOk({ url: "https://checkout.stripe.com/session" });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    const result = await api.createCheckout();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/api/billing/checkout");
    expect(options.method).toBe("POST");
    expect(result).toEqual({ url: "https://checkout.stripe.com/session" });
  });

  it("getEntry calls GET with encoded project and path", async () => {
    const fetchMock = mockFetchOk({ content: "data" });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.getEntry("my project", "notes/hello world.md");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/api/context/my%20project/notes%2Fhello%20world.md");
  });

  it("listEntries includes folder query param when provided", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.listEntries("proj", "notes/sub");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("folder=notes%2Fsub");
  });

  it("listEntries omits folder param when not provided", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.listEntries("proj");

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain("folder=");
  });

  it("removeMember calls DELETE with encoded email", async () => {
    const fetchMock = mockFetchOk();
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.removeMember("proj-123", "user@example.com");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/api/projects/proj-123/members/user%40example.com");
    expect(options.method).toBe("DELETE");
  });

  it("searchEntries calls GET with encoded query", async () => {
    const fetchMock = mockFetchOk([]);
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.searchEntries("proj", "hello world");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("q=hello%20world");
  });

  it("createInsight calls POST /api/insights with correct body", async () => {
    const fetchMock = mockFetchOk({ id: "ins-1" });
    vi.stubGlobal("fetch", fetchMock);

    const api = createApi("token");
    await api.createInsight("proj-1", "pattern", "Users prefer dark mode", "Based on 80% usage");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8787/api/insights");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      project_id: "proj-1",
      type: "pattern",
      summary: "Users prefer dark mode",
      detail: "Based on 80% usage",
    });
  });
});

describe("API_URL not configured", () => {
  it("throws ApiError(500) when API_URL is empty", async () => {
    // Mock the env module to return empty API_URL, then dynamically re-import
    vi.doMock("$env/static/private", () => ({ API_URL: "" }));
    // vi.resetModules() clears the module cache so the dynamic import picks up the mock
    vi.resetModules();
    const mod = await import("./api");
    const api = mod.createApi("token");
    try {
      await api.listProjects();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(mod.ApiError);
      expect((err as InstanceType<typeof mod.ApiError>).status).toBe(500);
      expect((err as InstanceType<typeof mod.ApiError>).message).toContain("API_URL is not configured");
    }
    vi.doUnmock("$env/static/private");
  });
});

describe("ApiError", () => {
  it("is an instance of Error", () => {
    const err = new ApiError(404, "Not found");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it("has status and message properties", () => {
    const err = new ApiError(500, "Internal server error");
    expect(err.status).toBe(500);
    expect(err.message).toBe("Internal server error");
  });
});
