import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SYNAPSE_COMMAND_DEFS, appendInstructions, writeMcpJson } from "./io.js";

/** Write Cursor-style commands to a commands/ directory. */
function writeCursorCommandFiles(baseDir: string, pathPrefix: string): string[] {
  const written: string[] = [];
  const cmdDir = path.join(baseDir, "commands");
  fs.mkdirSync(cmdDir, { recursive: true });
  for (const [name, def] of Object.entries(SYNAPSE_COMMAND_DEFS)) {
    const filepath = path.join(cmdDir, `${name}.md`);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, `${def.body}\n`);
      written.push(`${pathPrefix}commands/${name}.md`);
    }
  }
  return written;
}

export function writeCursorLocal(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  const configDir = path.join(cwd, ".cursor");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp.json"), apiKey);
  written.push(".cursor/mcp.json");
  if (appendInstructions(path.join(cwd, ".cursorrules"))) {
    written.push(".cursorrules");
  }
  written.push(...writeCursorCommandFiles(path.join(cwd, ".cursor"), ".cursor/"));
  return written;
}

export function writeCursorGlobal(apiKey: string): string[] {
  const written: string[] = [];
  const globalMcp = path.join(os.homedir(), ".cursor", "mcp.json");
  writeMcpJson(globalMcp, apiKey);
  written.push("~/.cursor/mcp.json");
  written.push(...writeCursorCommandFiles(path.join(os.homedir(), ".cursor"), "~/.cursor/"));
  return written;
}
