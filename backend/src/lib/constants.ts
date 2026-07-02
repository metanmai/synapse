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
export const FREE_MAX_PROJECTS = 5;
export const PLUS_MAX_PROJECTS = 50;

// --- Rate limiting ---
export const RATE_LIMIT_MAX = 120;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// --- Auth ---
export const CLI_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLI_SESSION_SALT = "synapse-cli-session";
export const API_KEY_MAX_PER_USER = 10;

// --- Device limits (CLI-installed keys, separate from API_KEY_MAX_PER_USER) ---
// Each cli-* labeled key represents one device that has run `synapsesync wizard`.
// Free users can connect 3 devices; Plus is unlimited.
export const DEVICE_LIMIT_FREE = 3;
export const DEVICE_LIMIT_PLUS = Number.POSITIVE_INFINITY;
export const DEVICE_LABEL_PREFIX = "cli-";
export const DEVICE_NAME_MAX_LENGTH = 60;

// --- Idempotency ---
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Embedding ---
export const EMBEDDING_TIMEOUT_MS = 3000;
