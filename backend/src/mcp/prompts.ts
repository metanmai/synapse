import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../lib/env";

export function registerPrompts(server: McpServer, _env: Env) {
  server.prompt(
    "session_start",
    "Load relevant project context at the start of a session. Reminds you of capture conventions.",
    { project: z.string().describe("Project name to load context for") },
    async ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You have the Synapse context server connected. Project: "${project}".

To load this project's context, call the \`load_project_context\` tool with project="${project}".

**Auto-capture conventions:**
- When a technical decision is made → call \`save_context\` with path like \`decisions/<date>-<topic>.md\`
- When a convention or preference is established → call \`save_context\` with path like \`context/<topic>.md\`
- When architecture is discussed → call \`save_context\` with path like \`architecture/<topic>.md\`
- At the end of the session → call \`save_session_summary\` with a summary of what was done

Use \`search_context\` to find relevant prior context before starting work.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "session_end",
    "Summarize the current session and save context. Use at the end of a working session.",
    {
      project: z.string().describe("Project name"),
      summary: z.string().describe("Brief summary of what was accomplished"),
    },
    async ({ project, summary }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Please save a session summary for project "${project}".

Summary: ${summary}

Call \`save_session_summary\` with:
- project: "${project}"
- summary: A well-structured summary of what was accomplished
- decisions: List any technical decisions that were made
- pending: List any items that still need follow-up

Also check if any individual decisions or conventions should be saved as separate context entries using \`save_context\`.`,
          },
        },
      ],
    }),
  );
}
