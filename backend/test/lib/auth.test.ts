import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashApiKey } from "../../src/lib/auth";

// Mock Supabase client
const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  }),
}));

vi.mock("../../src/db/client", () => ({
  createSupabaseClient: () => ({
    from: (table: string) => {
      mockFrom(table);
      return {
        select: (...args: unknown[]) => {
          mockSelect(...args);
          return {
            eq: (...eqArgs: unknown[]) => {
              mockEq(...eqArgs);
              return { single: mockSingle };
            },
          };
        },
      };
    },
  }),
}));

describe("hashApiKey", () => {
  it("produces consistent SHA-256 hex hash", async () => {
    const hash1 = await hashApiKey("test-key-123");
    const hash2 = await hashApiKey("test-key-123");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different keys", async () => {
    const hash1 = await hashApiKey("key-a");
    const hash2 = await hashApiKey("key-b");
    expect(hash1).not.toBe(hash2);
  });
});

describe("authMiddleware", () => {
  let authMiddleware: typeof import("../../src/lib/auth").authMiddleware;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get fresh module with mocks
    const mod = await import("../../src/lib/auth");
    authMiddleware = mod.authMiddleware;
  });

  function createMockContext(authHeader?: string) {
    const vars: Record<string, unknown> = {};
    return {
      req: {
        header: (name: string) => {
          if (name === "Authorization") return authHeader;
          return undefined;
        },
      },
      env: {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_SERVICE_KEY: "test-service-key",
      },
      set: (key: string, value: unknown) => {
        vars[key] = value;
      },
      vars,
    } as any;
  }

  it("rejects request with no Authorization header", async () => {
    const c = createMockContext();
    const next = vi.fn();

    await expect(authMiddleware(c, next)).rejects.toThrow("Invalid or missing API key");
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects request with non-Bearer token", async () => {
    const c = createMockContext("Basic abc123");
    const next = vi.fn();

    await expect(authMiddleware(c, next)).rejects.toThrow("Invalid or missing API key");
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects JWT when Supabase auth fails", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });

    const c = createMockContext("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc123");
    const next = vi.fn();

    await expect(authMiddleware(c, next)).rejects.toThrow("Invalid or missing API key");
  });

  it("rejects JWT when auth user exists but public.users row is missing", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "auth-uuid-123", email: "test@test.com" } },
      error: null,
    });
    // findUserBySupabaseAuthId returns null (no row in public.users)
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });

    const c = createMockContext("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc123");
    const next = vi.fn();

    await expect(authMiddleware(c, next)).rejects.toThrow("Invalid or missing API key");
  });

  it("accepts valid JWT when auth user and public.users row both exist", async () => {
    const mockUser = { id: "user-uuid", email: "test@test.com", supabase_auth_id: "auth-uuid-123" };
    mockGetUser.mockResolvedValue({
      data: { user: { id: "auth-uuid-123", email: "test@test.com" } },
      error: null,
    });
    mockSingle.mockResolvedValue({ data: mockUser, error: null });

    const c = createMockContext("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc123");
    const next = vi.fn();

    await authMiddleware(c, next);

    expect(next).toHaveBeenCalled();
    expect(c.vars.user).toEqual(mockUser);
  });

  it("accepts valid API key", async () => {
    const mockUser = { id: "user-uuid", email: "test@test.com", api_key_hash: "abc" };
    // Not a JWT, so skip JWT path
    // findUserByApiKeyHash returns user
    mockSingle.mockResolvedValue({ data: mockUser, error: null });

    const c = createMockContext("Bearer simple-api-key");
    const next = vi.fn();

    await authMiddleware(c, next);

    expect(next).toHaveBeenCalled();
    expect(c.vars.user).toEqual(mockUser);
  });

  it("rejects invalid API key", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: "PGRST116" } });

    const c = createMockContext("Bearer bad-api-key");
    const next = vi.fn();

    await expect(authMiddleware(c, next)).rejects.toThrow("Invalid or missing API key");
  });
});
