interface MessageLike {
  role: string;
  content: string | null;
}

export function truncateMessages(messages: MessageLike[], maxMessages: number): MessageLike[] {
  if (messages.length <= maxMessages) return messages;
  const headCount = 10;
  const tailCount = maxMessages - headCount;
  const head = messages.slice(0, headCount);
  const tail = messages.slice(-tailCount);
  return [...head, ...tail];
}

export function buildCompactionPrompt(messages: MessageLike[], title?: string | null): string {
  const transcript = messages.map((m) => `[${m.role}] ${m.content ?? "(empty)"}`).join("\n\n");

  const titleLine = title ? `\nConversation title: ${title}\n` : "";

  return `Summarize this AI coding session into a dense context document. An AI agent will read this to continue the work. Include: what was built, key decisions made, current state, and any unfinished work. Be specific — include file paths, function names, and technical details. Omit pleasantries and routine exchanges.
${titleLine}
## Transcript (${messages.length} messages)

${transcript}`;
}

export function buildAggregationPrompt(recentSummaries: string[], existingContext: string | null): string {
  const summariesSection = recentSummaries.map((s, i) => `### Session ${i + 1}\n${s}`).join("\n\n");

  const existingSection = existingContext ? `\n## Existing project context\n${existingContext}\n` : "";

  return `You are given summaries of recent AI coding sessions for a project, plus an existing project context summary. Merge them into a single updated project context. Preserve important decisions, architecture details, and current state. Remove outdated information that's been superseded by newer sessions. Keep it under 2000 words.
${existingSection}
## Recent session summaries

${summariesSection}`;
}

// --- Phase 03-04: Plus insight LLM consolidation ---

export interface InsightForConsolidation {
  id: string;
  type: string;
  summary: string;
  detail: string | null;
  updated_at: string;
}

/**
 * Prompt for the Plus-tier insight consolidation pass. Given N oldest active
 * insights, produces 3-5 merged replacements (each ≤12-word summary, ≤2-
 * sentence detail). The output contract is JSON ONLY — no preamble, no
 * postamble, no markdown fence — because parseConsolidationResponse parses
 * it directly via JSON.parse. The parser strips a fence defensively, but
 * the cleanest path is no fence at all.
 */
export function buildInsightConsolidationPrompt(insights: InsightForConsolidation[]): string {
  const lines = insights.map(
    (i, idx) => `${idx + 1}. [${i.type}] ${i.summary}${i.detail ? ` — ${i.detail}` : ""} (updated ${i.updated_at})`,
  );

  return `You are consolidating ${insights.length} older insights from an AI coding project into 3-5 merged replacements. Preserve the load-bearing facts; drop transient or already-completed items.

RULES (HARD):
- Output ONLY a JSON array. No preamble. No postamble. No markdown code fence.
- Maximum 5 items. Minimum 3 (unless the source genuinely collapses to fewer distinct facts).
- Each item: {"type": "<one of: decision, learning, preference, architecture, action_item>", "summary": "<string, ≤12 words>", "detail": "<string, ≤2 sentences — OR omit the field entirely if no detail needed>"}
- Combine near-duplicates into a single entry.
- If multiple older insights point to the same fact, keep one merged version.
- If an action_item is now complete (referenced by a later decision), drop it.
- Be concise — these appear in every future SessionStart brief, so every word costs context budget.

INPUT INSIGHTS:
${lines.join("\n")}

OUTPUT (JSON array only, starting with '['):`;
}
