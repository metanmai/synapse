export type InsightType = "decision" | "learning" | "preference" | "architecture" | "action_item";

export interface InsightSource {
  type: "conversation" | "session" | "manual";
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
}

export interface InsightListItem {
  id: string;
  type: InsightType;
  summary: string;
  source: InsightSource | null;
  created_at: string;
  updated_at: string;
}
