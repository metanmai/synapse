-- 029_conversation_embeddings.sql
--
-- AI-driven project correlation (spec: docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md).
-- Adds conversation embeddings + assignment provenance so keyless captures
-- (browser / non-code) can be semantically assigned to a project at capture
-- time, and a daily reconciler can merge fragmented projects.
--
-- All additive + nullable: existing conversations keep working with
-- embedding = NULL until the reconciler backfills them. pgvector was enabled
-- in 005_pgvector.sql.

-- Embedding column + HNSW cosine index (mirrors entries in 005).
ALTER TABLE conversations ADD COLUMN embedding vector(768);
CREATE INDEX conversations_embedding_idx ON conversations
  USING hnsw (embedding vector_cosine_ops);

-- Assignment provenance. assignment_method: git | ai_assign | ai_create | manual.
-- "needs LLM recheck" is derived (ai_assign AND confidence < assign threshold),
-- not a stored flag.
ALTER TABLE conversations ADD COLUMN assignment_method text;
ALTER TABLE conversations ADD COLUMN assignment_confidence real;

-- Owner-scoped semantic kNN over conversation embeddings.
-- (Supabase JS client cannot use the <=> operator directly.)
CREATE OR REPLACE FUNCTION match_conversations(
  query_embedding vector(768),
  match_user_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 20
) RETURNS TABLE (
  id uuid,
  project_id uuid,
  similarity float
) LANGUAGE sql STABLE AS $$
  SELECT
    conversations.id,
    conversations.project_id,
    1 - (conversations.embedding <=> query_embedding) AS similarity
  FROM conversations
  WHERE conversations.user_id = match_user_id
    AND conversations.embedding IS NOT NULL
    AND conversations.status = 'active'
    AND 1 - (conversations.embedding <=> query_embedding) > match_threshold
  ORDER BY conversations.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Merge-candidate state: enables 2-run hysteresis so the reconciler only
-- merges a project pair that has qualified across consecutive runs.
-- Pairs are stored canonically ordered (project_low = smaller uuid) to dedupe.
CREATE TABLE project_merge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_low uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_high uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score real NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',  -- pending | merged
  UNIQUE (project_low, project_high)
);
CREATE INDEX idx_merge_candidates_owner ON project_merge_candidates(owner_id);

-- Defense-in-depth (same rationale as 027): accessed exclusively by the
-- backend via SUPABASE_SERVICE_KEY (service-role bypasses RLS). No anon/auth
-- policies = deny-by-default.
ALTER TABLE project_merge_candidates ENABLE ROW LEVEL SECURITY;
