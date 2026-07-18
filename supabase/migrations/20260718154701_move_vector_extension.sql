-- Move pgvector out of the API-exposed public schema.
--
-- Supabase's security advisor flags extensions installed in public because
-- their objects become part of the application's primary API schema. Keep the
-- application RPCs in public, but explicitly qualify pgvector's type,
-- operator, and operator class from the dedicated extensions schema.

CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- Repair production drift from 005_pgvector.sql, which was recorded as
-- applied even though the entry embedding column, index, and RPC were absent.
ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(768);

CREATE INDEX IF NOT EXISTS entries_embedding_idx
  ON public.entries USING hnsw (embedding extensions.vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_entries(
  query_embedding extensions.vector(768),
  match_project_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 10
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
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT
    entries.id,
    entries.project_id,
    entries.path,
    entries.content,
    entries.content_type,
    entries.author_id,
    entries.source,
    entries.tags,
    entries.google_doc_id,
    entries.created_at,
    entries.updated_at,
    1 - (entries.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.entries
  WHERE entries.project_id = match_project_id
    AND entries.embedding IS NOT NULL
    AND 1 - (entries.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
  ORDER BY entries.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$function$;

CREATE OR REPLACE FUNCTION public.match_conversations(
  query_embedding extensions.vector(768),
  match_user_id uuid,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 20
) RETURNS TABLE (
  id uuid,
  project_id uuid,
  similarity double precision
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT
    conversations.id,
    conversations.project_id,
    1 - (conversations.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.conversations
  WHERE conversations.user_id = match_user_id
    AND conversations.embedding IS NOT NULL
    AND conversations.status = 'active'
    AND 1 - (conversations.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
  ORDER BY conversations.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$function$;

CREATE OR REPLACE FUNCTION public.find_merge_candidates(
  match_user_id uuid,
  sim_threshold double precision,
  max_pairs integer DEFAULT 20
) RETURNS TABLE (
  project_a uuid,
  project_b uuid,
  score double precision
)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT
    a.project_id AS project_a,
    b.project_id AS project_b,
    max(1 - (a.embedding OPERATOR(extensions.<=>) b.embedding)) AS score
  FROM public.conversations a
  JOIN public.conversations b
    ON a.user_id = b.user_id
   AND a.project_id < b.project_id
  WHERE a.user_id = match_user_id
    AND a.embedding IS NOT NULL
    AND b.embedding IS NOT NULL
    AND a.status = 'active'
    AND b.status = 'active'
    AND 1 - (a.embedding OPERATOR(extensions.<=>) b.embedding) > sim_threshold
  GROUP BY a.project_id, b.project_id
  ORDER BY score DESC
  LIMIT max_pairs;
$function$;

-- These RPCs are backend-only. The Worker uses the service-role client; browser
-- roles must not be able to invoke project- or owner-scoped semantic searches.
REVOKE EXECUTE ON FUNCTION public.match_entries(extensions.vector, uuid, double precision, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_conversations(extensions.vector, uuid, double precision, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_merge_candidates(uuid, double precision, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_entries(extensions.vector, uuid, double precision, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.match_conversations(extensions.vector, uuid, double precision, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.find_merge_candidates(uuid, double precision, integer)
  TO service_role;
