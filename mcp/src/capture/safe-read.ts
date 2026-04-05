import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Safely read a file using copy-on-read pattern.
 *
 * 1. Rejects symlinks (security: prevents symlink traversal attacks)
 * 2. Copies file to os.tmpdir() before reading (safety: avoids mid-write partial content)
 * 3. Returns content string, or null on error
 * 4. Cleans up temp file after reading
 */
export function safeReadFile(filePath: string): string | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      return null;
    }
  } catch {
    return null;
  }

  let tmpDir: string | null = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfs_"));
    const tmpFile = path.join(tmpDir, path.basename(filePath));
    fs.copyFileSync(filePath, tmpFile);
    return fs.readFileSync(tmpFile, "utf-8");
  } catch {
    return null;
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
