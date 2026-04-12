# Auth Retrospective — Synapse Project

**Date**: 2026-03-24
**Project**: Synapse (context management tool with web frontend, backend API, CLI/MCP server)

---

## Architecture Overview

Synapse uses **three coexisting auth mechanisms**:

1. **Supabase Auth** — Password, magic links, and OAuth (Google/GitHub) for the web frontend
2. **API Keys** — For CLI, MCP server, and programmatic access (SHA-256 hashed, stored in `api_keys` table)
3. **JWT Tokens** — Issued by Supabase, validated on every authenticated request from the frontend

The auth middleware (`backend/src/lib/auth.ts`) tries JWT verification first, then falls back to API key lookup.

---

## Auth Flows Implemented

### Web Signup
- Email/password form or OAuth (Google/GitHub)
- Supabase `signUp()` creates auth user → email confirmation required
- Frontend polls `/dashboard` every 3 seconds waiting for confirmation
- Auto-redirects after email is confirmed

### Web Login
- Password login OR magic link (OTP) via Supabase
- Session stored in secure HTTP-only cookies via Supabase SSR client
- Protected routes (`/(app)/*`) redirect unauthenticated users to `/login` with a return URL

### OAuth (Google/GitHub)
- Supabase handles the OAuth flow for login/signup
- Separate Google OAuth flow for Drive integration (`/auth/google/connect`) stores tokens in `users.google_oauth_tokens` JSONB column
- Scope: `https://www.googleapis.com/auth/drive.file` (file-scoped access only)

### CLI Login/Signup
- `npx synapsesync-mcp signup --email <email>` — creates account, returns API key
- `npx synapsesync-mcp login --email <email> --password <password> [--label <label>]` — returns API key
- API key stored in `.mcp.json` as `SYNAPSE_API_KEY` env var

### API Key System
- Each user can have up to 10 API keys
- Keys stored as SHA-256 hashes — plaintext never saved in DB
- Keys support labels (e.g., "MacBook Pro", "CI server") and optional expiry
- `last_used_at` updated on each use (fire-and-forget)
- CRUD via `/api/account/keys`

### Session Persistence
- Frontend `hooks.server.ts` calls `supabase.auth.getUser()` on every request
- Validates/refreshes tokens and passes updated cookies downstream
- Sets `event.locals.user` and `event.locals.token` for page loads

### E2E Encryption (MCP)
- Optional `SYNAPSE_PASSPHRASE` env var enables client-side encryption
- PBKDF2 key derivation (100K iterations, email as salt) → AES-256-GCM
- Prefix `enc:v1:` marks encrypted content
- Transparent encrypt on write, decrypt on read

### Database-Level Security (RLS)
- All tables have Row-Level Security policies
- `users` — can only read own row
- `projects` — members only read projects they belong to
- `entries` — members can read; editors/owners can write
- `api_keys` — users can only read/delete their own keys
- Note: Backend uses Supabase service key (bypasses RLS). RLS serves as defense-in-depth, not the primary auth layer.

---

## Holes Identified & Things Missed Initially

### 1. JWT Verification Was Manual (Fixed)
**Problem**: Initially used a manual JWT secret (`SUPABASE_JWT_SECRET`) to verify tokens. This was fragile and required an extra env var.
**Fix** (commit `9f85ee2`): Switched to `supabase.auth.getUser()` for JWT validation — Supabase handles verification natively, no manual secret needed.
**Lesson**: Don't roll your own JWT verification when the auth provider has a built-in method.

### 2. Auth Sessions Lost on Page Refresh (Fixed)
**Problem**: After login, refreshing the page would log the user out. The Supabase SSR client was setting cookies via response headers, but the SvelteKit hooks weren't forwarding those headers.
**Fix** (commit `ab53753`): Modified `hooks.server.ts` to pass Supabase response headers through using the `setAll()` callback.
**Lesson**: When using Supabase SSR, the cookie/header bridge between Supabase and your framework's request lifecycle needs explicit handling. This is easy to miss.

### 3. No Duplicate Account Check on Signup (Fixed)
**Problem**: Supabase's `signUp()` silently succeeds if the email already exists (returns a fake user without creating one). Users got no feedback that their email was already registered.
**Fix** (commit `d172418`): Added a pre-check query to the `users` table before calling `signUp()`. Returns a clear error if the email is already in use.
**Lesson**: Don't trust auth providers to handle edge cases the way you'd expect. Always verify assumptions about provider behavior.

### 4. OAuth/Password Conflict Errors Were Cryptic (Fixed)
**Problem**: If a user signed up with Google OAuth but later tried to log in with email/password, they got a generic Supabase error. No indication of what went wrong.
**Fix** (commit `3375575`): Added detection for this specific scenario — now shows a friendly message like "This account uses Google sign-in."
**Lesson**: Map provider error codes to user-friendly messages. Auth error UX matters a lot for first impressions.

### 5. Single API Key Per User → Multi-Key System
**Problem**: Originally stored a single `api_key_hash` column on the `users` table. Users couldn't have separate keys for different devices/tools.
**Fix** (commits `f9af382`, `109a8cb`, `826e76d`, `be02795`, `387022f`): Created dedicated `api_keys` table with labels, expiry, and last-used tracking. Migrated existing keys. Cleaned up old column from all migration files.
**Lesson**: Design for multi-key from the start. Even if v1 only needs one key, the migration is painful. A dedicated `api_keys` table with labels and metadata is always the right call.

### 6. CLI Login Created Duplicate Keys (Fixed)
**Problem**: Running `login` multiple times with the same label created duplicate API keys.
**Fix** (commit `f2bde47`): Now deletes the old key with the same label before creating a new one.
**Lesson**: Upsert semantics for user-facing resources. If something has a natural key (label), use it.

### 7. CLI Login/Signup Required Full SDK Installation (Fixed)
**Problem**: `npx synapsesync-mcp login` failed because the MCP SDK (`@modelcontextprotocol/sdk`) was imported at the top level, but login/signup don't need it. Users had to install the full SDK just to get their API key.
**Fix** (commit `bbb3094`): Moved SDK `require()` calls after CLI command handling, so login/signup run with zero dependencies beyond Node.js.
**Lesson**: CLI entry points that handle auth should have minimal dependencies. Defer heavy imports until they're actually needed.

---

## Security Measures Added Later

### Rate Limiting (Added in commit `c184c12`)
- 120 requests/minute per API key or IP
- In-memory Map with TTL reset per Cloudflare Workers isolate
- Returns proper `429` with `Retry-After` and `X-RateLimit-*` headers
- **Initially missing** — added alongside OpenAPI spec and idempotency

### Idempotency Keys (Added in commit `c184c12`)
- `Idempotency-Key` header support for safe retries
- 24-hour in-memory response cache
- Returns `Idempotency-Replayed: true` header on replayed responses
- Essential for CLI/MCP reliability over flaky networks

### CORS Configuration
- Configurable via `CORS_ORIGINS` env var
- Default: `http://localhost:5173,https://synapsesync.app`
- Supports credentials

---

## Key Takeaways for Future Projects

1. **Use the auth provider's native verification** — don't roll your own JWT validation
2. **Test page refresh after login** — session persistence is a common gotcha with SSR frameworks
3. **Pre-check before signup** — auth providers may not error the way you expect on duplicates
4. **Map all auth error scenarios to friendly messages** — especially OAuth/password conflicts
5. **Design multi-key from day one** — single API key per user is always a false simplification
6. **Keep CLI auth lightweight** — defer heavy imports, login should work with zero dependencies
7. **Add rate limiting and idempotency early** — they're easy to add, hard to retrofit under load
8. **RLS is defense-in-depth** — document which layer is authoritative for access control
9. **Label-based upsert for API keys** — prevents duplicates on repeated CLI logins
10. **Test the OAuth callback flow end-to-end** — token exchange, session creation, and redirect all need to work together
