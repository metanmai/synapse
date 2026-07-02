// --- Supabase error codes ---
export const PG_NO_ROWS = "PGRST116";

// --- Search tuning ---
export const SEMANTIC_MATCH_THRESHOLD = 0.3;
export const SEMANTIC_MATCH_COUNT = 10;
export const FULLTEXT_SCORE = 0.5;
export const ILIKE_SCORE = 0.1;

// --- Pagination ---
export const DEFAULT_PAGE_LIMIT = 50;
export const RECENT_ENTRIES_LIMIT = 20;
export const SUMMARY_PREVIEW_LENGTH = 100;

// --- Tier defaults ---
export const DEFAULT_TIER_PLUS_PRICE = "5.99";
export const DEFAULT_APP_URL = "https://synapsesync.app";

// --- Quota limits ---
// Phase 03-02: Free expanded from 5 → 50 (parity with Plus). Differentiation
// moves to per-project capacity + auto-sync + link sharing. See
// .planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md.
export const FREE_MAX_PROJECTS = 50;
export const PLUS_MAX_PROJECTS = 50;

// --- Per-project capacity limits (per tier) ---
// Stored counts; brief truncation in mcp/src/capture/pull-insights.ts stays
// MAX_INSIGHTS=10 for both tiers (the differentiator is stored count, not
// brief size). See .planning/phases/03-free-plus-tier-redesign/03-CONTEXT.md.
export const FREE_INSIGHTS_PER_PROJECT = 10;
export const PLUS_INSIGHTS_PER_PROJECT = 50;
export const FREE_CONVERSATIONS_PER_PROJECT = 10;
export const PLUS_CONVERSATIONS_PER_PROJECT = 50;

// --- Auto-sync gate (tier → daemon cycle behavior) ---
// Free users sync manually via `synapsesync sync`; Plus runs the 5-min daemon cycle.
// Hooks (SessionEnd, PreCompact) still push inline regardless of tier — only the
// background cron-style loop is gated. See slice 03-05 for the daemon wiring.
export const AUTO_SYNC_TIERS = ["plus"] as const;

// --- Rate limiting ---
export const RATE_LIMIT_MAX = 120;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// --- Auth ---
export const CLI_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLI_SESSION_SALT = "synapse-cli-session";
export const API_KEY_MAX_PER_USER = 10;

// --- Device limits (CLI-installed keys, separate from API_KEY_MAX_PER_USER) ---
// Each cli-* labeled key represents one device that has run `synapsesync wizard`.
// Phase 03-05: Free=3, Plus=10 (was Infinity). Plus changed to a finite cap to
// prevent runaway device-key creation in pathological CI/install loops.
export const DEVICE_LIMIT_FREE = 3;
export const DEVICE_LIMIT_PLUS = 10;
export const DEVICE_LABEL_PREFIX = "cli-";
export const DEVICE_NAME_MAX_LENGTH = 60;

// --- Idempotency ---
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Embedding ---
export const EMBEDDING_TIMEOUT_MS = 3000;

// --- AI project correlation (spec: docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md) ---
// Embedding cosine-similarity bands for assigning a keyless capture to a project.
// Starting values; calibrate against real capture data post-launch.
export const PROJECT_ASSIGN_THRESHOLD = 0.82; // top candidate ≥ → confident assign
export const PROJECT_CREATE_THRESHOLD = 0.65; // top candidate < → create a new project
export const PROJECT_MERGE_THRESHOLD = 0.85; // project-centroid sim to consider a merge
// Daily reconciler per-run caps (fit the ~30s cron budget; raise as headroom is measured).
export const RECONCILE_BACKFILL_CAP = 200; // embeddings backfilled per run
export const RECONCILE_RECHECK_CAP = 50; // ambiguous LLM rechecks per run
export const RECONCILE_OWNERS_PER_RUN = 100; // owners scanned for merge candidates per run
