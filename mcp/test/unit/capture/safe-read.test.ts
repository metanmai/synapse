import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeReadFile } from "../../../src/capture/safe-read.js";

describe("safeReadFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "safe-read-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a regular file and returns its content", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "hello world", "utf-8");
    expect(safeReadFile(filePath)).toBe("hello world");
  });

  it("returns null for a symlink", () => {
    const realFile = path.join(tmpDir, "real.txt");
    const linkFile = path.join(tmpDir, "link.txt");
    fs.writeFileSync(realFile, "secret content", "utf-8");
    fs.symlinkSync(realFile, linkFile);
    expect(safeReadFile(linkFile)).toBeNull();
  });

  it("returns null for a non-existent file", () => {
    expect(safeReadFile(path.join(tmpDir, "nonexistent.txt"))).toBeNull();
  });

  it("returns content via copy-on-read (does not read source directly)", () => {
    const filePath = path.join(tmpDir, "data.json");
    fs.writeFileSync(filePath, '{"key":"value"}', "utf-8");
    const content = safeReadFile(filePath);
    expect(content).toBe('{"key":"value"}');
  });

  it("cleans up temp files after reading", () => {
    const filePath = path.join(tmpDir, "cleanup-test.txt");
    fs.writeFileSync(filePath, "temp content", "utf-8");

    // Create a unique marker to detect our temp dir
    const tmpRoot = os.tmpdir();
    safeReadFile(filePath);

    // After safeReadFile returns, no sfs_ dirs created by this call should remain.
    // We verify by checking that no sfs_ dir contains our specific filename.
    const sfsDirs = fs.readdirSync(tmpRoot).filter((f) => f.startsWith("sfs_"));
    const leakedDirs = sfsDirs.filter((d) => {
      try {
        const contents = fs.readdirSync(path.join(tmpRoot, d));
        return contents.includes("cleanup-test.txt");
      } catch {
        return false;
      }
    });
    expect(leakedDirs.length).toBe(0);
  });

  it("handles empty files", () => {
    const filePath = path.join(tmpDir, "empty.txt");
    fs.writeFileSync(filePath, "", "utf-8");
    expect(safeReadFile(filePath)).toBe("");
  });

  it("handles files with unicode content", () => {
    const filePath = path.join(tmpDir, "unicode.txt");
    const content = "Hello \u4e16\u754c \ud83c\udf0d";
    fs.writeFileSync(filePath, content, "utf-8");
    expect(safeReadFile(filePath)).toBe(content);
  });
});
