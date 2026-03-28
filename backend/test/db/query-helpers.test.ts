import { describe, expect, it } from "vitest";
import { singleOrNull } from "../../src/db/query-helpers";

describe("singleOrNull", () => {
  it("returns data when query succeeds", () => {
    const result = singleOrNull({
      data: { id: "123", email: "test@test.com" },
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
    });
    expect(result).toEqual({ id: "123", email: "test@test.com" });
  });

  it("returns null when no rows found (PGRST116)", () => {
    const result = singleOrNull({
      data: null,
      error: { name: "PostgrestError", code: "PGRST116", message: "No rows found", details: "", hint: "" },
      count: null,
      status: 406,
      statusText: "Not Acceptable",
    });
    expect(result).toBeNull();
  });

  it("throws on database errors (not PGRST116)", () => {
    expect(() =>
      singleOrNull({
        data: null,
        error: {
          name: "PostgrestError",
          code: "42P01",
          message: 'relation "users" does not exist',
          details: "",
          hint: "",
        },
        count: null,
        status: 400,
        statusText: "Bad Request",
      }),
    ).toThrow('relation "users" does not exist');
  });

  it("throws on permission errors", () => {
    expect(() =>
      singleOrNull({
        data: null,
        error: {
          name: "PostgrestError",
          code: "42501",
          message: "permission denied for table users",
          details: "",
          hint: "",
        },
        count: null,
        status: 403,
        statusText: "Forbidden",
      }),
    ).toThrow("permission denied for table users");
  });

  it("throws on connection errors", () => {
    expect(() =>
      singleOrNull({
        data: null,
        error: { name: "PostgrestError", code: "08001", message: "could not connect to server", details: "", hint: "" },
        count: null,
        status: 500,
        statusText: "Internal Server Error",
      }),
    ).toThrow("could not connect to server");
  });
});
