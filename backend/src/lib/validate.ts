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
    device_name: z.string().optional(),
    // Phase 03-05: optional per-machine UUID generated at first
    // `synapsesync wizard` and persisted at ~/.synapse/device.json.
    // When present, the backend matches on (user_id, machine_id) and
    // returns the existing API key instead of creating a duplicate,
    // so re-running `wizard` from the same machine doesn't burn a
    // device-cap slot. Legacy CLIs that don't send it still work
    // (machine_id stays NULL on the row).
    machine_id: z.string().uuid().optional(),
  }),

  cliExchange: z.object({
    code: z.string().min(1, "Code is required"),
    code_verifier: z.string().min(1, "Code verifier is required"),
  }),

  // BUG #5: Free-tier user hits 3-device cap → /auth/cli-session returns
  // 409. The web /cli-auth picker UI lets them choose a device to revoke,
  // then POSTs that selection here. Server revokes the chosen key + mints
  // a fresh session in one atomic-ish flow (revoke first, then mint —
  // a partial failure leaves the user under-limit which is the safe direction).
  cliRevokeAndSession: z.object({
    revoke_key_id: z.string().uuid("revoke_key_id must be a UUID"),
    code_challenge: z.string().min(1, "Code challenge is required"),
    device_name: z.string().optional(),
    machine_id: z.string().uuid().optional(),
  }),

  createApiKey: z.object({
    label: z.string().min(1, "Label is required").trim(),
    expires_at: z.string().nullable().optional(),
  }),

  // BUG #6: dashboard inline-edit for api_keys labels. Schema is just the
  // label string (we use the URL param for the key id). Capped at 80 chars
  // (display sits in a single dashboard row); trimmed so trailing space
  // doesn't get persisted. The cli- prefix logic lives in the handler.
  renameApiKey: z.object({
    label: z.string().min(1, "Label is required").max(80, "Label too long (80 char max)").trim(),
  }),

  // Project resolve
  resolveProject: z.object({
    cwd: z.string().min(1, "cwd is required"),
    git_origin_url: z.string().optional(),
    git_basename: z.string().optional(),
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
    // Curation pointer (migration 024). Optional list of insight ids this
    // new save replaces; the backend stamps `superseded_by = <new_id>` on
    // each so they drop out of default brief / list queries. Scope-checked
    // (same project) and idempotent (skips already-superseded rows) in the
    // query layer — see createInsight().
    supersedes: z.array(z.string().uuid("Each supersedes entry must be a valid insight id")).optional(),
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

  // Conversations.
  // project_id is OPTIONAL — when missing, the route auto-resolves it from
  // working_context.git_remote_url + git_basename via findOrCreateProjectByGit,
  // mirroring the events-batch auto-create flow. This is what lets the
  // capture-worker stop hardcoding `projects[0]` and route each session to
  // its own per-cwd project.
  createConversation: z.object({
    project_id: z.string().uuid("Valid project ID is required").optional(),
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

  // Reassign a conversation to a different project. Used by `synapse move`
  // to undo misrouting (e.g., a Tier 2 name collision that dropped a
  // session into the wrong project, or legacy projects[0] dumps).
  reassignConversation: z.object({
    project_id: z.string().uuid("Valid project ID is required"),
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
