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

## Status — ✅ live in production (2026-06-15)

- Service runs: `embedding-service/` (FastAPI + `nomic-embed-text-v1.5`), 8/8 tests pass, real 768-dim vectors.
- Cross-source link proven locally: browser ↔ local-agent cosine **0.87** (≥ 0.82 → confident assign/link); unrelated **0.57** (< 0.65 → separate project).
- The pgvector kNN/merge SQL is CI-validated (`scripts/test-pgvector-rpcs.mjs`).
- Deployed to Railway (`synapse` project, `embedding-service` service) at `embeddings.synapsesync.app`.
- Worker secrets `EMBEDDING_SERVICE_URL` + `EMBEDDING_SERVICE_KEY` set on the `synapse` Worker.
- AI project correlation is now active in production.

## Prerequisite A — deploy the service container ✅ done

`embedding-service/` is a Python ML container (torch + sentence-transformers); it
**cannot** run on Cloudflare Workers. Deployed to **Railway** in the `synapse` project.

- **Host**: Railway (`synapse` project → `embedding-service` service)
- **URL**: `https://embeddings.synapsesync.app` (public), `embedding-service.railway.internal:8080` (internal)
- **Region**: `asia-southeast1-eqsg3a` (Singapore), 1 replica
- **Docker**: built from `embedding-service/Dockerfile` with Nixpacks (`builder: DOCKERFILE`); model baked at build time (~500 MB)
- **Env vars**: `EMBED_API_KEY` set via `railway variables` (same value as Worker's `EMBEDDING_SERVICE_KEY`)
- **Health**: `GET /health` → `{"status":"ok","model":"nomic-embed-text-v1.5"}`
- **Deploy date**: 2026-03-25 (initial); re-verified 2026-06-15

## Prerequisite B — apply the AI-correlation migrations to prod Supabase ✅ done

The Worker auto-deploys on push, but migrations are applied **manually** (the
auto-migrate CI job skips — no `SUPABASE_*` secrets set). If the schema/RPCs are
missing in prod, correlation calls fail even with the service up.

| Object | Migration |
| --- | --- |
| `conversations.embedding vector(768)`, `match_conversations` RPC, `project_merge_candidates` table | **029** |
| `find_merge_candidates` RPC | **030** |
| `merge_projects` RPC | 019 (older; likely already in prod) |

All three migrations (019, 029, 030) were already applied in prod via direct SQL.
The `supabase_migrations.schema_migrations` tracking table was repaired to mark
001–030 as `applied`, syncing the CLI state with reality.

> If adding future migrations: `supabase db push --linked` from the repo root.

## Wire the Worker to the service ✅ done

Both are Cloudflare Worker **secrets** (per `backend/wrangler.jsonc`), set from the
deploy machine:

```bash
cd backend
wrangler secret put EMBEDDING_SERVICE_URL   # = https://embeddings.synapsesync.app
wrangler secret put EMBEDDING_SERVICE_KEY   # = <same as EMBED_API_KEY on Railway>
```

> The variable-name mismatch is intentional: the **service** reads `EMBED_API_KEY`;
> the **Worker** sends `Authorization: Bearer ${EMBEDDING_SERVICE_KEY}`. Same value,
> different names. Secrets apply to the live Worker immediately — no code redeploy needed.
>
> Applied 2026-06-15. Worker name: `synapse`.

## The contract (what the service must honor)

If you ever swap the model or host, keep this exact contract (`backend/src/lib/embeddings.ts`):

- `POST {EMBEDDING_SERVICE_URL}/embed`, header `Authorization: Bearer {EMBEDDING_SERVICE_KEY}`
- Request: `{ "texts": string[], "type": "search_query" | "search_document" }`
- Response: `{ "embeddings": number[][] }` — each vector **768-dim** (must match `vector(768)`).
- Respond within ~3 s (`EMBEDDING_TIMEOUT_MS`) or the Worker treats it as unavailable and degrades gracefully.

## Verify ✅ passed

Smoke-test the service directly (confirms auth + dimension):

```bash
curl -sS -X POST "$EMBEDDING_SERVICE_URL/embed" \
  -H "Authorization: Bearer $EMBEDDING_SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"texts":["hello world"],"type":"search_query"}' \
  | jq '.embeddings[0] | length'      # → 768
```

**2026-06-15 verification:**
- `GET /health` → `{"status":"ok","model":"nomic-embed-text-v1.5"}` ✅
- `POST /embed` with Bearer auth → 768-dim normalized vectors ✅
- `conversations.embedding` column + HNSW index present in prod ✅
- `match_conversations`, `merge_projects`, `find_merge_candidates` RPCs present ✅
- Worker secrets `EMBEDDING_SERVICE_URL` + `EMBEDDING_SERVICE_KEY` set ✅

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
