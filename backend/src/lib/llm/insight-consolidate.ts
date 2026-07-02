import type { SupabaseClient } from "@supabase/supabase-js";
import { createInsight, getOldestActiveInsights } from "../../db/queries/insights";
import { AnthropicProvider } from "./anthropic";
import { buildInsightConsolidationPrompt } from "./prompts";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const CONSOLIDATION_MAX_TOKENS = 2048;
/**
 * How many oldest active insights to merge per consolidation pass.
 * Plus cap is 50; pulling 10 oldest each pass means the user briefly sees
 * 51 active (insert happens before consolidation), then drops to ~44-46
 * (51 + 3 to 5 replacements − 10 supersedes-stamped = 44-46) within ~5-15s.
 * Next overflow at 51 triggers another pass.
 */
export const OVERFLOW_CHUNK = 10;

export interface ConsolidationReplacement {
  type: "decision" | "learning" | "preference" | "architecture" | "action_item";
  summary: string;
  detail?: string;
}

export interface ConsolidationResult {
  consolidated: number; // count of originals superseded (0 on failure)
  replacements: number; // count of new replacement insights written
  error?: "llm_failed" | "no_valid_replacements" | "no_oldest";
}

const VALID_TYPES = new Set(["decision", "learning", "preference", "architecture", "action_item"]);

/**
 * Parse the LLM's JSON-array response into validated replacement records.
 * Defense-in-depth: strips a markdown code fence if the model leaked one,
 * tolerates trailing whitespace, validates each item's shape (type in
 * enum, non-empty summary, optional string detail), drops malformed items
 * rather than failing the whole batch. Returns [] on completely-invalid
 * input — the caller treats empty as "skip eviction this round."
 */
export function parseConsolidationResponse(raw: string): ConsolidationReplacement[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: ConsolidationReplacement[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.type !== "string" || !VALID_TYPES.has(o.type)) continue;
    if (typeof o.summary !== "string" || o.summary.trim().length === 0) continue;
    if (o.detail !== undefined && typeof o.detail !== "string") continue;
    out.push({
      type: o.type as ConsolidationReplacement["type"],
      summary: o.summary.trim(),
      detail: typeof o.detail === "string" ? o.detail.trim() : undefined,
    });
  }
  return out;
}

/**
 * Plus-tier insight consolidation pass. Pulls the oldest OVERFLOW_CHUNK
 * active insights, asks Haiku to produce 3-5 merged replacements, writes
 * them via createInsight() with supersedes:[10 originals]. The originals
 * stay in the table (superseded_by stamped) for audit; default queries
 * exclude them.
 *
 * Compensation: returns a non-throwing ConsolidationResult. On LLM call
 * failure, on empty/invalid parse, or on no-oldest, the user is left
 * temporarily over-cap. The daily cron (retry-consolidations.ts) catches
 * up — re-runs this for any Plus project that is still over 50 active.
 *
 * Mirrors the shape of backend/src/lib/llm/compact.ts so future
 * maintainers see one consistent LLM-call pattern across the codebase.
 */
export async function consolidateOldestInsights(
  db: SupabaseClient,
  projectId: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
): Promise<ConsolidationResult> {
  const provider = new AnthropicProvider(apiKey, model);

  let oldest: Awaited<ReturnType<typeof getOldestActiveInsights>>;
  try {
    oldest = await getOldestActiveInsights(db, projectId, OVERFLOW_CHUNK);
  } catch (e) {
    console.error(
      `[consolidate] getOldestActiveInsights failed for ${projectId}: ${e instanceof Error ? e.message : e}`,
    );
    return { consolidated: 0, replacements: 0, error: "llm_failed" };
  }
  if (oldest.length === 0) {
    return { consolidated: 0, replacements: 0, error: "no_oldest" };
  }

  const prompt = buildInsightConsolidationPrompt(
    oldest.map((o) => ({
      id: o.id,
      type: o.type,
      summary: o.summary,
      detail: o.detail,
      updated_at: o.updated_at,
    })),
  );

  let raw: string;
  try {
    raw = await provider.complete(prompt, CONSOLIDATION_MAX_TOKENS);
  } catch (e) {
    console.error(`[consolidate] LLM call failed for ${projectId}: ${e instanceof Error ? e.message : e}`);
    return { consolidated: 0, replacements: 0, error: "llm_failed" };
  }

  const replacements = parseConsolidationResponse(raw);
  if (replacements.length === 0) {
    console.warn(`[consolidate] LLM returned no valid replacements for ${projectId} (raw head: ${raw.slice(0, 200)})`);
    return { consolidated: 0, replacements: 0, error: "no_valid_replacements" };
  }

  const originalIds = oldest.map((o) => o.id);
  const userId = oldest[0].user_id;

  let writeCount = 0;
  for (const r of replacements) {
    try {
      await createInsight(db, {
        project_id: projectId,
        user_id: userId,
        type: r.type,
        summary: r.summary,
        detail: r.detail ?? null,
        source: { type: "consolidation", agent: "haiku" },
        supersedes: originalIds,
      });
      writeCount++;
    } catch (e) {
      console.error(
        `[consolidate] createInsight failed for ${projectId} (replacement ${writeCount + 1}/${replacements.length}): ${e instanceof Error ? e.message : e}`,
      );
      // Continue — partial replacement is better than rollback. The first
      // successful write already stamps supersedes on the originals; subsequent
      // failures just mean fewer replacements than the LLM proposed.
    }
  }

  return { consolidated: writeCount > 0 ? oldest.length : 0, replacements: writeCount };
}
