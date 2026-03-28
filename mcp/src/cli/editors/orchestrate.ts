import type { EditorInfo, SetupScope } from "./detect.js";
import { detectEditors } from "./detect.js";

export interface WriteResult {
  written: string[];
  errors: { editor: string; error: string }[];
}

/** Write configs for selected editors. Continues on per-editor failure. */
export function writeEditorConfigs(editors: EditorInfo[], apiKey: string): WriteResult {
  const written: string[] = [];
  const errors: { editor: string; error: string }[] = [];
  for (const editor of editors) {
    try {
      written.push(...editor.write(apiKey));
    } catch (err) {
      errors.push({ editor: editor.name, error: (err as Error).message });
    }
  }
  return { written: [...new Set(written)], errors };
}

export function writeAllDetected(apiKey: string, scope: SetupScope = "local"): WriteResult {
  return writeEditorConfigs(
    detectEditors(scope).filter((e) => e.detected),
    apiKey,
  );
}
