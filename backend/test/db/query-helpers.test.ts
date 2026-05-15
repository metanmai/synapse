import { describe, expect, it } from "vitest";
import { singleOrNull } from "../../src/db/query-helpers";

function mockError(code: string, message: string) {
  return { name: "PostgrestError", code, message, details: "", hint: "", toJSON: () => ({}) };
}

describe("singleOrNull", () => {
  it("returns data when query succeeds", () => {
    const result = singleOrNull({
      data: { id: "123", email: "test@test.com" },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
      success: true,
    } as Parameters<typeof singleOrNull>[0]);
    expect(result).toEqual({ id: "123", email: "test@test.com" });
  });

  it("returns null when no rows found (PGRST116)", () => {
    const result = singleOrNull({
      data: null,
      error: mockError("PGRST116", "No rows found"),
      count: null,
      status: 406,
      statusText: "Not Acceptable",
    } as Parameters<typeof singleOrNull>[0]);
    expect(result).toBeNull();
  });

  it("throws on database errors (not PGRST116)", () => {
    expect(() =>
      singleOrNull({
        data: null,
        error: mockError("42P01", 'relation "users" does not exist'),
        count: null,
        status: 400,
        statusText: "Bad Request",
      } as Parameters<typeof singleOrNull>[0]),
    ).toThrow('relation "users" does not exist');
  });

  it("throws on permission errors", () => {
    expect(() =>
      singleOrNull({
        data: null,
        error: mockError("42501", "permission denied for table users"),
        count: null,
        status: 403,
        statusText: "Forbidden",
      } as Parameters<typeof singleOrNull>[0]),
    ).toThrow("permission denied for table users");
  });

  it("throws on connection errors", () => {
    expect(() =>
      singleOrNull({
        data: null,
        error: mockError("08001", "could not connect to server"),
        count: null,
        status: 500,
        statusText: "Internal Server Error",
      } as Parameters<typeof singleOrNull>[0]),
    ).toThrow("could not connect to server");
  });
});
