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
const COMPACTION_MAX_TOKENS = 1024;
const AGGREGATION_MAX_TOKENS = 1024;

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
