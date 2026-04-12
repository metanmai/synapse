# Semantic Search for Synapse

**Date**: 2026-03-24
**Status**: Draft

## Problem

Synapse's current search uses PostgreSQL full-text search (websearch) with an ILIKE substring fallback. Full-text search requires all stemmed terms to match. The ILIKE fallback searches for the entire query as a single literal substring. This means conceptual queries like "code structure architecture overview" return nothing — even if relevant documents exist with different wording.

## Solution

Add semantic (vector) search using embeddings. A self-hosted embedding model converts text into vectors that capture meaning. A query for "auth flow" finds documents about "login and session tokens" because the vectors are close in embedding space.

## Architecture

### Components

1. **Embedding Service** — Standalone FastAPI app on Railway running `nomic-embed-text-v1.5` (768 dimensions). Exposes `POST /embed`. Loosely coupled — the Worker calls it over HTTP, but never depends on it for core functionality.

2. **pgvector in Supabase** — Vectors stored alongside entries in the existing `entries` table. Single DB enables merged semantic + keyword search in one round-trip.

3. **Modified search in Cloudflare Worker** — `searchEntries()` runs semantic, full-text, and ILIKE in parallel, merges and deduplicates results.

### Data flow: Write path

```
Client → Worker (upsertEntry) → Supabase (save entry)
                               → Railway POST /embed { type: "search_document" }
                               → Supabase (UPDATE embedding column)
```

The entry is saved immediately. Embedding is async — if the embedding service is unreachable, the entry exists without a vector and falls back to keyword-only search.

### Data flow: Search path

```
Client → Worker (searchEntries)
           → Railway POST /embed { type: "search_query" } → query vector
           → Supabase (parallel):
               a. Semantic: ORDER BY embedding <=> query_vector, threshold < 0.7
               b. Full-text: websearch on search_vector
               c. ILIKE: split query into words, OR match each word
           → Merge by entry ID, best score wins
           → Return deduplicated ranked results
```

If the embedding service is unreachable, search gracefully degrades to keyword-only (full-text + ILIKE).

## Embedding Service

**Location**: `embedding-service/` directory at project root.

**Stack**: Python, FastAPI, sentence-transformers, uvicorn.

**API**:

```
POST /embed
Authorization: Bearer <shared-api-key>

Request:
{
  "texts": ["text1", "text2"],
  "type": "search_document" | "search_query"
}

Response:
{
  "embeddings": [[0.1, 0.2, ...], ...]
}
```

- `type` controls the Nomic task prefix: `search_document:` for stored content, `search_query:` for user queries. This improves retrieval accuracy — the model optimizes query and document embeddings differently.
- Batch support for backfilling (accepts array of texts).
- Model loaded once at startup, held in memory.
- Secured with a shared API key.
- Error response: `{ "error": "message" }` with appropriate HTTP status (400 for bad input, 500 for model errors).
- Health check: `GET /health` returns `{ "status": "ok", "model": "nomic-embed-text-v1.5" }`. Verifies model is loaded. Used by Railway for health monitoring.

**Files**:

| File | Purpose |
|------|---------|
| `app.py` | FastAPI app, `POST /embed` endpoint |
| `requirements.txt` | sentence-transformers, fastapi, uvicorn |
| `Dockerfile` | Railway deployment |
| `test_embed.py` | Standalone test — no external dependencies |
| `backfill.py` | One-time script to embed all existing entries |

## Database Migration

New migration `005_pgvector.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE entries ADD COLUMN embedding vector(768);

CREATE INDEX entries_embedding_idx ON entries
  USING hnsw (embedding vector_cosine_ops);

-- RPC function for semantic search (Supabase JS client cannot use <=> operator directly)
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
```

- 768 dimensions matches `nomic-embed-text-v1.5`.
- HNSW index — better recall than ivfflat at small scale, no re-indexing needed as data grows.
- Column is nullable — entries without embeddings work fine, they just don't appear in semantic results.
- `embedding` is internal only — not exposed in the API `Entry` type.
- `match_entries` RPC function is required because the Supabase JS client does not support the `<=>` operator. Called via `db.rpc('match_entries', { ... })`.

## Search Logic Changes

### `searchEntries()` rewrite (`backend/src/db/queries/entries.ts`)

Current: full-text → ILIKE fallback (serial).
New: semantic + full-text + ILIKE in parallel, merge, deduplicate.

```
1. Call Railway POST /embed { texts: [query], type: "search_query" }
2. In parallel against Supabase:
   a. Semantic: db.rpc('match_entries', { query_embedding, match_project_id, match_threshold: 0.3 })
   b. Full-text: existing websearch query (unchanged)
   c. ILIKE: split query on whitespace (/\s+/), filter out words < 2 chars,
      OR match each word against path and content
3. Merge by entry ID — best score wins
4. Return Entry[] sorted by score (same return type as today, backward-compatible)
```

### Scoring

Normalize scores to 0-1 range for merging:
- Semantic: `1 - cosine_distance` (higher is better)
- Full-text: `ts_rank` normalized
- ILIKE: fixed low score (0.1) — last resort

For entries that appear in multiple result sets, keep the highest score.

### Return type

`searchEntries()` continues to return `Entry[]` — sorted by score internally but no score field exposed. This is backward-compatible with both callers (REST API in `context.ts` and MCP tool in `context-retrieval.ts`).

### Graceful degradation

If the embedding service is unreachable (network error, timeout > 3s), skip the semantic tier entirely. Search falls back to full-text + ILIKE — same as today but with the ILIKE word-splitting fix.

## Write Path Changes

### `upsertEntry()` modification (`backend/src/db/queries/entries.ts`)

After the entry is saved to Supabase:

1. Call Railway `POST /embed { texts: [content], type: "search_document" }`
2. Update the entry's `embedding` column with the returned vector
3. If the embedding call fails, log the error and continue — the entry is saved, just not embedded

This is fire-and-forget from the API response perspective. The client gets the response as soon as the entry is saved. The embedding update runs via `ctx.waitUntil(embedAndUpdate(...))` — Cloudflare Workers require `waitUntil` for background work after the response is sent, otherwise the runtime kills pending promises.

### Content handling

`nomic-embed-text-v1.5` has an 8192-token context window. For entries exceeding this, prepend the `path` to the content before embedding (so paths like `decisions/chose-svelte.md` always contribute semantic signal), then let the model truncate the tail. This is acceptable for v1 — most Synapse entries are well under 8K tokens.

### Environment

New env vars in `wrangler.jsonc` and the `Env` interface in `backend/src/lib/env.ts`:
- `EMBEDDING_SERVICE_URL` — Railway service URL
- `EMBEDDING_SERVICE_KEY` — shared API key

## Backfill

A standalone script `embedding-service/backfill.py` that:

1. Fetches all entries where `embedding IS NULL`
2. Batches content to `POST /embed` (e.g., 50 at a time)
3. Updates each entry's `embedding` column

Requires `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `EMBEDDING_SERVICE_URL` as env vars. Reusable for model swaps — just clear all embeddings and re-run.

## Testing with Dummy Data

Every piece is testable independently — no external service required:

- **Embedding service**: Starts up, accepts `POST /embed`, returns vectors. Test script sends sample texts, verifies 768-dimension output. No Supabase dependency.
- **Search logic**: Unit-testable with hardcoded vectors. Pass a pre-computed query vector, verify SQL returns ranked results. No embedding service dependency.
- **Backfill script**: Runs against a local Supabase instance with seed entries.
- **Integration**: Seed data with pre-computed embeddings enables end-to-end search testing without Railway.

## Directory Structure

```
synapse/
├── embedding-service/        # New — Railway deployment
│   ├── app.py                # FastAPI, POST /embed endpoint
│   ├── requirements.txt      # sentence-transformers, fastapi, uvicorn
│   ├── Dockerfile            # Railway deployment
│   ├── test_embed.py         # Standalone test
│   └── backfill.py           # One-time backfill script
├── backend/                  # Existing — Cloudflare Worker
│   └── src/
│       ├── db/queries/
│       │   └── entries.ts    # Modified: searchEntries + embed-on-write
│       └── lib/
│           └── embeddings.ts # New: HTTP client for embedding service
├── supabase/
│   └── migrations/
│       └── 005_pgvector.sql  # New: pgvector extension + embedding column
└── ...
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding model | `nomic-embed-text-v1.5` | Best retrieval quality in its size class (MTEB benchmarks), supports query/document prefixes |
| Hosting | Railway (self-hosted) | Full control over model, no vendor lock-in, better results than Workers AI built-ins |
| Vector storage | pgvector in Supabase | Vectors belong with entries, enables single-DB merged search |
| Search strategy | Parallel merge (semantic + full-text + ILIKE) | Best recall — catches conceptual and keyword matches |
| Embed timing | On write, with one-time backfill | Simple, no batch jobs needed for a couple hundred files |
| Failure mode | Graceful degradation to keyword-only | Embedding service is an enhancement, not a hard dependency |
