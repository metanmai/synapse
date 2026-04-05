import type { ConversationMessage } from "$lib/types";

export const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: "rgba(22, 163, 74, 0.12)", text: "#16a34a" },
  archived: { bg: "rgba(107, 114, 128, 0.12)", text: "#6b7280" },
  deleted: { bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626" },
};

export function formatRelativeDate(iso: string, now?: Date): string {
  const d = new Date(iso);
  const ref = now ?? new Date();
  const diffMs = ref.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== ref.getFullYear() ? "numeric" : undefined,
  });
}

export const agentColors: Record<string, string> = {
  "claude-code": "#ea580c",
  claude: "#ea580c",
  chatgpt: "#16a34a",
  gpt: "#16a34a",
  gemini: "#2563eb",
};

export function getAgentColor(agent: string): string {
  const lower = agent.toLowerCase();
  for (const [key, color] of Object.entries(agentColors)) {
    if (lower.includes(key)) return color;
  }
  return "#6b7280";
}

export const roleLabels: Record<string, { label: string; color: string }> = {
  user: { label: "User", color: "var(--color-accent)" },
  assistant: { label: "Assistant", color: "#ea580c" },
  system: { label: "System", color: "#6b7280" },
  tool: { label: "Tool", color: "#9333ea" },
};

export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function toolSummary(msg: Pick<ConversationMessage, "tool_interaction">): string {
  if (!msg.tool_interaction) return "";
  return msg.tool_interaction.summary || `Called ${msg.tool_interaction.name}`;
}

export function pluralizeMessages(count: number): string {
  return `${count} message${count === 1 ? "" : "s"}`;
}

export const toolBadgeColors: Record<string, { bg: string; text: string }> = {
  "claude-code": { bg: "rgba(86, 28, 36, 0.08)", text: "#561c24" },
  cursor: { bg: "rgba(59, 130, 246, 0.08)", text: "#2563eb" },
  codex: { bg: "rgba(16, 185, 129, 0.08)", text: "#059669" },
  gemini: { bg: "rgba(168, 85, 247, 0.08)", text: "#7c3aed" },
};

export const defaultToolBadge = { bg: "rgba(107, 114, 128, 0.08)", text: "#6b7280" };

export function getToolBadge(tool: string | undefined | null): { bg: string; text: string } {
  if (!tool) return defaultToolBadge;
  return toolBadgeColors[tool] ?? defaultToolBadge;
}

export function getToolLabel(tool: string | undefined | null): string {
  if (!tool) return "Unknown";
  const labels: Record<string, string> = {
    "claude-code": "Claude Code",
    cursor: "Cursor",
    codex: "Codex",
    gemini: "Gemini",
  };
  return labels[tool] ?? tool;
}
