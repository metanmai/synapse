export const badgeColors: Record<string, { bg: string; text: string }> = {
  decision: { bg: "rgba(37, 99, 235, 0.12)", text: "#2563eb" },
  learning: { bg: "rgba(22, 163, 74, 0.12)", text: "#16a34a" },
  preference: { bg: "rgba(147, 51, 234, 0.12)", text: "#9333ea" },
  architecture: { bg: "rgba(234, 88, 12, 0.12)", text: "#ea580c" },
  action_item: { bg: "rgba(220, 38, 38, 0.12)", text: "#dc2626" },
};

export function getBadgeColor(type: string): { bg: string; text: string } {
  return badgeColors[type] ?? { bg: "rgba(0,0,0,0.08)", text: "inherit" };
}

export function formatInsightDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatInsightType(type: string): string {
  return type.replace("_", " ");
}
