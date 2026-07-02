export type InsightType = "decision" | "learning" | "preference" | "architecture" | "action_item";

export interface InsightSource {
  type: "conversation" | "session" | "manual" | "consolidation";
  id?: string;
  agent?: string;
}

export interface Insight {
  id: string;
  project_id: string;
  user_id: string;
  type: InsightType;
  summary: string;
  detail: string | null;
  source: InsightSource | null;
  encrypted: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Curation pointer (migration 024). When set, this insight has been
   * replaced by the insight at `superseded_by` and should be hidden from
   * default brief / list queries (those filter `superseded_by IS NULL`).
   * `null` for active rows.
   */
  superseded_by: string | null;
}

export interface InsightListItem {
  id: string;
  type: InsightType;
  summary: string;
  source: InsightSource | null;
  created_at: string;
  updated_at: string;
  /** See `Insight.superseded_by`. */
  superseded_by: string | null;
}
