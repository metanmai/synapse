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
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
```

- 768 dimensions matches `nomic-embed-text-v1.5`.
- `ivfflat` with 10 lists is appropriate for hundreds of entries.
- Column is nullable — entries without embeddings work fine, they just don't appear in semantic results.
- `embedding` is internal only — not exposed in the API `Entry` type.

## Search Logic Changes

### `searchEntries()` rewrite (`backend/src/db/queries/entries.ts`)

Current: full-text → ILIKE fallback (serial).
New: semantic + full-text + ILIKE in parallel, merge, deduplicate.

```
1. Call Railway POST /embed { texts: [query], type: "search_query" }
2. In parallel against Supabase:
   a. Semantic: SELECT *, embedding <=> $vector AS distance
      WHERE project_id = $1 AND embedding IS NOT NULL
      ORDER BY distance LIMIT 10
      Filter: distance < 0.7
   b. Full-text: existing websearch query (unchanged)
   c. ILIKE: split query into individual words, OR match each word
      against path and content (fixes current whole-phrase bug)
3. Merge by entry ID — best score wins
4. Return deduplicated, ranked results
```

### Scoring

Normalize scores to 0-1 range for merging:
- Semantic: `1 - cosine_distance` (higher is better)
- Full-text: `ts_rank` normalized
- ILIKE: fixed low score (0.1) — last resort

For entries that appear in multiple result sets, keep the highest score.

### Graceful degradation

If the embedding service is unreachable (network error, timeout), skip the semantic tier entirely. Search falls back to full-text + ILIKE — same as today but with the ILIKE word-splitting fix.

## Write Path Changes

### `upsertEntry()` modification (`backend/src/db/queries/entries.ts`)

After the entry is saved to Supabase:

1. Call Railway `POST /embed { texts: [content], type: "search_document" }`
2. Update the entry's `embedding` column with the returned vector
3. If the embedding call fails, log the error and continue — the entry is saved, just not embedded

This is fire-and-forget from the API response perspective. The client gets the response as soon as the entry is saved. The embedding update happens after.

### Environment

New env var in `wrangler.jsonc`:
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
