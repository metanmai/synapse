import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noControlCharactersInRegex: testing ANSI escape codes requires control characters
const hasAnsi = (s: string) => /\x1b\[/.test(s);

describe("theme color functions (with color)", () => {
  let theme: typeof import("../../src/cli/theme.js");

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    theme = await import("../../src/cli/theme.js");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("accent()", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = theme.accent("hello");
      expect(result).toContain("hello");
      expect(hasAnsi(result)).toBe(true);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: testing ANSI escape codes
      expect(result).toMatch(/\x1b\[3[8]/);
      expect(result).toContain("\x1b[39m");
    });

    it("handles empty strings", () => {
      const result = theme.accent("");
      expect(result).toContain("");
      expect(hasAnsi(result)).toBe(true);
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[1mbold text\x1b[22m";
      const result = theme.accent(input);
      expect(result).toContain(input);
      expect(hasAnsi(result)).toBe(true);
    });
  });

  describe("cream()", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = theme.cream("hello");
      expect(result).toContain("hello");
      expect(hasAnsi(result)).toBe(true);
      expect(result).toContain("\x1b[39m");
    });

    it("handles empty strings", () => {
      const result = theme.cream("");
      expect(hasAnsi(result)).toBe(true);
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[31mred\x1b[39m";
      const result = theme.cream(input);
      expect(result).toContain(input);
    });
  });

  describe("muted()", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = theme.muted("hint text");
      expect(result).toContain("hint text");
      expect(hasAnsi(result)).toBe(true);
      expect(result).toContain("\x1b[39m");
    });

    it("handles empty strings", () => {
      const result = theme.muted("");
      expect(hasAnsi(result)).toBe(true);
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[1mbold\x1b[22m";
      const result = theme.muted(input);
      expect(result).toContain(input);
    });
  });

  describe("dim()", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = theme.dim("subtle");
      expect(result).toContain("subtle");
      expect(hasAnsi(result)).toBe(true);
      expect(result).toContain("\x1b[39m");
    });

    it("handles empty strings", () => {
      const result = theme.dim("");
      expect(hasAnsi(result)).toBe(true);
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[32mgreen\x1b[39m";
      const result = theme.dim(input);
      expect(result).toContain(input);
    });
  });

  describe("success()", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = theme.success("ok");
      expect(result).toContain("ok");
      expect(hasAnsi(result)).toBe(true);
      expect(result).toContain("\x1b[39m");
    });

    it("handles empty strings", () => {
      const result = theme.success("");
      expect(hasAnsi(result)).toBe(true);
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[1mcheck\x1b[22m";
      const result = theme.success(input);
      expect(result).toContain(input);
    });
  });

  describe("error()", () => {
    it("wraps text with ANSI escape codes", () => {
      const result = theme.error("fail");
      expect(result).toContain("fail");
      expect(hasAnsi(result)).toBe(true);
      expect(result).toContain("\x1b[39m");
    });

    it("handles empty strings", () => {
      const result = theme.error("");
      expect(hasAnsi(result)).toBe(true);
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[33myellow\x1b[39m";
      const result = theme.error(input);
      expect(result).toContain(input);
    });
  });

  describe("bold()", () => {
    it("wraps text with bold ANSI codes", () => {
      const result = theme.bold("strong");
      expect(result).toBe("\x1b[1mstrong\x1b[22m");
    });

    it("handles empty strings", () => {
      const result = theme.bold("");
      expect(result).toBe("\x1b[1m\x1b[22m");
    });

    it("handles strings with existing ANSI codes", () => {
      const input = "\x1b[31mred\x1b[39m";
      const result = theme.bold(input);
      expect(result).toBe(`\x1b[1m${input}\x1b[22m`);
    });
  });
});

describe("theme color functions (NO_COLOR)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NO_COLOR", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accent() returns plain text when NO_COLOR is set", async () => {
    const { accent } = await import("../../src/cli/theme.js");
    const result = accent("hello");
    expect(result).toBe("hello");
    expect(hasAnsi(result)).toBe(false);
  });

  it("cream() returns plain text when NO_COLOR is set", async () => {
    const { cream } = await import("../../src/cli/theme.js");
    expect(cream("hello")).toBe("hello");
  });

  it("muted() returns plain text when NO_COLOR is set", async () => {
    const { muted } = await import("../../src/cli/theme.js");
    expect(muted("hello")).toBe("hello");
  });

  it("dim() returns plain text when NO_COLOR is set", async () => {
    const { dim } = await import("../../src/cli/theme.js");
    expect(dim("hello")).toBe("hello");
  });

  it("success() returns plain text when NO_COLOR is set", async () => {
    const { success } = await import("../../src/cli/theme.js");
    expect(success("hello")).toBe("hello");
  });

  it("error() returns plain text when NO_COLOR is set", async () => {
    const { error } = await import("../../src/cli/theme.js");
    expect(error("hello")).toBe("hello");
  });

  it("bold() returns plain text when NO_COLOR is set", async () => {
    const { bold } = await import("../../src/cli/theme.js");
    const result = bold("hello");
    expect(result).toBe("hello");
    expect(hasAnsi(result)).toBe(false);
  });

  it("all functions return empty string unchanged when NO_COLOR is set", async () => {
    const { accent, cream, muted, dim, success, error, bold } = await import("../../src/cli/theme.js");
    expect(accent("")).toBe("");
    expect(cream("")).toBe("");
    expect(muted("")).toBe("");
    expect(dim("")).toBe("");
    expect(success("")).toBe("");
    expect(error("")).toBe("");
    expect(bold("")).toBe("");
  });
});
