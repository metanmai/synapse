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
  const transcript = messages
    .map((m) => `[${m.role}] ${m.content ?? "(empty)"}`)
    .join("\n\n");

  const titleLine = title ? `\nConversation title: ${title}\n` : "";

  return `Summarize this AI coding session into a dense context document. An AI agent will read this to continue the work. Include: what was built, key decisions made, current state, and any unfinished work. Be specific — include file paths, function names, and technical details. Omit pleasantries and routine exchanges.
${titleLine}
## Transcript (${messages.length} messages)

${transcript}`;
}

export function buildAggregationPrompt(
  recentSummaries: string[],
  existingContext: string | null,
): string {
  const summariesSection = recentSummaries
    .map((s, i) => `### Session ${i + 1}\n${s}`)
    .join("\n\n");

  const existingSection = existingContext
    ? `\n## Existing project context\n${existingContext}\n`
    : "";

  return `You are given summaries of recent AI coding sessions for a project, plus an existing project context summary. Merge them into a single updated project context. Preserve important decisions, architecture details, and current state. Remove outdated information that's been superseded by newer sessions. Keep it under 2000 words.
${existingSection}
## Recent session summaries

${summariesSection}`;
}
