# Deploy the Embedding Service — activate AI project correlation

Operational runbook to turn on **AI project correlation** (cross-source auto-link)
and **semantic search** in production. The feature is fully built and validated
but **dormant in prod** until the embedding service is deployed.

## What it unlocks

A keyless **browser** capture (claude.ai / chatgpt.com — no git context) and a
**local-agent** capture (e.g. Claude Code in a repo) about the same work get
**auto-linked into one project**. Without the embedding service,
`aiResolveProject` returns `null`, browser captures fall back to host-bucketing
(no cross-source linking), and semantic search degrades to keyword.

## Status — validated, not yet live

- Service runs: `embedding-service/` (FastAPI + `nomic-embed-text-v1.5`), 8/8 tests pass, real 768-dim vectors.
- Cross-source link proven locally: browser ↔ local-agent cosine **0.87** (≥ 0.82 → confident assign/link); unrelated **0.57** (< 0.65 → separate project).
- The pgvector kNN/merge SQL is CI-validated (`scripts/test-pgvector-rpcs.mjs`).
- Remaining work = this deploy (two coupled prerequisites below).

## Prerequisite A — deploy the service container

`embedding-service/` is a Python ML container (torch + sentence-transformers); it
**cannot** run on Cloudflare Workers. Deploy it to a container host (Fly / Render
/ Railway / a small VM).

- Build from `embedding-service/Dockerfile`. It **bakes the ~500 MB model at build
  time**, so the running container starts without a download (the image is large;
  the build is slow).
- The service listens on **8080** (`EXPOSE 8080`); map it to a URL the Worker can reach.
- Set the service env var **`EMBED_API_KEY`** to a secret bearer token (you choose it).
- `GET /health` → `{"status":"ok","model":"nomic-embed-text-v1.5"}` once the model is loaded.

## Prerequisite B — apply the AI-correlation migrations to prod Supabase

The Worker auto-deploys on push, but migrations are applied **manually** (the
auto-migrate CI job skips — no `SUPABASE_*` secrets set). If the schema/RPCs are
missing in prod, correlation calls fail even with the service up.

| Object | Migration |
| --- | --- |
| `conversations.embedding vector(768)`, `match_conversations` RPC, `project_merge_candidates` table | **029** |
| `find_merge_candidates` RPC | **030** |
| `merge_projects` RPC | 019 (older; likely already in prod) |

Safe action — apply anything pending:

```bash
cd <repo>
supabase db push --include-all
```

## Wire the Worker to the service

Both are Cloudflare Worker **secrets** (per `backend/wrangler.jsonc`), set from the
deploy machine:

```bash
cd backend
wrangler secret put EMBEDDING_SERVICE_URL   # base URL only — do NOT include /embed (the code appends it)
wrangler secret put EMBEDDING_SERVICE_KEY   # MUST equal the service's EMBED_API_KEY
```

> The variable-name mismatch is intentional: the **service** reads `EMBED_API_KEY`;
> the **Worker** sends `Authorization: Bearer ${EMBEDDING_SERVICE_KEY}`. Same value,
> different names. Secrets apply to the live Worker immediately — no code redeploy needed.

## The contract (what the service must honor)

If you ever swap the model or host, keep this exact contract (`backend/src/lib/embeddings.ts`):

- `POST {EMBEDDING_SERVICE_URL}/embed`, header `Authorization: Bearer {EMBEDDING_SERVICE_KEY}`
- Request: `{ "texts": string[], "type": "search_query" | "search_document" }`
- Response: `{ "embeddings": number[][] }` — each vector **768-dim** (must match `vector(768)`).
- Respond within ~3 s (`EMBEDDING_TIMEOUT_MS`) or the Worker treats it as unavailable and degrades gracefully.

## Verify

Smoke-test the service directly (confirms auth + dimension):

```bash
curl -sS -X POST "$EMBEDDING_SERVICE_URL/embed" \
  -H "Authorization: Bearer $EMBEDDING_SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"texts":["hello world"],"type":"search_query"}' \
  | jq '.embeddings[0] | length'      # → 768
```

End-to-end: once embeddings are active, the live `project-correlation-e2e` job's
**PC3** stops self-skipping and asserts that near-duplicate captures group while
unrelated ones stay separate on the deployed stack. (Or: post a keyless browser
capture + a related local capture and confirm they share a `project_id`.)

## Rollback

Unset `EMBEDDING_SERVICE_URL` (or point it at a dead host). `aiResolveProject`
returns `null` → graceful fallback to host-bucketing. Zero risk to the core
capture loop.

## Tuning & known limits

- Thresholds are starting values — calibrate on real data (`backend/src/lib/constants.ts`):
  `PROJECT_ASSIGN_THRESHOLD=0.82`, `PROJECT_CREATE_THRESHOLD=0.65`, `PROJECT_MERGE_THRESHOLD=0.85`.
- Correlation is **kNN + 2-run hysteresis** (no LLM). An LLM recheck for the
  ambiguous 0.65–0.82 band is scaffolded (`RECONCILE_RECHECK_CAP`) but not wired.
- Structural blind spot: **same topic, different project** can over-group — cosine
  measures topical similarity, not project identity. Watch for it during calibration.

See `docs/SELF_HOSTING.md` §4 for the generic self-hosting note.
