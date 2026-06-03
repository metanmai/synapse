import type { CapturedSession } from "../capture/types.js";

export function buildPrompt(session: CapturedSession, existingFiles?: string[]): string {
  const transcript = session.messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");

  const existingSection = existingFiles?.length
    ? `\n## Existing workspace files (do not duplicate these):\n${existingFiles.map((f) => `- ${f}`).join("\n")}\n`
    : "";

  return `You are analyzing an AI coding session to extract valuable knowledge.

## Session metadata
- Tool: ${session.tool}
- Project: ${session.projectPath}
- Started: ${session.startedAt}
- Messages: ${session.messages.length}
${existingSection}
## Task

Read the transcript below and extract any non-trivial insights into structured files. Only extract things worth remembering — skip trivial exchanges, small fixes, and routine operations.

Extract into three categories:

1. **Decisions** — choices made and their reasoning. Path: \`decisions/<topic-slug>.md\`
2. **Architecture** — system design, data flow, component descriptions. Path: \`architecture/<topic-slug>.md\`
3. **Learnings** — gotchas, debugging insights, surprising discoveries. Path: \`learnings/<topic-slug>.md\`

If the session contains nothing worth extracting in a category, omit it.

## Output format

Respond with ONLY a JSON array. No markdown fencing, no explanation. Each element:

\`\`\`
{
  "path": "decisions/chose-session-cookies.md",
  "content": "# Chose Session Cookies\\n\\nWe chose session cookies over JWT because...",
  "tags": ["decision", "auth"]
}
\`\`\`

If nothing is worth extracting, respond with an empty array: \`[]\`

## Transcript

${transcript}`;
}
