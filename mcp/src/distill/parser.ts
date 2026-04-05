export interface ExtractedFile {
  path: string;
  content: string;
  tags: string[];
}

export function parseResponse(raw: string): ExtractedFile[] {
  // Strip markdown code fencing if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const e = entry as Record<string, unknown>;
      return typeof e.path === "string" && e.path.length > 0 && typeof e.content === "string" && e.content.length > 0;
    })
    .map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      return {
        path: e.path as string,
        content: e.content as string,
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : [],
      };
    });
}
