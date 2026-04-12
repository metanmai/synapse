# Multiple API Keys Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

Replace the single `api_key_hash` column on the `users` table with a dedicated `api_keys` table. Each user can have up to 10 API keys, each with a required label, optional expiry, and individual revocation. The auth middleware is updated to query the new table and track last usage.

## Decisions

- **Max 10 keys per user** — enforced at the application layer
- **Labels are required** — forces users to name keys (e.g., "MacBook Pro", "CI server")
- **Optional expiry** — user picks an exact date/time via a datetime picker, or leaves blank for no expiry
- **Expired keys stay in the table** — visible on the account page for cleanup, but don't authenticate
- **`last_used_at` tracking** — updated on successful auth so users can identify stale keys
- **Existing keys are migrated** — moved to the new table with label "default"

## Database Changes

### New `api_keys` table

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key_hash text unique not null,
  label text not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

create index idx_api_keys_user_id on api_keys(user_id);
create index idx_api_keys_key_hash on api_keys(key_hash);

-- RLS (defense-in-depth; Worker uses service key which bypasses RLS)
alter table api_keys enable row level security;

create policy "api_keys_read_own" on api_keys for select
  using (user_id = auth.uid());

create policy "api_keys_delete_own" on api_keys for delete
  using (user_id = auth.uid());
```

### Migrate existing keys

```sql
-- Move existing api_key_hash values into the new table
insert into api_keys (user_id, key_hash, label)
select id, api_key_hash, 'default'
from users
where api_key_hash is not null;

-- Drop the column from users
alter table users drop column api_key_hash;
```

### `users` table after migration

The `api_key_hash` column is removed. The `User` TypeScript interface drops the `api_key_hash` field.

## Backend API Changes

### Remove `POST /api/account/regenerate-key`

This endpoint is replaced by the new key management endpoints.

### New endpoints

All require auth middleware (Bearer token — JWT or existing API key).

#### `POST /api/account/keys`

Create a new API key.

- **Body**: `{ label: string, expires_at?: string | null }`
- **Validation**: `label` is required and non-empty
- **Max 10 enforcement**: Count all keys for the user (including expired). If >= 10, return 400 with `"API key limit reached (10). Revoke an existing key first."`
- **Key generation**: Same as current — `crypto.randomUUID() + "-" + crypto.randomUUID()`
- **Storage**: Hash with SHA-256, store in `api_keys` table
- **Response**: `{ id, label, api_key, expires_at, created_at }` — plaintext `api_key` is returned once and never stored

#### `GET /api/account/keys`

List all keys for the authenticated user.

- **Response**: `{ id, label, expires_at, last_used_at, created_at }[]` — ordered by `created_at` desc
- **Never returns the hash** — only metadata

#### `DELETE /api/account/keys/:id`

Revoke a specific key.

- **Validation**: Key must belong to the authenticated user
- **Response**: `{ ok: true }`
- **Note**: A user can revoke the key they're currently authenticating with. That's fine — the deletion takes effect on the next request.

### Auth middleware changes

**Current flow** (`backend/src/lib/auth.ts`):
1. Try JWT → `findUserBySupabaseAuthId()`
2. Fallback to API key → `findUserByApiKeyHash()` on `users` table

**New flow**:
1. Try JWT → `findUserBySupabaseAuthId()` (unchanged)
2. Fallback to API key → `findUserByApiKeyHash()` now queries `api_keys` table:
   - Hash the token
   - Query `api_keys` where `key_hash = hash`
   - Join to `users` to get the user
   - Check `expires_at` — if set and in the past, throw `UnauthorizedError` with message "API key has expired"
   - On success, update `last_used_at = now()` (fire-and-forget, don't block the request)

### Query changes

**Remove**: `findUserByApiKeyHash` from `users.ts` (queried `users.api_key_hash`)

**Add to a new `api-keys.ts` query file**:
- `findUserByApiKeyHash(db, keyHash)` — queries `api_keys` joined to `users`, checks expiry
- `createApiKey(db, userId, keyHash, label, expiresAt?)` — inserts into `api_keys`
- `listApiKeys(db, userId)` — returns all keys for user (metadata only)
- `deleteApiKey(db, keyId, userId)` — deletes key, scoped to user
- `countApiKeys(db, userId)` — count for limit enforcement
- `updateApiKeyLastUsed(db, keyId)` — sets `last_used_at = now()`

### Type changes

**`User` interface**: Remove `api_key_hash` field.

**New `ApiKey` interface**:
```typescript
export interface ApiKey {
  id: string;
  user_id: string;
  key_hash: string;
  label: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}
```

### Env changes

None — no new environment variables needed.

## Frontend Changes

### Account page (`/account`)

**Replace `ApiKeyCard.svelte` with `ApiKeysCard.svelte`.**

#### States

1. **Key list**: Shows all keys with columns: Label, Created, Last Used ("Never" if null), Expires ("Never" if null), Revoke button. Expired keys shown with muted/strikethrough styling.

2. **Create form**: Toggled by "Create Key" button. Fields:
   - Label (text input, required)
   - Expires (datetime picker, optional — blank means never)
   - Submit button

3. **New key display**: After creation, shows the plaintext key with a copy button and "Save this now — it won't be shown again" warning. Dismissed on next action.

#### Server actions

Replace `regenerateKey` action with:
- `createKey` — calls `POST /api/account/keys`, returns `{ newKey: { id, label, api_key } }`
- `revokeKey` — calls `DELETE /api/account/keys/:id`

#### Page load

`+page.server.ts` `load` function adds `keys` to the returned data by calling `GET /api/account/keys`.

### API client methods

Add to `frontend/src/lib/server/api.ts`:
- `listApiKeys()` — `GET /api/account/keys`
- `createApiKey(label, expiresAt?)` — `POST /api/account/keys`
- `revokeApiKey(keyId)` — `DELETE /api/account/keys/:id`

Remove:
- `regenerateApiKey()` — replaced by `createApiKey`

### Signup flow

The `POST /auth/signup` endpoint currently generates an API key and stores the hash on the `users` row via `createUser(db, email, apiKeyHash)`. This becomes two operations:

1. `createUser(db, email)` — no longer takes `apiKeyHash` param
2. `createApiKey(db, userId, keyHash, "default")` — inserts into `api_keys` table

The plaintext key is returned in the signup response as before.

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/004_multi_api_keys.sql` | New: api_keys table, migrate existing hashes, drop api_key_hash |
| `backend/src/db/types.ts` | Remove `api_key_hash` from User, add ApiKey interface |
| `backend/src/db/queries/api-keys.ts` | New: CRUD for api_keys table |
| `backend/src/db/queries/users.ts` | Remove `findUserByApiKeyHash`, remove `createUser`'s api_key_hash param |
| `backend/src/db/queries/index.ts` | Re-export api-keys |
| `backend/src/api/auth.ts` | Update signup to use api_keys table, replace regenerate-key with new endpoints |
| `backend/src/lib/auth.ts` | Update API key lookup to query api_keys, check expiry, update last_used_at |
| `frontend/src/lib/server/api.ts` | Replace regenerateApiKey with listApiKeys, createApiKey, revokeApiKey |
| `frontend/src/lib/components/account/ApiKeysCard.svelte` | New: replaces ApiKeyCard.svelte |
| `frontend/src/lib/components/account/ApiKeyCard.svelte` | Delete |
| `frontend/src/routes/(app)/account/+page.svelte` | Import ApiKeysCard instead of ApiKeyCard |
| `frontend/src/routes/(app)/account/+page.server.ts` | Load keys, replace regenerateKey with createKey/revokeKey actions |
