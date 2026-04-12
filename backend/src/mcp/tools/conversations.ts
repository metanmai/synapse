import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { logActivity } from "../../db/activity-logger";
import {
  appendMessages,
  createConversation,
  getConversation,
  getConversationLimits,
  getMessages,
  insertMedia,
  listConversations,
} from "../../db/queries";
import { getActiveSubscription } from "../../db/queries/subscriptions";
import { uploadMedia } from "../../lib/storage";

import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { mcpError, mcpResolveProject, mcpSuccess, requireMcpUserId } from "../mcp-context";

/** Helper: check if user has Plus tier with sync enabled. Returns error text or null. */
async function requirePlusSync(db: SupabaseClient, userId: string): Promise<string | null> {
  const sub = await getActiveSubscription(db, userId);
  const tier = sub ? "plus" : "free";
  const limits = await getConversationLimits(db, tier);
  if (!limits?.sync_enabled) {
    return "Conversation sync requires a Plus subscription. Upgrade at https://synapsesync.app/account to enable cross-agent conversation syncing.";
  }
  return null;
}

/** Detect media type from MIME type string. */
function mediaTypeFromMime(mime: string): "image" | "file" | "pdf" | "audio" | "video" {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

export function registerConversationTools(server: McpServer, _env: Env, getContext: GetMcpContext, db: SupabaseClient) {
  // --- sync_conversation ---
  server.tool(
    "sync_conversation",
    "Push messages to a conversation. Creates a new conversation if no conversationId is provided, otherwise appends messages to the existing one. Plus only.",
    {
      project: z.string().describe("Project name"),
      conversationId: z
        .string()
        .optional()
        .describe("Existing conversation ID to append to. Omit to create a new conversation."),
      title: z.string().optional().describe("Conversation title (used when creating a new conversation)"),
      systemPrompt: z.string().optional().describe("System prompt for the conversation"),
      workingContext: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Working context (key-value metadata about the environment, repo, etc.)"),
      fidelity: z
        .enum(["summary", "full"])
        .optional()
        .describe("Fidelity mode: 'summary' collapses tool calls, 'full' preserves everything. Default: summary"),
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant", "system", "tool"]).describe("Message role"),
            content: z.string().describe("Message content"),
            toolSummary: z.string().optional().describe("One-line summary of a tool call (for fidelity=summary)"),
            sourceAgent: z.string().optional().describe("Agent that produced this message (e.g. 'claude', 'chatgpt')"),
            sourceModel: z.string().optional().describe("Model used (e.g. 'claude-opus-4-20250514', 'gpt-4o')"),
          }),
        )
        .describe("Messages to append"),
    },
    async ({ project, conversationId, title, systemPrompt, workingContext, fidelity, messages }) => {
      const userId = requireMcpUserId(getContext);

      // Tier check
      const tierError = await requirePlusSync(db, userId);
      if (tierError) return mcpError(tierError);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      let convId = conversationId;
      let action: string;

      // Create conversation if no ID provided
      if (!convId) {
        const conv = await createConversation(db, {
          project_id: proj.id,
          user_id: userId,
          title: title ?? null,
          fidelity_mode: fidelity ?? "summary",
          system_prompt: systemPrompt ?? null,
          working_context: workingContext ?? null,
        });
        convId = conv.id;
        action = "Created";
      } else {
        // Verify the conversation exists and belongs to this project
        const existing = await getConversation(db, convId);
        if (!existing) {
          return mcpError(`Conversation "${convId}" not found.`);
        }
        if (existing.project_id !== proj.id) {
          return mcpError(`Conversation "${convId}" does not belong to project "${project}".`);
        }
        action = "Updated";
      }

      // Append messages
      let appended = 0;
      if (messages.length > 0) {
        const rows = messages.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system" | "tool",
          content: msg.content,
          tool_interaction: msg.toolSummary ? { name: "tool", summary: msg.toolSummary } : null,
          source_agent: msg.sourceAgent ?? "unknown",
          source_model: msg.sourceModel ?? null,
        }));
        const inserted = await appendMessages(db, convId, rows);
        appended = inserted.length;
      }

      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: action === "Created" ? "conversation_created" : "conversation_synced",
        source: "mcp",
        metadata: { conversation_id: convId, messages_appended: appended },
      });

      return mcpSuccess(`${action} conversation "${convId}" in project "${project}". ${appended} message(s) appended.`);
    },
  );

  // --- load_conversation ---
  server.tool(
    "load_conversation",
    "Load a conversation to resume it in another agent. Returns the system prompt, working context, and full message transcript. Plus only.",
    {
      project: z.string().describe("Project name"),
      conversationId: z.string().describe("Conversation ID to load"),
      fidelity: z
        .enum(["summary", "full"])
        .optional()
        .describe("Override fidelity mode for this load (default: use conversation's setting)"),
      fromSequence: z
        .number()
        .optional()
        .describe("Start from this message sequence number (for partial loads / pagination)"),
    },
    async ({ project, conversationId, fidelity, fromSequence }) => {
      const userId = requireMcpUserId(getContext);

      // Tier check
      const tierError = await requirePlusSync(db, userId);
      if (tierError) return mcpError(tierError);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const conv = await getConversation(db, conversationId);
      if (!conv) {
        return mcpError(`Conversation "${conversationId}" not found.`);
      }
      if (conv.project_id !== proj.id) {
        return mcpError(`Conversation "${conversationId}" does not belong to project "${project}".`);
      }

      const messages = await getMessages(db, conversationId, {
        fromSequence: fromSequence ?? undefined,
      });

      // Build formatted transcript
      const parts: string[] = [];

      parts.push(`# Conversation: ${conv.title ?? "(untitled)"}`);
      parts.push(`**ID:** ${conv.id}`);
      parts.push(
        `**Status:** ${conv.status} | **Fidelity:** ${fidelity ?? conv.fidelity_mode} | **Messages:** ${conv.message_count}`,
      );
      parts.push("");

      if (conv.system_prompt) {
        parts.push("## System Prompt");
        parts.push(conv.system_prompt);
        parts.push("");
      }

      if (conv.working_context && Object.keys(conv.working_context).length > 0) {
        parts.push("## Working Context");
        for (const [key, value] of Object.entries(conv.working_context)) {
          parts.push(`- **${key}:** ${typeof value === "string" ? value : JSON.stringify(value)}`);
        }
        parts.push("");
      }

      if (messages.length > 0) {
        parts.push("## Messages");
        parts.push("");
        for (const msg of messages) {
          const agent = msg.source_agent
            ? ` (${msg.source_agent}${msg.source_model ? ` / ${msg.source_model}` : ""})`
            : "";
          parts.push(`### [${msg.sequence}] ${msg.role}${agent}`);
          if (msg.content) {
            parts.push(msg.content);
          }
          if (msg.tool_interaction) {
            const mode = fidelity ?? conv.fidelity_mode;
            if (mode === "summary") {
              parts.push(`> Tool: ${msg.tool_interaction.summary}`);
            } else {
              parts.push(`> Tool: ${msg.tool_interaction.name}`);
              if (msg.tool_interaction.input) {
                parts.push(`> Input: ${JSON.stringify(msg.tool_interaction.input)}`);
              }
              if (msg.tool_interaction.output) {
                parts.push(`> Output: ${msg.tool_interaction.output}`);
              }
            }
          }
          parts.push("");
        }
      } else {
        parts.push("*No messages found.*");
      }

      await logActivity(db, {
        project_id: proj.id,
        user_id: userId,
        action: "conversation_loaded",
        source: "mcp",
        metadata: { conversation_id: conversationId, messages_loaded: messages.length },
      });

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    },
  );

  // --- list_conversations ---
  server.tool(
    "list_conversations",
    "List conversations in a project, with optional status filter. Returns titles, message counts, dates, and IDs. Plus only.",
    {
      project: z.string().describe("Project name"),
      status: z.enum(["active", "archived"]).optional().describe("Filter by status (default: all non-deleted)"),
      limit: z.number().optional().describe("Maximum number of conversations to return (default 20)"),
    },
    async ({ project, status, limit }) => {
      const userId = requireMcpUserId(getContext);

      // Tier check
      const tierError = await requirePlusSync(db, userId);
      if (tierError) return mcpError(tierError);

      const proj = await mcpResolveProject(db, project, userId);
      if (!proj) return mcpError(`Project "${project}" not found.`);

      const { conversations, total } = await listConversations(db, proj.id, {
        status: status ?? undefined,
        limit: limit ?? 20,
      });

      if (conversations.length === 0) {
        const filterNote = status ? ` with status "${status}"` : "";
        return mcpError(`No conversations${filterNote} found in project "${project}".`);
      }

      const lines = conversations.map((c) => {
        const title = c.title ?? "(untitled)";
        const date = new Date(c.updated_at).toLocaleDateString();
        return `- **${title}** — ${c.message_count} messages, ${c.status}, updated ${date}\n  ID: \`${c.id}\``;
      });

      const filterNote = status ? ` (status: ${status})` : "";
      const header = `${total} conversation(s) in "${project}"${filterNote} (showing ${conversations.length}):`;

      return {
        content: [{ type: "text" as const, text: `${header}\n\n${lines.join("\n")}` }],
      };
    },
  );

  // --- upload_media ---
  server.tool(
    "upload_media",
    "Upload media (image, file, PDF, audio, video) to a conversation message. The content must be base64-encoded. Plus only.",
    {
      conversationId: z.string().describe("Conversation ID"),
      messageId: z.string().describe("Message ID to attach media to"),
      filename: z.string().describe("Filename including extension"),
      mimeType: z.string().describe("MIME type (e.g. 'image/png', 'application/pdf')"),
      content: z.string().describe("Base64-encoded file content"),
    },
    async ({ conversationId, messageId, filename, mimeType, content }) => {
      const userId = requireMcpUserId(getContext);

      // Tier check
      const tierError = await requirePlusSync(db, userId);
      if (tierError) return mcpError(tierError);

      // Verify conversation exists
      const conv = await getConversation(db, conversationId);
      if (!conv) {
        return mcpError(`Conversation "${conversationId}" not found.`);
      }
      if (conv.user_id !== userId) {
        return mcpError("You do not have access to this conversation.");
      }

      // Decode base64
      let bytes: Uint8Array;
      try {
        const binary = atob(content);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
      } catch {
        return mcpError("Invalid base64 content.");
      }

      // Upload to Supabase Storage
      const storagePath = await uploadMedia(db, conversationId, messageId, filename, bytes, mimeType);

      // Insert media record
      const mediaType = mediaTypeFromMime(mimeType);
      const record = await insertMedia(db, {
        message_id: messageId,
        conversation_id: conversationId,
        type: mediaType,
        mime_type: mimeType,
        filename,
        size: bytes.length,
        storage_path: storagePath,
      });

      await logActivity(db, {
        project_id: conv.project_id,
        user_id: userId,
        action: "media_uploaded",
        source: "mcp",
        metadata: {
          conversation_id: conversationId,
          message_id: messageId,
          media_id: record.id,
          filename,
          size: bytes.length,
        },
      });

      return mcpSuccess(
        `Uploaded "${filename}" (${bytes.length} bytes, ${mediaType}) to conversation "${conversationId}", message "${messageId}".`,
      );
    },
  );
}
