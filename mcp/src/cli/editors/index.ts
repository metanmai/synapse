// Barrel for the editors/ module. Limited to the names callers actually
// import via this path — the per-editor write functions (writeClaudeCodeLocal/
// Global, writeCursorLocal/Global, etc.) and io helpers are imported directly
// from their source files when needed, so they don't need re-exports here.
export {
  type SetupScope,
  type ExistingSetup,
  type ConfigLocation,
  detectEditors,
  detectExistingSetup,
} from "./detect.js";
export { writeEditorConfigs } from "./orchestrate.js";
