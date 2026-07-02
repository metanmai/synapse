import os from "node:os";
import path from "node:path";
import { safeReadFile } from "../safe-read.js";
import type { CapturedSession, SessionMessage, ToolAdapter } from "../types.js";
import { sessionIdFromNative } from "../types.js";

interface CursorRequest {
  requestId: string;
  message: { text: string };
  response?: { value: string }[];
  timestamp: number;
}

interface CursorChat {
  requests: CursorRequest[];
  sessionId: string;
  creationDate: number;
  lastMessageDate: number;
}

/**
 * Resolve the per-platform Cursor `User/workspaceStorage` directory.
 * Exported for unit-test use (test injects process.platform via vi.spyOn).
 */
export function cursorWorkspaceStorageDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage");
  }
  if (platform === "win32") {
    // %APPDATA% on Windows is usually C:\Users\<user>\AppData\Roaming.
    // Cursor (an Electron app) stores its user data under
    // %APPDATA%\Cursor\User\workspaceStorage, same shape as VS Code.
    // Fall back to ~/AppData/Roaming if APPDATA env isn't set — Node's
    // os.homedir() always works on Windows, and AppData\Roaming is the
    // standard location.
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor", "User", "workspaceStorage");
  }
  // Linux / *BSD / anything else: VS-Code-style XDG layout under ~/.config.
  return path.join(os.homedir(), ".config", "Cursor", "User", "workspaceStorage");
}

export class CursorAdapter implements ToolAdapter {
  tool = "cursor";

  watchPaths(): string[] {
    const override = process.env.SYNAPSE_TEST_CURSOR_PATH;
    if (override) return [override];
    // Cursor's workspace-storage layout is platform-specific:
    //   - macOS   → ~/Library/Application Support/Cursor/User/workspaceStorage
    //   - Linux   → ~/.config/Cursor/User/workspaceStorage
    //   - Windows → %APPDATA%\Cursor\User\workspaceStorage  (typically C:\Users\<u>\AppData\Roaming\Cursor\...)
    return [cursorWorkspaceStorageDir()];
  }

  parse(filePath: string): CapturedSession | null {
    if (!filePath.endsWith(".json")) return null;

    const raw = safeReadFile(filePath);
    if (!raw) return null;

    let chat: CursorChat;
    try {
      chat = JSON.parse(raw) as CursorChat;
    } catch {
      return null;
    }

    if (!chat.requests || !chat.sessionId) return null;

    const messages: SessionMessage[] = [];

    for (const req of chat.requests) {
      const userText = req.message?.text;
      if (!userText) continue;

      messages.push({
        role: "user",
        content: userText,
        timestamp: new Date(req.timestamp).toISOString(),
      });

      const responseText = req.response?.map((r) => r.value).join("\n");
      if (responseText) {
        messages.push({
          role: "assistant",
          content: responseText,
          timestamp: new Date(req.timestamp).toISOString(),
        });
      }
    }

    if (messages.length === 0) return null;

    const parts = filePath.split(path.sep);
    const wsIdx = parts.indexOf("workspaceStorage");
    const projectPath = wsIdx >= 0 ? parts.slice(0, wsIdx).join(path.sep) : "unknown";

    return {
      id: sessionIdFromNative(chat.sessionId),
      tool: "cursor",
      projectPath,
      startedAt: new Date(chat.creationDate).toISOString(),
      updatedAt: new Date(chat.lastMessageDate).toISOString(),
      messages,
    };
  }
}
