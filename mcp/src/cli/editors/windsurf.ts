import fs from "node:fs";
import path from "node:path";
import { SYNAPSE_COMMAND_DEFS, appendInstructions, writeMcpJson } from "./io.js";

/** Write Windsurf workflow files to .windsurf/workflows/. */
function writeWindsurfWorkflowFiles(cwd: string): string[] {
  const written: string[] = [];
  const workflowDir = path.join(cwd, ".windsurf", "workflows");
  fs.mkdirSync(workflowDir, { recursive: true });
  for (const [name, def] of Object.entries(SYNAPSE_COMMAND_DEFS)) {
    const filepath = path.join(workflowDir, `${name}.md`);
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, `${def.body}\n`);
      written.push(`.windsurf/workflows/${name}.md`);
    }
  }
  return written;
}

export function writeWindsurfLocal(apiKey: string, home: string, cwd: string): string[] {
  const written: string[] = [];
  const configDir = path.join(home, ".codeium", "windsurf");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp_config.json"), apiKey);
  written.push("~/.codeium/windsurf/mcp_config.json");
  if (appendInstructions(path.join(cwd, ".windsurfrules"))) {
    written.push(".windsurfrules");
  }
  written.push(...writeWindsurfWorkflowFiles(cwd));
  return written;
}

export function writeWindsurfGlobal(apiKey: string, home: string): string[] {
  const written: string[] = [];
  const configDir = path.join(home, ".codeium", "windsurf");
  fs.mkdirSync(configDir, { recursive: true });
  writeMcpJson(path.join(configDir, "mcp_config.json"), apiKey);
  written.push("~/.codeium/windsurf/mcp_config.json");
  return written;
}
