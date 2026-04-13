-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to entries (nullable — entries work without embeddings)
ALTER TABLE entries ADD COLUMN embedding vector(768);

-- HNSW index for cosine similarity search
CREATE INDEX entries_embedding_idx ON entries
  USING hnsw (embedding vector_cosine_ops);

-- RPC function for semantic search
-- (Supabase JS client cannot use the <=> operator directly)
CREATE OR REPLACE FUNCTION match_entries(
  query_embedding vector(768),
  match_project_id uuid,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
) RETURNS TABLE (
  id uuid,
  project_id uuid,
  path text,
  content text,
  content_type text,
  author_id uuid,
  source text,
  tags text[],
  google_doc_id text,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
) LANGUAGE sql STABLE AS $$
  SELECT
    entries.id, entries.project_id, entries.path, entries.content,
    entries.content_type, entries.author_id, entries.source, entries.tags,
    entries.google_doc_id, entries.created_at, entries.updated_at,
    1 - (entries.embedding <=> query_embedding) AS similarity
  FROM entries
  WHERE entries.project_id = match_project_id
    AND entries.embedding IS NOT NULL
    AND 1 - (entries.embedding <=> query_embedding) > match_threshold
  ORDER BY entries.embedding <=> query_embedding
  LIMIT match_count;
$$;
