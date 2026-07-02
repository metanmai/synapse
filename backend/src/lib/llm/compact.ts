import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMessages,
  getProjectContext,
  getRecentCompactedSummaries,
  updateCompaction,
  upsertProjectContext,
} from "../../db/queries/conversations";
import { AnthropicProvider } from "./anthropic";
import { buildAggregationPrompt, buildCompactionPrompt, truncateMessages } from "./prompts";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_COMPACTION_MESSAGES = 200;
// Per-conversation compaction output cap. ~750 words is enough to summarize
// a single conversation's working memory; this is the INPUT to aggregation
// below, so we keep it tight to avoid blowing up that downstream prompt.
const COMPACTION_MAX_TOKENS = 1024;
// Project-level aggregation output cap. ~3000 words gives the LLM room to
// finish the thought when synthesizing 5+ rich conversation summaries —
// previously 1024 (≈750 words) was truncating mid-UUID on detailed projects
// (visible in the user-facing "Project Context" tab as `...` at the end).
const AGGREGATION_MAX_TOKENS = 4096;

export interface CompactResult {
  summary: string;
  model: string;
  messageCount: number;
}

export async function compactConversation(
  db: SupabaseClient,
  conversationId: string,
  title: string | null,
  apiKey: string,
  model?: string,
): Promise<CompactResult> {
  const llmModel = model ?? DEFAULT_MODEL;
  const provider = new AnthropicProvider(apiKey, llmModel);

  const allMessages = await getMessages(db, conversationId);
  const truncated = truncateMessages(allMessages, MAX_COMPACTION_MESSAGES);

  const prompt = buildCompactionPrompt(truncated, title);
  const summary = await provider.complete(prompt, COMPACTION_MAX_TOKENS);

  await updateCompaction(db, conversationId, summary, llmModel);

  return { summary, model: llmModel, messageCount: allMessages.length };
}

export async function aggregateProjectContext(
  db: SupabaseClient,
  projectId: string,
  apiKey: string,
  model?: string,
): Promise<string> {
  const llmModel = model ?? DEFAULT_MODEL;
  const provider = new AnthropicProvider(apiKey, llmModel);

  const recent = await getRecentCompactedSummaries(db, projectId, 5);
  const existing = await getProjectContext(db, projectId);

  if (recent.length === 0) {
    return existing?.summary ?? "";
  }

  const prompt = buildAggregationPrompt(
    recent.map((r) => r.compacted_summary),
    existing?.summary ?? null,
  );

  const summary = await provider.complete(prompt, AGGREGATION_MAX_TOKENS);

  await upsertProjectContext(db, projectId, summary, recent.length, llmModel);

  return summary;
}
