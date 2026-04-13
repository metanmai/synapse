// --- Supabase error codes ---
export const PG_NO_ROWS = "PGRST116";

// --- Search tuning ---
export const SEMANTIC_MATCH_THRESHOLD = 0.3;
export const SEMANTIC_MATCH_COUNT = 10;
export const FULLTEXT_SCORE = 0.5;
export const ILIKE_SCORE = 0.1;
export const MIN_ILIKE_WORD_LENGTH = 2;

// --- Pagination ---
export const DEFAULT_PAGE_LIMIT = 50;
export const DEFAULT_CONVERSATION_LIMIT = 50;
export const DEFAULT_MESSAGE_LIMIT = 100;
export const RECENT_ENTRIES_LIMIT = 20;
export const SUMMARY_PREVIEW_LENGTH = 100;

// --- Tier defaults ---
export const DEFAULT_TIER_FREE_MAX_FILES = 50;
export const DEFAULT_TIER_FREE_MAX_CONNECTIONS = 3;
export const DEFAULT_TIER_FREE_MAX_HISTORY = 3;
export const DEFAULT_TIER_FREE_MAX_MEMBERS = 2;
export const DEFAULT_TIER_PLUS_MAX_FILES = 500;
export const DEFAULT_TIER_PLUS_PRICE = "5.99";
export const DEFAULT_APP_URL = "https://synapsesync.app";

// --- Rate limiting ---
export const RATE_LIMIT_MAX = 120;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// --- Auth ---
export const CLI_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CLI_SESSION_SALT = "synapse-cli-session";
export const API_KEY_MAX_PER_USER = 10;
export const BEARER_PREFIX = "Bearer ";

// --- Idempotency ---
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Storage ---
export const MEDIA_BUCKET = "conversation-media";
export const SIGNED_URL_EXPIRY_SECONDS = 3600;

// --- Embedding ---
export const EMBEDDING_TIMEOUT_MS = 3000;

// --- Valid entry sources ---
export const DEFAULT_VALID_SOURCES = "human,claude,chatgpt,cursor,copilot,windsurf,google_docs";

// --- Google OAuth ---
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_TOKEN_EXPIRY_FALLBACK = 3600;
