# Semantic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic search to Synapse so conceptual queries ("auth flow") find relevant documents even when they use different wording ("login and session tokens").

**Architecture:** A self-hosted FastAPI embedding service on Railway runs `nomic-embed-text-v1.5`. The Cloudflare Worker calls it to embed content on write and queries on search. Vectors are stored via pgvector in the existing Supabase `entries` table. Search runs semantic, full-text, and ILIKE in parallel, merges and deduplicates results.

**Tech Stack:** Python/FastAPI/sentence-transformers (embedding service), pgvector (Supabase), TypeScript/Hono (Cloudflare Worker)

**Spec:** `docs/superpowers/specs/2026-03-24-semantic-search-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `embedding-service/app.py` | FastAPI app: `POST /embed`, `GET /health` |
| `embedding-service/requirements.txt` | Python dependencies |
| `embedding-service/Dockerfile` | Railway deployment container |
| `embedding-service/test_embed.py` | Standalone tests for the embedding service |
| `embedding-service/backfill.py` | One-time script to embed existing entries |
| `supabase/migrations/005_pgvector.sql` | pgvector extension, embedding column, HNSW index, `match_entries` RPC |
| `backend/src/lib/embeddings.ts` | HTTP client for the embedding service |
| `backend/test/lib/embeddings.test.ts` | Tests for embedding client |
| `backend/test/db/search-merge.test.ts` | Tests for search merge/dedup logic |
| `embedding-service/requirements-backfill.txt` | Python dependencies for backfill script |
| `embedding-service/.gitignore` | Ignore `__pycache__/`, `.venv/`, model cache |

### Modified files
| File | What changes |
|------|-------------|
| `backend/src/lib/env.ts` | Add `EMBEDDING_SERVICE_URL` and `EMBEDDING_SERVICE_KEY` to `Env` interface |
| `backend/src/db/queries/entries.ts` | Rewrite `searchEntries()`, add `updateEmbedding()`, extract merge logic |
| `backend/src/api/context.ts` | Add `ctx.waitUntil` embedding call after upsert in `/save`, `/file`, `/session-summary`, and `/restore` routes |
| `backend/src/db/queries/entries.ts` | Exclude `embedding` column from all `select("*")` queries |
| `backend/wrangler.jsonc` | Add `EMBEDDING_SERVICE_URL` and `EMBEDDING_SERVICE_KEY` vars |

---

## Task 1: Embedding Service — Core

**Files:**
- Create: `embedding-service/app.py`
- Create: `embedding-service/requirements.txt`

- [ ] **Step 1: Create `requirements.txt`**

```
sentence-transformers==4.1.0
fastapi==0.115.12
uvicorn==0.34.3
```

- [ ] **Step 2: Write `app.py` with health and embed endpoints**

```python
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

model: SentenceTransformer | None = None

VALID_TYPES = {"search_document", "search_query"}
API_KEY = os.environ.get("EMBED_API_KEY", "")

security = HTTPBearer()


def verify_key(credentials: HTTPAuthorizationCredentials = Security(security)) -> None:
    if API_KEY and credentials.credentials != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    model = SentenceTransformer("nomic-ai/nomic-embed-text-v1.5", trust_remote_code=True)
    yield


app = FastAPI(lifespan=lifespan)


class EmbedRequest(BaseModel):
    texts: list[str]
    type: str = "search_document"


@app.get("/health")
def health():
    return {
        "status": "ok" if model is not None else "loading",
        "model": "nomic-embed-text-v1.5",
    }


@app.post("/embed")
def embed(req: EmbedRequest, _: None = Security(verify_key)):
    if req.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {VALID_TYPES}")
    if not req.texts:
        raise HTTPException(status_code=400, detail="texts must be a non-empty list")
    if model is None:
        raise HTTPException(status_code=503, detail="Model is still loading")

    prefixed = [f"{req.type}: {t}" for t in req.texts]
    embeddings = model.encode(prefixed, normalize_embeddings=True)
    return {"embeddings": embeddings.tolist()}
```

- [ ] **Step 3: Verify it starts locally**

Run: `cd embedding-service && pip install -r requirements.txt && uvicorn app:app --port 8787`
Expected: Server starts, model downloads on first run (~270MB), logs "Application startup complete"

- [ ] **Step 4: Smoke test manually**

Run: `curl -X POST http://localhost:8787/embed -H "Content-Type: application/json" -d '{"texts": ["hello world"], "type": "search_query"}'`
Expected: JSON response with `embeddings` array containing one array of 768 floats

- [ ] **Step 5: Commit**

```bash
git add embedding-service/app.py embedding-service/requirements.txt
git commit -m "feat: add embedding service with nomic-embed-text-v1.5"
```

---

## Task 2: Embedding Service — Tests

**Files:**
- Create: `embedding-service/test_embed.py`

- [ ] **Step 1: Write standalone test file**

```python
"""Standalone tests for the embedding service. No external dependencies required."""
import pytest
from fastapi.testclient import TestClient

# Patch env before importing app
import os
os.environ["EMBED_API_KEY"] = "test-key"

from app import app

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-key"}


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model"] == "nomic-embed-text-v1.5"


def test_embed_single_text():
    resp = client.post("/embed", json={"texts": ["hello world"], "type": "search_query"}, headers=AUTH)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["embeddings"]) == 1
    assert len(body["embeddings"][0]) == 768


def test_embed_batch():
    resp = client.post(
        "/embed",
        json={"texts": ["first doc", "second doc", "third doc"], "type": "search_document"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["embeddings"]) == 3
    for emb in body["embeddings"]:
        assert len(emb) == 768


def test_embed_query_vs_document_differ():
    """search_query and search_document prefixes produce different embeddings for the same text."""
    text = "authentication flow"
    resp_q = client.post("/embed", json={"texts": [text], "type": "search_query"}, headers=AUTH)
    resp_d = client.post("/embed", json={"texts": [text], "type": "search_document"}, headers=AUTH)
    vec_q = resp_q.json()["embeddings"][0]
    vec_d = resp_d.json()["embeddings"][0]
    assert vec_q != vec_d


def test_embed_empty_texts_rejected():
    resp = client.post("/embed", json={"texts": [], "type": "search_query"}, headers=AUTH)
    assert resp.status_code == 400


def test_embed_invalid_type_rejected():
    resp = client.post("/embed", json={"texts": ["hi"], "type": "invalid"}, headers=AUTH)
    assert resp.status_code == 400


def test_embed_no_auth_rejected():
    resp = client.post("/embed", json={"texts": ["hi"], "type": "search_query"})
    assert resp.status_code == 403


def test_embed_wrong_key_rejected():
    resp = client.post(
        "/embed",
        json={"texts": ["hi"], "type": "search_query"},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests**

Run: `cd embedding-service && pip install pytest && pytest test_embed.py -v`
Expected: All 8 tests pass

- [ ] **Step 3: Commit**

```bash
git add embedding-service/test_embed.py
git commit -m "test: add embedding service tests"
```

---

## Task 3: Embedding Service — Dockerfile

**Files:**
- Create: `embedding-service/Dockerfile`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time so startup is fast
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', trust_remote_code=True)"

COPY app.py .

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 2: Test Docker build**

Run: `cd embedding-service && docker build -t synapse-embed .`
Expected: Build completes, model is downloaded during build

- [ ] **Step 3: Test Docker run**

Run: `docker run -p 8787:8080 -e EMBED_API_KEY=test synapse-embed`
Then: `curl http://localhost:8787/health`
Expected: `{"status": "ok", "model": "nomic-embed-text-v1.5"}`

- [ ] **Step 4: Commit**

```bash
git add embedding-service/Dockerfile
git commit -m "feat: add Dockerfile for embedding service"
```

---

## Task 4: Database Migration

**Files:**
- Create: `supabase/migrations/005_pgvector.sql`

- [ ] **Step 1: Write migration**

```sql
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
```

- [ ] **Step 2: Verify migration is valid SQL**

Run: `cd supabase && supabase db push --dry-run` (if local Supabase is set up)
Or: review manually — the SQL is straightforward

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_pgvector.sql
git commit -m "feat: add pgvector migration with match_entries RPC"
```

---

## Task 5: Embedding Client (`backend/src/lib/embeddings.ts`)

**Files:**
- Modify: `backend/src/lib/env.ts:1-37` (add env vars to `Env` interface)
- Create: `backend/src/lib/embeddings.ts`
- Create: `backend/test/lib/embeddings.test.ts`

- [ ] **Step 1: Add env vars to `Env` interface**

In `backend/src/lib/env.ts`, add these two fields to the `Env` interface after the `ACTIVITY_PAGE_LIMIT` line:

```typescript
  // Embedding service (optional — semantic search degrades gracefully without it)
  EMBEDDING_SERVICE_URL?: string;
  EMBEDDING_SERVICE_KEY?: string;
```

- [ ] **Step 2: Write the test file**

Create `backend/test/lib/embeddings.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { embedTexts, type EmbeddingConfig } from "../../src/lib/embeddings";

const FAKE_VECTOR = Array.from({ length: 768 }, (_, i) => i / 768);

function makeConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  return {
    url: "http://fake-embed:8080",
    key: "test-key",
    timeoutMs: 3000,
    ...overrides,
  };
}

describe("embedTexts", () => {
  it("returns embeddings on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embeddings: [FAKE_VECTOR] }),
    });

    const result = await embedTexts(
      ["hello world"],
      "search_query",
      makeConfig(),
      mockFetch,
    );

    expect(result).toEqual([FAKE_VECTOR]);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://fake-embed:8080/embed");
    expect(opts.headers["Authorization"]).toBe("Bearer test-key");
    expect(JSON.parse(opts.body)).toEqual({
      texts: ["hello world"],
      type: "search_query",
    });
  });

  it("returns null when service returns non-ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal error"),
    });

    const result = await embedTexts(
      ["hello"],
      "search_query",
      makeConfig(),
      mockFetch,
    );

    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network error)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const result = await embedTexts(
      ["hello"],
      "search_query",
      makeConfig(),
      mockFetch,
    );

    expect(result).toBeNull();
  });

  it("returns null when config has no URL", async () => {
    const mockFetch = vi.fn();

    const result = await embedTexts(
      ["hello"],
      "search_query",
      makeConfig({ url: undefined }),
      mockFetch,
    );

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/lib/embeddings.test.ts`
Expected: FAIL — module `../../src/lib/embeddings` does not exist

- [ ] **Step 4: Write the embedding client**

Create `backend/src/lib/embeddings.ts`:

```typescript
export interface EmbeddingConfig {
  url?: string;
  key?: string;
  timeoutMs?: number;
}

type EmbedType = "search_query" | "search_document";

/**
 * Call the embedding service to get vectors for the given texts.
 * Returns null on any failure (network, timeout, bad response) — caller
 * should degrade gracefully.
 *
 * Accepts an optional fetchFn for testing (defaults to global fetch).
 */
export async function embedTexts(
  texts: string[],
  type: EmbedType,
  config: EmbeddingConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<number[][] | null> {
  if (!config.url) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 3000);

    const resp = await fetchFn(`${config.url}/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key ?? ""}`,
      },
      body: JSON.stringify({ texts, type }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`[embeddings] Service returned ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data = (await resp.json()) as { embeddings: number[][] };
    return data.embeddings;
  } catch (err) {
    console.error(`[embeddings] Failed to embed: ${err}`);
    return null;
  }
}

/**
 * Build EmbeddingConfig from Worker env vars.
 */
export function embeddingConfigFromEnv(env: {
  EMBEDDING_SERVICE_URL?: string;
  EMBEDDING_SERVICE_KEY?: string;
}): EmbeddingConfig {
  return {
    url: env.EMBEDDING_SERVICE_URL,
    key: env.EMBEDDING_SERVICE_KEY,
    timeoutMs: 3000,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/lib/embeddings.test.ts`
Expected: All 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/env.ts backend/src/lib/embeddings.ts backend/test/lib/embeddings.test.ts
git commit -m "feat: add embedding service client with graceful degradation"
```

---

## Task 6: Rewrite `searchEntries()`

**Files:**
- Modify: `backend/src/db/queries/entries.ts:94-142`
- Create: `backend/test/db/search-merge.test.ts`

- [ ] **Step 1: Write search merge tests**

Create `backend/test/db/search-merge.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mergeSearchResults, buildIlikeWords } from "../../src/db/search-helpers";
import type { Entry } from "../../src/db/types";

const BASE_ENTRY: Entry = {
  id: "aaa",
  project_id: "proj1",
  path: "test/doc.md",
  content: "test content",
  content_type: "markdown",
  author_id: null,
  source: "human",
  tags: [],
  google_doc_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function entry(overrides: Partial<Entry>): Entry {
  return { ...BASE_ENTRY, ...overrides };
}

describe("mergeSearchResults", () => {
  it("deduplicates entries by id, keeping highest score", () => {
    const semantic = [{ entry: entry({ id: "a" }), score: 0.9 }];
    const fulltext = [{ entry: entry({ id: "a" }), score: 0.5 }];
    const ilike = [{ entry: entry({ id: "a" }), score: 0.1 }];

    const result = mergeSearchResults(semantic, fulltext, ilike);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("sorts by score descending", () => {
    const semantic = [{ entry: entry({ id: "a" }), score: 0.9 }];
    const fulltext = [{ entry: entry({ id: "b" }), score: 0.7 }];
    const ilike = [{ entry: entry({ id: "c" }), score: 0.1 }];

    const result = mergeSearchResults(semantic, fulltext, ilike);
    expect(result.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("handles empty inputs", () => {
    const result = mergeSearchResults([], [], []);
    expect(result).toEqual([]);
  });

  it("merges across all three tiers", () => {
    const semantic = [{ entry: entry({ id: "a" }), score: 0.8 }];
    const fulltext = [{ entry: entry({ id: "b" }), score: 0.6 }];
    const ilike = [{ entry: entry({ id: "c" }), score: 0.1 }];

    const result = mergeSearchResults(semantic, fulltext, ilike);
    expect(result).toHaveLength(3);
  });
});

describe("buildIlikeWords", () => {
  it("splits on whitespace and filters short words", () => {
    expect(buildIlikeWords("code structure a overview")).toEqual([
      "code",
      "structure",
      "overview",
    ]);
  });

  it("returns empty array for empty/whitespace input", () => {
    expect(buildIlikeWords("")).toEqual([]);
    expect(buildIlikeWords("   ")).toEqual([]);
  });

  it("filters single-char words", () => {
    expect(buildIlikeWords("a b cd ef")).toEqual(["cd", "ef"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/db/search-merge.test.ts`
Expected: FAIL — `../../src/db/search-helpers` does not exist

- [ ] **Step 3: Create search helpers module**

Create `backend/src/db/search-helpers.ts`:

```typescript
import type { Entry } from "./types";

export interface ScoredEntry {
  entry: Entry;
  score: number;
}

/**
 * Merge results from semantic, full-text, and ILIKE tiers.
 * Deduplicates by entry ID, keeping the highest score.
 * Returns Entry[] sorted by score descending.
 */
export function mergeSearchResults(
  semantic: ScoredEntry[],
  fulltext: ScoredEntry[],
  ilike: ScoredEntry[],
): Entry[] {
  const bestByid = new Map<string, ScoredEntry>();

  for (const scored of [...semantic, ...fulltext, ...ilike]) {
    const existing = bestByid.get(scored.entry.id);
    if (!existing || scored.score > existing.score) {
      bestByid.set(scored.entry.id, scored);
    }
  }

  return Array.from(bestByid.values())
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry);
}

/**
 * Split a search query into individual words for ILIKE matching.
 * Filters out words shorter than 2 characters.
 */
export function buildIlikeWords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/db/search-merge.test.ts`
Expected: All 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/search-helpers.ts backend/test/db/search-merge.test.ts
git commit -m "feat: add search merge/dedup helpers with tests"
```

- [ ] **Step 6: Rewrite `searchEntries` in `entries.ts`**

Replace the `searchEntries` function (lines 94-142) in `backend/src/db/queries/entries.ts` with:

```typescript
export async function searchEntries(
  db: SupabaseClient,
  projectId: string,
  query: string,
  options?: { tags?: string[]; folder?: string },
  queryEmbedding?: number[] | null,
): Promise<Entry[]> {
  // --- Tier 1: Semantic search (if we have an embedding) ---
  const semanticPromise: Promise<ScoredEntry[]> = queryEmbedding
    ? db
        .rpc("match_entries", {
          query_embedding: JSON.stringify(queryEmbedding),
          match_project_id: projectId,
          match_threshold: 0.3,
          match_count: 10,
        })
        .then(({ data, error }) => {
          if (error) {
            console.error("[search] semantic error:", error.message);
            return [];
          }
          return (data ?? []).map((row: Entry & { similarity: number }) => {
            const { similarity, ...entry } = row;
            return { entry: entry as Entry, score: similarity };
          });
        })
    : Promise.resolve([]);

  // --- Tier 2: Full-text search ---
  let ftQuery = db
    .from("entries")
    .select("*")
    .eq("project_id", projectId)
    .textSearch("search_vector", query, { type: "websearch" });

  if (options?.folder) ftQuery = ftQuery.like("path", `${options.folder}/%`);
  if (options?.tags?.length) ftQuery = ftQuery.overlaps("tags", options.tags);

  const fulltextPromise: Promise<ScoredEntry[]> = ftQuery.then(({ data, error }) => {
    if (error) {
      console.error("[search] fulltext error:", error.message);
      return [];
    }
    // TODO: Use ts_rank for proper intra-tier ordering (requires RPC function).
    // For v1, all full-text results get a fixed score of 0.5 (below semantic, above ILIKE).
    return (data ?? []).map((e: Entry) => ({ entry: e, score: 0.5 }));
  });

  // --- Tier 3: ILIKE word search ---
  const words = buildIlikeWords(query);
  const ilikePromise: Promise<ScoredEntry[]> =
    words.length > 0
      ? (() => {
          const orClauses = words
            .map((w) => {
              const p = `%${w}%`;
              return `path.ilike.${p},content.ilike.${p}`;
            })
            .join(",");

          let iq = db
            .from("entries")
            .select("*")
            .eq("project_id", projectId)
            .or(orClauses);

          if (options?.folder) iq = iq.like("path", `${options.folder}/%`);
          if (options?.tags?.length) iq = iq.overlaps("tags", options.tags);

          return iq.then(({ data, error }) => {
            if (error) {
              console.error("[search] ilike error:", error.message);
              return [];
            }
            return (data ?? []).map((e: Entry) => ({ entry: e, score: 0.1 }));
          });
        })()
      : Promise.resolve([]);

  // Run all three tiers in parallel
  const [semantic, fulltext, ilike] = await Promise.all([
    semanticPromise,
    fulltextPromise,
    ilikePromise,
  ]);

  return mergeSearchResults(semantic, fulltext, ilike);
}
```

Add the required imports at the top of `entries.ts`:

```typescript
import { buildIlikeWords, mergeSearchResults, type ScoredEntry } from "../search-helpers";
```

**Important:** Also update ALL other `select("*")` calls in `entries.ts` that return `Entry` objects to exclude the `embedding` column. Replace `.select("*")` with `.select("id, project_id, path, content, content_type, author_id, source, tags, google_doc_id, created_at, updated_at")` in `upsertEntry`, `getEntry`, `searchEntries` (full-text and ILIKE tiers), `getRecentEntries`, `getAllEntries`, and `restoreEntry`. This prevents the large 768-float vector from being returned in API responses. Define a constant for reuse:

```typescript
const ENTRY_COLUMNS = "id, project_id, path, content, content_type, author_id, source, tags, google_doc_id, created_at, updated_at";
```

Then use `.select(ENTRY_COLUMNS)` everywhere instead of `.select("*")`.

- [ ] **Step 7: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add backend/src/db/queries/entries.ts
git commit -m "feat: rewrite searchEntries with 3-tier parallel search"
```

---

## Task 7: Wire Embedding into Search API

**Files:**
- Modify: `backend/src/api/context.ts:150-166` (search endpoint)

- [ ] **Step 1: Update search endpoint to embed query and pass to `searchEntries`**

In `backend/src/api/context.ts`, update the search route (lines 150-166). Add import at top:

```typescript
import { embeddingConfigFromEnv, embedTexts } from "../lib/embeddings";
```

Replace the search handler body:

```typescript
// GET /api/context/:project/search?q=&tags=&folder=
context.get("/:project/search", async (c) => {
  const user = c.get("user");
  const projectName = c.req.param("project");
  const query = c.req.query("q");
  const tags = c.req.query("tags")?.split(",");
  const folder = c.req.query("folder");

  if (!query) throw new AppError("q query parameter is required", 400, "VALIDATION_ERROR");

  const db = createSupabaseClient(c.env);
  const proj = await getProjectByName(db, projectName, user.id);
  if (!proj) throw new NotFoundError(`Project "${projectName}" not found`);

  // Embed the query for semantic search (returns null if service unavailable)
  const config = embeddingConfigFromEnv(c.env);
  const vectors = await embedTexts([query], "search_query", config);
  const queryEmbedding = vectors?.[0] ?? null;

  const results = await searchEntries(db, proj.id, query, { tags, folder }, queryEmbedding);
  return c.json(results);
});
```

- [ ] **Step 2: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/context.ts
git commit -m "feat: wire semantic embedding into search endpoint"
```

---

## Task 8: Embed on Write

**Files:**
- Modify: `backend/src/api/context.ts` (`/save`, `/file`, `/session-summary`, `/restore` routes)
- Modify: `backend/src/db/queries/entries.ts` (add `updateEmbedding`)

- [ ] **Step 1: Add `updateEmbedding` to `entries.ts`**

Add this function to the end of `backend/src/db/queries/entries.ts`:

```typescript
export async function updateEmbedding(
  db: SupabaseClient,
  entryId: string,
  embedding: number[],
): Promise<void> {
  const { error } = await db
    .from("entries")
    .update({ embedding: JSON.stringify(embedding) })
    .eq("id", entryId);
  if (error) console.error(`[embeddings] Failed to save embedding for ${entryId}:`, error.message);
}
```

- [ ] **Step 2: Add `embedAndUpdate` helper to `context.ts`**

Add this helper function inside `context.ts` (after the imports, before the routes):

**Note:** `embeddingConfigFromEnv` and `embedTexts` were already imported in Task 7. Merge `updateEmbedding` into the existing queries import (line 6-19 of context.ts), do NOT add a duplicate import line.

```typescript
// Add to existing "../db/queries" import:
import { ..., updateEmbedding } from "../db/queries";

/** Fire-and-forget: embed entry content and save the vector. */
async function embedAndUpdate(
  env: Env,
  db: ReturnType<typeof createSupabaseClient>,
  entryId: string,
  path: string,
  content: string,
): Promise<void> {
  const config = embeddingConfigFromEnv(env);
  // Prepend path for semantic signal
  const textToEmbed = `${path}\n\n${content}`;
  const vectors = await embedTexts([textToEmbed], "search_document", config);
  if (vectors?.[0]) {
    await updateEmbedding(db, entryId, vectors[0]);
  }
}
```

- [ ] **Step 3: Wire into `/save` route with `ctx.waitUntil`**

In the `/save` handler, after `return c.json(entry, 201);` on line 74, the entry is already returned. Instead, restructure: before returning, get the execution context and fire embedding in the background. Replace the end of the `/save` handler:

```typescript
  // Fire-and-forget embedding (runs after response via waitUntil)
  c.executionCtx.waitUntil(embedAndUpdate(c.env, db, entry.id, path, content));

  return c.json(entry, 201);
```

- [ ] **Step 4: Wire into `/file` route the same way**

In the `/file` handler, before `return c.json(entry, 201);`, add:

```typescript
  c.executionCtx.waitUntil(embedAndUpdate(c.env, db, entry.id, path, content));
```

- [ ] **Step 5: Wire into `/session-summary` route**

In the `/session-summary` handler, before `return c.json(entry, 201);`, add:

```typescript
  c.executionCtx.waitUntil(embedAndUpdate(c.env, db, entry.id, path, fullContent));
```

- [ ] **Step 6: Wire into `/:project/restore` route**

In the `/restore` handler, before `return c.json(entry);`, add:

```typescript
  if (entry) {
    c.executionCtx.waitUntil(embedAndUpdate(c.env, db, entry.id, path, historyRecord.content));
  }
```

- [ ] **Step 7: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add backend/src/db/queries/entries.ts backend/src/api/context.ts
git commit -m "feat: embed entries on write via ctx.waitUntil"
```

---

## Task 9: Environment Config

**Files:**
- Modify: `backend/wrangler.jsonc`

- [ ] **Step 1: Add embedding vars to `wrangler.jsonc`**

Add to the `"vars"` section:

```jsonc
    "EMBEDDING_SERVICE_URL": "",
    "EMBEDDING_SERVICE_KEY": ""
```

These are empty by default (semantic search disabled). Set via `wrangler secret put` or Cloudflare dashboard for production.

- [ ] **Step 2: Commit**

```bash
git add backend/wrangler.jsonc
git commit -m "feat: add embedding service env vars to wrangler config"
```

---

## Task 10: Backfill Script

**Files:**
- Create: `embedding-service/backfill.py`
- Create: `embedding-service/requirements-backfill.txt`
- Create: `embedding-service/.gitignore`

- [ ] **Step 1: Create `requirements-backfill.txt`**

```
requests>=2.31.0
supabase>=2.0.0
```

- [ ] **Step 2: Create `.gitignore`**

```
__pycache__/
.venv/
*.pyc
.env
```

- [ ] **Step 3: Write backfill script**

```python
"""
One-time script to embed all existing entries that don't have embeddings.
Reusable for model swaps: clear all embeddings, then re-run.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... EMBEDDING_SERVICE_URL=... \
  EMBED_API_KEY=... python backfill.py [--dry-run] [--batch-size 50]
"""
import argparse
import os
import sys

import requests
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
EMBED_URL = os.environ["EMBEDDING_SERVICE_URL"]
EMBED_KEY = os.environ.get("EMBED_API_KEY", "")


def main():
    parser = argparse.ArgumentParser(description="Backfill entry embeddings")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without writing")
    parser.add_argument("--batch-size", type=int, default=50, help="Entries per embedding batch")
    args = parser.parse_args()

    db = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Fetch entries without embeddings
    result = db.table("entries").select("id, path, content").is_("embedding", "null").execute()
    entries = result.data or []
    print(f"Found {len(entries)} entries without embeddings")

    if args.dry_run:
        for e in entries:
            print(f"  Would embed: {e['path']} ({len(e['content'])} chars)")
        return

    # Process in batches
    for i in range(0, len(entries), args.batch_size):
        batch = entries[i : i + args.batch_size]
        texts = [f"{e['path']}\n\n{e['content']}" for e in batch]

        resp = requests.post(
            f"{EMBED_URL}/embed",
            json={"texts": texts, "type": "search_document"},
            headers={"Authorization": f"Bearer {EMBED_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()
        embeddings = resp.json()["embeddings"]

        for entry, embedding in zip(batch, embeddings):
            db.table("entries").update({"embedding": embedding}).eq("id", entry["id"]).execute()
            print(f"  Embedded: {entry['path']}")

        print(f"Batch {i // args.batch_size + 1}: {len(batch)} entries embedded")

    print("Done!")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Test with `--dry-run`**

Run: `cd embedding-service && pip install -r requirements-backfill.txt && SUPABASE_URL=... SUPABASE_SERVICE_KEY=... EMBEDDING_SERVICE_URL=http://localhost:8787 python backfill.py --dry-run`
Expected: Lists entries that would be embedded without writing anything

- [ ] **Step 5: Commit**

```bash
git add embedding-service/backfill.py embedding-service/requirements-backfill.txt embedding-service/.gitignore
git commit -m "feat: add backfill script for existing entries"
```

---

## Task 11: MCP Tool Search — Pass Embedding

**Files:**
- Modify: `backend/src/mcp/tools/context-retrieval.ts:42-75` (`search_context` tool)

- [ ] **Step 1: Update MCP search tool to embed query**

The MCP tool calls `searchEntries` but doesn't pass an embedding. Update it to embed the query first. In `context-retrieval.ts`, add import:

```typescript
import { embeddingConfigFromEnv, embedTexts } from "../../lib/embeddings";
```

Then update the `search_context` tool handler (inside the async callback):

```typescript
    async ({ project, query, tags, folder }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      // Embed the query for semantic search
      const config = embeddingConfigFromEnv(env);
      const vectors = await embedTexts([query], "search_query", config);
      const queryEmbedding = vectors?.[0] ?? null;

      const results = await searchEntries(db, proj.id, query, { tags, folder }, queryEmbedding);
      // ... rest unchanged (formatting results)
```

- [ ] **Step 2: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/mcp/tools/context-retrieval.ts
git commit -m "feat: wire semantic search into MCP search_context tool"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run embedding service tests**

Run: `cd embedding-service && pytest test_embed.py -v`
Expected: All tests pass

- [ ] **Step 4: Manual end-to-end test** (if embedding service and Supabase are available)

1. Start embedding service: `cd embedding-service && uvicorn app:app --port 8787`
2. Set env vars: `EMBEDDING_SERVICE_URL=http://localhost:8787`, `EMBEDDING_SERVICE_KEY=...`
3. Save an entry via the API about "login and session management"
4. Search for "auth flow" — should find it via semantic search
5. Search for "login" — should find it via keyword search
6. Search for "nonexistent gibberish" — should return empty

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup for semantic search"
```
