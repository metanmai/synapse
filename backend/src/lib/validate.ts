import type { Context } from "hono";
import { z } from "zod";
import { AppError } from "./errors";

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Throws a 400 VALIDATION_ERROR with details on failure.
 */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AppError(issues, 400, "VALIDATION_ERROR");
  }
  return result.data;
}

// --- Shared schemas ---

export const schemas = {
  // Auth
  signup: z.object({
    email: z.string().email("Valid email is required"),
  }),

  login: z.object({
    email: z.string().email("Valid email is required"),
    password: z.string().min(1, "Password is required"),
    label: z.string().optional().default("cli"),
  }),

  verifyEmail: z.object({
    email: z.string().email("Valid email is required"),
    code: z.string().min(1, "Verification code is required"),
  }),

  cliSession: z.object({
    code_challenge: z.string().min(1, "Code challenge is required"),
  }),

  cliExchange: z.object({
    code: z.string().min(1, "Code is required"),
    code_verifier: z.string().min(1, "Code verifier is required"),
  }),

  createApiKey: z.object({
    label: z.string().min(1, "Label is required").trim(),
    expires_at: z.string().nullable().optional(),
  }),

  // Projects
  createProject: z.object({
    name: z.string().min(1, "Name is required"),
  }),

  addMember: z.object({
    email: z.string().email("Valid email is required"),
    role: z.enum(["editor", "viewer"]),
  }),

  updateMemberRole: z.object({
    role: z.enum(["editor", "viewer"]),
  }),

  setPreference: z.object({
    key: z.string().min(1, "Key is required"),
    value: z.string().min(1, "Value is required"),
  }),

  createShareLink: z.object({
    role: z.enum(["editor", "viewer"]),
    expires_at: z.string().optional(),
  }),

  // Context
  saveEntry: z.object({
    project: z.string().min(1, "Project is required"),
    path: z.string().min(1, "Path is required"),
    content: z.string().min(1, "Content is required"),
    tags: z.array(z.string()).optional(),
    source: z.string().optional(),
  }),

  sessionSummary: z.object({
    project: z.string().min(1, "Project is required"),
    summary: z.string().min(1, "Summary is required"),
    decisions: z.array(z.string()).optional(),
    pending: z.array(z.string()).optional(),
  }),

  saveFile: z.object({
    project: z.string().min(1, "Project is required"),
    path: z.string().min(1, "Path is required"),
    content: z.string().min(1, "Content is required"),
    content_type: z.enum(["markdown", "json"]).optional(),
  }),

  restoreEntry: z.object({
    path: z.string().min(1, "Path is required"),
    historyId: z.string().min(1, "History ID is required"),
  }),

  // Insights
  createInsight: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
    type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]),
    summary: z.string().min(1, "Summary is required"),
    detail: z.string().nullable().optional(),
    source: z
      .object({
        type: z.enum(["conversation", "session", "manual"]),
        id: z.string().optional(),
        agent: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),

  updateInsight: z.object({
    type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).optional(),
    summary: z.string().min(1).optional(),
    detail: z.string().nullable().optional(),
    source: z
      .object({
        type: z.enum(["conversation", "session", "manual"]),
        id: z.string().optional(),
        agent: z.string().optional(),
      })
      .nullable()
      .optional(),
  }),

  // Conversations
  createConversation: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
    title: z.string().nullable().optional(),
    fidelity_mode: z.enum(["summary", "full"]).optional(),
    system_prompt: z.string().nullable().optional(),
    working_context: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),

  updateConversation: z.object({
    title: z.string().nullable().optional(),
    status: z.enum(["active", "archived", "deleted"]).optional(),
    fidelity_mode: z.enum(["summary", "full"]).optional(),
  }),

  appendMessages: z.object({
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string().nullable(),
        tool_interaction: z
          .object({
            name: z.string(),
            input: z.record(z.string(), z.unknown()).optional(),
            output: z.string().optional(),
            summary: z.string(),
          })
          .nullable()
          .optional(),
        source_agent: z.string(),
        source_model: z.string().nullable().optional(),
        token_count: z.object({ input: z.number().optional(), output: z.number().optional() }).nullable().optional(),
        cost: z.number().nullable().optional(),
      }),
    ),
    context: z
      .array(
        z.object({
          type: z.enum(["file", "repo", "env", "dependency"]),
          key: z.string(),
          value: z.string().nullable(),
          snapshot_at: z.number().nullable().optional(),
        }),
      )
      .optional(),
  }),

  importConversation: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
    format: z.enum(["anthropic", "openai", "raw"]).optional(),
    title: z.string().nullable().optional(),
    messages: z.unknown(),
  }),
};
