export { ensureGitignore, writeJsonSafe, writeMcpJson } from "./io.js";
export { writeClaudeCodeLocal, writeClaudeCodeGlobal } from "./claude-code.js";
export { writeCursorLocal, writeCursorGlobal } from "./cursor.js";
export { writeWindsurfLocal, writeWindsurfGlobal } from "./windsurf.js";
export { writeVSCodeLocal, writeVSCodeGlobal } from "./vscode.js";
export {
  type SetupScope,
  type EditorInfo,
  type ExistingSetup,
  type ConfigLocation,
  type LocationStatus,
  detectEditors,
  detectExistingSetup,
} from "./detect.js";
export { type WriteResult, writeEditorConfigs, writeAllDetected } from "./orchestrate.js";
