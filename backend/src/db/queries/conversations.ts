import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import type {
  Conversation,
  ConversationContext,
  ConversationListItem,
  ConversationMediaRecord,
  ConversationMessage,
  ConversationStatus,
  FidelityMode,
  MessageRole,
  ProjectContext,
  ToolInteraction,
} from "../types";

const CONVERSATION_COLUMNS =
  "id, project_id, user_id, title, status, fidelity_mode, system_prompt, working_context, forked_from, fork_point, message_count, media_size, metadata, encrypted, created_at, updated_at, compacted_summary, compacted_at, compaction_model";

const CONVERSATION_LIST_COLUMNS = "id, title, status, message_count, metadata, updated_at, compacted_at";

const MESSAGE_COLUMNS =
  "id, conversation_id, sequence, role, content, tool_interaction, source_agent, source_model, token_count, cost, attachments_summary, parent_message_id, encrypted, created_at";

const MEDIA_COLUMNS =
  "id, message_id, conversation_id, type, mime_type, filename, size, storage_path, encrypted, created_at";

const CONTEXT_COLUMNS = "id, conversation_id, type, key, value, snapshot_at, encrypted, created_at";

// --- Conversation CRUD ---

export async function createConversation(
  db: SupabaseClient,
  params: {
    project_id: string;
    user_id: string;
    title?: string | null;
    status?: ConversationStatus;
    fidelity_mode?: FidelityMode;
    system_prompt?: string | null;
    working_context?: Record<string, unknown> | null;
    forked_from?: string | null;
    fork_point?: number | null;
    metadata?: Record<string, unknown> | null;
    encrypted?: boolean;
  },
): Promise<Conversation> {
  const { data, error } = await db
    .from("conversations")
    .insert({
      project_id: params.project_id,
      user_id: params.user_id,
      title: params.title ?? null,
      status: params.status ?? "active",
      fidelity_mode: params.fidelity_mode ?? "summary",
      system_prompt: params.system_prompt ?? null,
      working_context: params.working_context ?? null,
      forked_from: params.forked_from ?? null,
      fork_point: params.fork_point ?? null,
      metadata: params.metadata ?? null,
      encrypted: params.encrypted ?? false,
    })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function getConversation(db: SupabaseClient, conversationId: string): Promise<Conversation | null> {
  return singleOrNull<Conversation>(
    await db.from("conversations").select(CONVERSATION_COLUMNS).eq("id", conversationId).single(),
  );
}

export async function listConversations(
  db: SupabaseClient,
  projectId: string,
  options?: { limit?: number; offset?: number; status?: ConversationStatus },
): Promise<{ conversations: ConversationListItem[]; total: number }> {
  // Get total count (excluding deleted)
  let countQuery = db
    .from("conversations")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .neq("status", "deleted");

  if (options?.status) {
    countQuery = countQuery.eq("status", options.status);
  }

  const { count, error: countError } = await countQuery;
  if (countError) throw countError;

  // Get paginated results (excluding deleted)
  let query = db
    .from("conversations")
    .select(CONVERSATION_LIST_COLUMNS)
    .eq("project_id", projectId)
    .neq("status", "deleted")
    .order("updated_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    conversations: (data ?? []) as ConversationListItem[],
    total: count ?? 0,
  };
}

export async function updateConversation(
  db: SupabaseClient,
  conversationId: string,
  params: {
    title?: string | null;
    status?: ConversationStatus;
    fidelity_mode?: FidelityMode;
    system_prompt?: string | null;
    working_context?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    encrypted?: boolean;
  },
): Promise<Conversation> {
  const updates: Record<string, unknown> = {
    // Bump updated_at on every write so the conversation bubbles up in
    // listConversations (ordered desc on updated_at). See appendMessages
    // for the full motivation — same bug class, all conversation-mutation
    // paths need this. Migration 023 also installs a BEFORE UPDATE trigger
    // as the schema-level enforcement.
    updated_at: new Date().toISOString(),
  };
  if (params.title !== undefined) updates.title = params.title;
  if (params.status !== undefined) updates.status = params.status;
  if (params.fidelity_mode !== undefined) updates.fidelity_mode = params.fidelity_mode;
  if (params.system_prompt !== undefined) updates.system_prompt = params.system_prompt;
  if (params.working_context !== undefined) updates.working_context = params.working_context;
  if (params.metadata !== undefined) updates.metadata = params.metadata;
  if (params.encrypted !== undefined) updates.encrypted = params.encrypted;

  const { data, error } = await db
    .from("conversations")
    .update(updates)
    .eq("id", conversationId)
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Conversation;
}

/**
 * Move a conversation to a different project. Used by `synapse move` to
 * fix misrouted captures (e.g., the legacy projects[0] heuristic, or
 * Tier 2 name-collisions that silently merged two unrelated `scratch`
 * dirs). Caller is responsible for membership checks on BOTH source and
 * target projects before calling this — the query helper itself only
 * runs the UPDATE.
 */
export async function reassignConversation(
  db: SupabaseClient,
  conversationId: string,
  newProjectId: string,
): Promise<Conversation> {
  const { data, error } = await db
    .from("conversations")
    .update({ project_id: newProjectId, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Conversation;
}

// --- Messages ---

export async function appendMessages(
  db: SupabaseClient,
  conversationId: string,
  messages: Array<{
    role: MessageRole;
    content?: string | null;
    tool_interaction?: ToolInteraction | null;
    source_agent: string;
    source_model?: string | null;
    token_count?: { input?: number; output?: number } | null;
    cost?: number | null;
    attachments_summary?: string | null;
    parent_message_id?: string | null;
    encrypted?: boolean;
  }>,
): Promise<ConversationMessage[]> {
  if (messages.length === 0) return [];

  // Get current max sequence for this conversation
  const { data: maxRow, error: maxError } = await db
    .from("conversation_messages")
    .select("sequence")
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) throw maxError;

  let nextSequence = (maxRow?.sequence ?? 0) + 1;

  // Build insert rows with auto-incremented sequences
  const rows = messages.map((msg) => ({
    conversation_id: conversationId,
    sequence: nextSequence++,
    role: msg.role,
    content: msg.content ?? null,
    tool_interaction: msg.tool_interaction ?? null,
    source_agent: msg.source_agent,
    source_model: msg.source_model ?? null,
    token_count: msg.token_count ?? null,
    cost: msg.cost ?? null,
    attachments_summary: msg.attachments_summary ?? null,
    parent_message_id: msg.parent_message_id ?? null,
    encrypted: msg.encrypted ?? false,
  }));

  const { data, error } = await db.from("conversation_messages").insert(rows).select(MESSAGE_COLUMNS);
  if (error) throw error;

  // Update message_count + bump updated_at so listConversations (which
  // orders by updated_at desc) ranks this conversation as most-recent
  // activity. Without this, long-running sessions stay at their original
  // creation timestamp even as thousands of messages append — short-lived
  // subprocess sessions created later then outrank them, and the
  // SessionStart hook pulls the wrong "where I left off" handoff.
  // Migration 023 also wires a BEFORE UPDATE trigger; this explicit set
  // is belt-and-suspenders for pre-migration deploys.
  const { error: updateError } = await db
    .from("conversations")
    .update({
      message_count: (maxRow?.sequence ?? 0) + messages.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
  if (updateError) {
    console.error(`[conversations] Failed to update message_count for ${conversationId}:`, updateError.message);
  }

  return (data ?? []) as ConversationMessage[];
}

export async function getMessages(
  db: SupabaseClient,
  conversationId: string,
  options?: { fromSequence?: number; limit?: number; offset?: number },
): Promise<ConversationMessage[]> {
  let query = db
    .from("conversation_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("sequence", { ascending: true });

  if (options?.fromSequence !== undefined) {
    query = query.gte("sequence", options.fromSequence);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 100) - 1);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ConversationMessage[];
}

// --- Media ---

export async function getMediaForConversation(
  db: SupabaseClient,
  conversationId: string,
): Promise<ConversationMediaRecord[]> {
  const { data, error } = await db
    .from("conversation_media")
    .select(MEDIA_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ConversationMediaRecord[];
}

export async function insertMedia(
  db: SupabaseClient,
  params: {
    message_id: string;
    conversation_id: string;
    type: "image" | "file" | "pdf" | "audio" | "video";
    mime_type: string;
    filename?: string | null;
    size: number;
    storage_path: string;
    encrypted?: boolean;
  },
): Promise<ConversationMediaRecord> {
  const { data, error } = await db
    .from("conversation_media")
    .insert({
      message_id: params.message_id,
      conversation_id: params.conversation_id,
      type: params.type,
      mime_type: params.mime_type,
      filename: params.filename ?? null,
      size: params.size,
      storage_path: params.storage_path,
      encrypted: params.encrypted ?? false,
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) throw error;

  // Update media_size on the conversation
  // Fetch current media_size and add the new file's size
  const { data: conv, error: convError } = await db
    .from("conversations")
    .select("media_size")
    .eq("id", params.conversation_id)
    .single();
  if (convError) {
    console.error(`[conversations] Failed to read media_size for ${params.conversation_id}:`, convError.message);
  } else {
    const newSize = (conv.media_size ?? 0) + params.size;
    const { error: updateError } = await db
      .from("conversations")
      .update({ media_size: newSize })
      .eq("id", params.conversation_id);
    if (updateError) {
      console.error(`[conversations] Failed to update media_size for ${params.conversation_id}:`, updateError.message);
    }
  }

  return data as ConversationMediaRecord;
}

// --- Context ---

export async function saveConversationContext(
  db: SupabaseClient,
  conversationId: string,
  contexts: Array<{
    type: "file" | "repo" | "env" | "dependency";
    key: string;
    value?: string | null;
    snapshot_at?: number | null;
    encrypted?: boolean;
  }>,
): Promise<void> {
  if (contexts.length === 0) return;

  const rows = contexts.map((ctx) => ({
    conversation_id: conversationId,
    type: ctx.type,
    key: ctx.key,
    value: ctx.value ?? null,
    snapshot_at: ctx.snapshot_at ?? null,
    encrypted: ctx.encrypted ?? false,
  }));

  const { error } = await db.from("conversation_context").insert(rows);
  if (error) throw error;
}

export async function getConversationContext(
  db: SupabaseClient,
  conversationId: string,
): Promise<ConversationContext[]> {
  const { data, error } = await db
    .from("conversation_context")
    .select(CONTEXT_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ConversationContext[];
}

// --- Compaction ---

export async function updateCompaction(
  db: SupabaseClient,
  conversationId: string,
  summary: string,
  model: string,
): Promise<void> {
  const { error } = await db
    .from("conversations")
    .update({
      compacted_summary: summary,
      compacted_at: new Date().toISOString(),
      compaction_model: model,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function getProjectContext(db: SupabaseClient, projectId: string): Promise<ProjectContext | null> {
  const { data, error } = await db
    .from("project_context")
    .select("id, project_id, summary, conversation_count, model, updated_at")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectContext) ?? null;
}

export async function upsertProjectContext(
  db: SupabaseClient,
  projectId: string,
  summary: string,
  conversationCount: number,
  model: string,
): Promise<void> {
  const { error } = await db.from("project_context").upsert(
    {
      project_id: projectId,
      summary,
      conversation_count: conversationCount,
      model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );
  if (error) throw error;
}

export async function getRecentCompactedSummaries(
  db: SupabaseClient,
  projectId: string,
  limit = 5,
): Promise<Array<{ id: string; title: string; compacted_summary: string; compacted_at: string }>> {
  const { data, error } = await db
    .from("conversations")
    .select("id, title, compacted_summary, compacted_at")
    .eq("project_id", projectId)
    .not("compacted_summary", "is", null)
    .order("compacted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; title: string; compacted_summary: string; compacted_at: string }>;
}
