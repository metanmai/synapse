import fs from "node:fs";
import path from "node:path";
import { SYNAPSE_COMMAND_DEFS, appendInstructions, globalConfigDir, synapseMcpServer, writeMcpJson, writeJsonSafe } from "./io.js";

/** Write VS Code Copilot prompt files to .github/prompts/. */
function writeVSCodePromptFiles(cwd: string): string[] {
  const written: string[] = [];
  const promptDir = path.join(cwd, ".github", "prompts");
  fs.mkdirSync(promptDir, { recursive: true });
  for (const [name, def] of Object.entries(SYNAPSE_COMMAND_DEFS)) {
    const filepath = path.join(promptDir, `${name}.prompt.md`);
    if (!fs.existsSync(filepath)) {
      const content = `---\ndescription: "${def.description}"\nmode: "agent"\n---\n\n${def.body}\n`;
      fs.writeFileSync(filepath, content);
      written.push(`.github/prompts/${name}.prompt.md`);
    }
  }
  return written;
}

export function writeVSCodeLocal(apiKey: string, cwd: string): string[] {
  const written: string[] = [];
  const mcpJsonPath = path.join(cwd, ".vscode", "mcp.json");
  fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true });
  writeJsonSafe(mcpJsonPath, (config) => {
    if (!config.servers) config.servers = {};
    (config.servers as Record<string, unknown>).synapse = synapseMcpServer(apiKey);
  });
  written.push(".vscode/mcp.json");
  const ghDir = path.join(cwd, ".github");
  fs.mkdirSync(ghDir, { recursive: true });
  if (appendInstructions(path.join(ghDir, "copilot-instructions.md"))) {
    written.push(".github/copilot-instructions.md");
  }
  written.push(...writeVSCodePromptFiles(cwd));
  return written;
}

export function writeVSCodeGlobal(apiKey: string): string[] {
  const written: string[] = [];
  const mcpJsonPath = path.join(globalConfigDir(), "Code", "User", "mcp.json");
  if (fs.existsSync(path.dirname(mcpJsonPath))) {
    writeJsonSafe(mcpJsonPath, (config) => {
      if (!config.servers) config.servers = {};
      (config.servers as Record<string, unknown>).synapse = synapseMcpServer(apiKey);
    });
    written.push("VS Code user mcp.json");
  }
  return written;
}
