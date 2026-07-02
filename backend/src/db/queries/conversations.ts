import type { SupabaseClient } from "@supabase/supabase-js";
import { singleOrNull } from "../query-helpers";
import type {
  Conversation,
  ConversationContext,
  ConversationListItem,
  ConversationMessage,
  ConversationStatus,
  FidelityMode,
  MessageRole,
  ProjectContext,
  ToolInteraction,
} from "../types";

// NB: assignment_method / assignment_confidence / embedding are intentionally NOT
// selected here. They require migration 029; keeping them out of the read path
// means conversation reads work even on a database where 029 isn't applied yet.
const CONVERSATION_COLUMNS =
  "id, project_id, user_id, title, status, fidelity_mode, system_prompt, working_context, forked_from, fork_point, message_count, media_size, metadata, encrypted, created_at, updated_at, compacted_summary, compacted_at, compaction_model";

const CONVERSATION_LIST_COLUMNS = "id, title, status, message_count, metadata, updated_at, compacted_at";

const MESSAGE_COLUMNS =
  "id, conversation_id, sequence, role, content, tool_interaction, source_agent, source_model, token_count, cost, attachments_summary, parent_message_id, encrypted, created_at";

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
    // AI project correlation: pgvector text form ("[0.1,0.2,...]"), and how the
    // project was chosen. Default method "git" preserves the legacy path's meaning.
    embedding?: string | null;
    assignment_method?: string | null;
    assignment_confidence?: number | null;
  },
): Promise<Conversation> {
  const insert: Record<string, unknown> = {
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
  };
  // The AI-correlation columns require migration 029. Only the keyless AI path
  // sets an embedding, so include the new columns ONLY then — the core (git)
  // capture path keeps working even on a database where 029 isn't applied yet.
  if (params.embedding != null) {
    insert.embedding = params.embedding;
    insert.assignment_method = params.assignment_method ?? "ai_assign";
    insert.assignment_confidence = params.assignment_confidence ?? null;
  }

  const { data, error } = await db.from("conversations").insert(insert).select(CONVERSATION_COLUMNS).single();
  if (error) throw error;
  return data as Conversation;
}

/**
 * Owner-scoped semantic kNN over conversation embeddings (match_conversations RPC,
 * migration 029). Returns project candidates with similarity scores. Vectors are
 * passed as the pgvector text form, mirroring searchEntries/match_entries.
 */
export async function matchConversations(
  db: SupabaseClient,
  userId: string,
  embedding: number[],
  threshold: number,
  count = 20,
): Promise<{ project_id: string; similarity: number }[]> {
  const { data, error } = await db.rpc("match_conversations", {
    query_embedding: JSON.stringify(embedding),
    match_user_id: userId,
    match_threshold: threshold,
    match_count: count,
  });
  if (error) {
    console.error("[correlation] match_conversations failed:", error.message);
    return [];
  }
  return (data ?? []) as { project_id: string; similarity: number }[];
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

// Concurrent-write retry parameters for appendMessages. Bug class:
// `select max(sequence)` → `insert at max+1` is a classic read-modify-
// write race. Two parallel POSTs to /api/conversations/:id/messages both
// read max=N, both try to INSERT at N+1, the unique(conversation_id,
// sequence) index rejects the loser with Postgres error 23505, and the
// loser previously surfaced as HTTP 500. Earlier E2E (2026-05-24): 10
// concurrent POSTs → 2 succeed, 8 return 500.
//
// MAX_APPEND_ATTEMPTS is generous enough to handle ~N concurrent writers
// without falling off (since each round only loses N-1, N-2, … times),
// while still bounding worst-case work if something pathological happens.
// Base backoff is ~10ms with jitter; doubles per attempt. Total max wait
// at 8 attempts ≈ 1.5s — well within request-budget territory.
const MAX_APPEND_ATTEMPTS = 8;
const APPEND_BACKOFF_BASE_MS = 10;

function isUniqueSequenceViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code !== "23505") return false;
  // Be conservative: only treat sequence-index violations as retryable,
  // not arbitrary 23505s. Index name comes from migration 007:
  //   create unique index ... on conversation_messages(conversation_id, sequence)
  const m = e.message ?? "";
  return m.includes("sequence") || m.includes("conversation_messages");
}

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

  // Retry loop for concurrent-write race. The whole select-max + insert
  // pair is re-run on 23505. A 23505 from one INSERT row aborts the
  // whole batch (Postgres rolls back the multi-row INSERT atomically),
  // so re-reading max() once gets us a fresh starting point that
  // includes whoever just won the race.
  let data: unknown[] | null = null;
  let lastInsertCount = 0;
  let maxBase = 0;
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
    // Get current max sequence for this conversation
    const { data: maxRow, error: maxError } = await db
      .from("conversation_messages")
      .select("sequence")
      .eq("conversation_id", conversationId)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;

    maxBase = maxRow?.sequence ?? 0;
    let nextSequence = maxBase + 1;

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

    const { data: insertData, error: insertError } = await db
      .from("conversation_messages")
      .insert(rows)
      .select(MESSAGE_COLUMNS);

    if (!insertError) {
      data = insertData;
      lastInsertCount = messages.length;
      break;
    }

    if (!isUniqueSequenceViolation(insertError) || attempt === MAX_APPEND_ATTEMPTS - 1) {
      // Non-retryable error, OR we've exhausted retries. Bubble up so the
      // caller can return a 5xx — better than silently dropping messages.
      throw insertError;
    }

    // Race detected — another writer beat us to these sequence numbers.
    // Wait with exponential backoff + jitter, then re-read max and retry.
    // Jitter spreads the retry storm so 10 concurrent losers don't all
    // re-attempt at the same instant and collide again.
    const backoff = APPEND_BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * APPEND_BACKOFF_BASE_MS);
    await new Promise((r) => setTimeout(r, backoff));
  }

  if (!data) {
    // Defensive — should be unreachable, the throw inside the loop covers
    // the exhaustion case. Keeping this prevents a stray TS narrowing
    // error and a silent return of empty array if anyone ever reorders
    // the loop.
    throw new Error("appendMessages: exhausted retries without resolution");
  }

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
      // maxBase is the max(sequence) reading from the FINAL successful
      // attempt — i.e. it already accounts for any concurrent appenders
      // that won earlier rounds. Adding `messages.length` (which is also
      // lastInsertCount) gives the new total.
      message_count: maxBase + lastInsertCount,
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

// --- Phase 03-03: per-project conversation LRU (Free tier) ---

/**
 * Count active conversations in a project. Used by the Free-tier LRU
 * eviction path to decide whether to evict before insert. Counts ALL
 * statuses (active + archived) — the cap is on stored count, not visible
 * count. If a user accumulates 10 archived conversations they can't add
 * an 11th active one without eviction; that's intentional (Plus is the
 * answer for higher capacity).
 */
export async function countConversationsForProject(db: SupabaseClient, projectId: string): Promise<number> {
  const { count, error } = await db
    .from("conversations")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) {
    console.error(`[db] countConversationsForProject ${projectId} failed: ${error.message}`);
    throw error;
  }
  return count ?? 0;
}

/**
 * Evict the oldest conversation in a project by updated_at ASC. Hard
 * delete. Messages cascade-delete via FK constraint (migration 007 —
 * `messages.conversation_id REFERENCES conversations(id) ON DELETE
 * CASCADE`), so this single DELETE drops the conversation + all its
 * messages atomically.
 *
 * Per Phase 03-03 design: eviction is SILENT — no warning, no toast.
 * Returns the evicted ID on success or null on no-op (empty project,
 * select error, delete error). Errors are LOGGED so the daemon log
 * surfaces them, but never thrown — the eviction is a best-effort
 * pre-step; the subsequent create should still succeed even if the
 * eviction failed (the user would just go over-cap by 1 until next
 * eviction attempt).
 */
export async function evictOldestConversationForProject(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data: oldest, error: selErr } = await db
    .from("conversations")
    .select("id")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selErr) {
    console.error(`[db] evictOldestConversationForProject select ${projectId} failed: ${selErr.message}`);
    return null;
  }
  if (!oldest) return null;

  const evictId = (oldest as { id: string }).id;
  const { error: delErr } = await db.from("conversations").delete().eq("id", evictId);
  if (delErr) {
    console.error(`[db] evictOldestConversationForProject delete ${evictId} failed: ${delErr.message}`);
    return null;
  }
  return evictId;
}
