// Capture-time AI project resolution for keyless captures (browser / non-code).
// Embeds the seed text, finds the most similar existing projects via kNN, and
// decides assign-vs-create. Returns null whenever embeddings are unavailable so
// the caller can fall back to the deterministic git/host-bucket path.
// Spec: docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md

import type { SupabaseClient } from "@supabase/supabase-js";
import { PROJECT_ASSIGN_THRESHOLD, PROJECT_CREATE_THRESHOLD } from "./constants";
import { embedTexts, embeddingConfigFromEnv } from "./embeddings";
import { type AssignmentDecision, type Candidate, decideAssignment } from "./project-correlation";

import { matchConversations } from "../db/queries/conversations";

export interface AiResolveResult {
  /** pgvector text form of the seed embedding, for storage on the conversation. */
  embedding: string;
  decision: AssignmentDecision;
}

export async function aiResolveProject(
  db: SupabaseClient,
  env: { EMBEDDING_SERVICE_URL?: string; EMBEDDING_SERVICE_KEY?: string },
  userId: string,
  seed: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<AiResolveResult | null> {
  const vecs = await embedTexts([seed], "search_document", embeddingConfigFromEnv(env), fetchFn);
  if (!vecs || !vecs[0]) return null; // service unconfigured/down → caller falls back

  const embedding = vecs[0];
  const rows = await matchConversations(db, userId, embedding, PROJECT_CREATE_THRESHOLD);

  // Collapse per-conversation hits into per-project candidates (best score wins).
  const byProject = new Map<string, number>();
  for (const r of rows) {
    byProject.set(r.project_id, Math.max(byProject.get(r.project_id) ?? 0, r.similarity));
  }
  const candidates: Candidate[] = [...byProject].map(([projectId, score]) => ({ projectId, score }));

  const decision = decideAssignment(candidates, {
    assign: PROJECT_ASSIGN_THRESHOLD,
    create: PROJECT_CREATE_THRESHOLD,
  });
  return { embedding: JSON.stringify(embedding), decision };
}
